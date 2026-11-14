// Voxel wood, carved by knives.
// Local frame: the block's bottom centre is the origin, so it sits on whatever
// station it rests on.
//
// The wood is a density field (1 = solid, 0 = air, the surface at 0.5), so a
// knife stroke can take a shaving thinner than a voxel: a 'shave' op sweeps a
// rounded blade along a segment and lowers the density around it smoothly.
// `solid` is the thresholded field, used for scoring.

import * as THREE from 'three';
import type { Op, Workpiece } from '../core';

export interface VoxelSpec {
  nx: number;
  ny: number;
  nz: number;
  /** World size of one voxel. */
  size: number;
  wood: string;
  bark?: string;
  /** 1 = part of the finished object (keep), 0 = waste. */
  target?: Uint8Array;
  /** How the wood's growth rings run (for drawing): axis, rings per world unit, swirl. */
  grain?: { axis: [number, number, number]; centre?: [number, number, number]; freq: number; swirl?: number; contrast?: number };
}

type VoxelOp =
  | { k: 'carve'; cells: number[] }
  /** Sweep a ball of radius r (voxels) from a to b (continuous voxel coordinates). */
  | { k: 'shave'; a: [number, number, number]; b: [number, number, number]; r: number };

export type VC = [number, number, number];

export class VoxelBlock implements Workpiece {
  readonly kind = 'voxel' as const;
  version = 0;
  solid: Uint8Array;
  /** 0..1 per cell; the surface is where it crosses 0.5. */
  dens: Float32Array;
  readonly n: number;

  constructor(
    readonly id: string,
    readonly spec: VoxelSpec,
  ) {
    this.n = spec.nx * spec.ny * spec.nz;
    this.solid = new Uint8Array(this.n).fill(1);
    this.dens = new Float32Array(this.n).fill(1);
  }

  idx(x: number, y: number, z: number) {
    return x + this.spec.nx * (y + this.spec.ny * z);
  }
  coords(i: number): [number, number, number] {
    const { nx, ny } = this.spec;
    const x = i % nx;
    const yz = (i - x) / nx;
    const y = yz % ny;
    return [x, y, (yz - y) / ny];
  }
  inside(x: number, y: number, z: number) {
    const { nx, ny, nz } = this.spec;
    return x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz;
  }
  get(x: number, y: number, z: number) {
    return this.inside(x, y, z) ? this.solid[this.idx(x, y, z)] : 0;
  }
  /** Size of the block in world units. */
  get extent() {
    const { nx, ny, nz, size } = this.spec;
    return new THREE.Vector3(nx * size, ny * size, nz * size);
  }
  cellCenter(i: number) {
    const [x, y, z] = this.coords(i);
    const { nx, nz, size } = this.spec;
    return new THREE.Vector3((x + 0.5 - nx / 2) * size, (y + 0.5) * size, (z + 0.5 - nz / 2) * size);
  }
  /** Local position -> continuous voxel coordinates. */
  toVoxel(p: THREE.Vector3): [number, number, number] {
    const { nx, nz, size } = this.spec;
    return [p.x / size + nx / 2, p.y / size, p.z / size + nz / 2];
  }

  /** Voxel coordinates -> local position. */
  fromVoxel(v: VC) {
    const { nx, nz, size } = this.spec;
    return new THREE.Vector3((v[0] - nx / 2) * size, v[1] * size, (v[2] - nz / 2) * size);
  }

  /** Density at a cell centre (integer cell coordinates), 0 outside the block. `field` defaults to the live wood. */
  d(x: number, y: number, z: number, field: Float32Array = this.dens) {
    return this.inside(x, y, z) ? field[this.idx(x, y, z)] : 0;
  }

  /** Trilinear density at continuous voxel coordinates. */
  sample(v: VC, field: Float32Array = this.dens) {
    const fx = v[0] - 0.5;
    const fy = v[1] - 0.5;
    const fz = v[2] - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const ty = fy - y0;
    const tz = fz - z0;
    let out = 0;
    for (let k = 0; k < 8; k++) {
      const dx = k & 1;
      const dy = (k >> 1) & 1;
      const dz = (k >> 2) & 1;
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      if (w) out += w * this.d(x0 + dx, y0 + dy, z0 + dz, field);
    }
    return out;
  }

  /** Outward surface normal at continuous voxel coordinates (from the density gradient). */
  normalAt(v: VC, field: Float32Array = this.dens): THREE.Vector3 | null {
    const e = 0.8;
    const g = new THREE.Vector3(
      this.sample([v[0] - e, v[1], v[2]], field) - this.sample([v[0] + e, v[1], v[2]], field),
      this.sample([v[0], v[1] - e, v[2]], field) - this.sample([v[0], v[1] + e, v[2]], field),
      this.sample([v[0], v[1], v[2] - e], field) - this.sample([v[0], v[1], v[2] + e], field),
    );
    const l = g.length();
    return l > 1e-3 ? g.multiplyScalar(1 / l) : null;
  }

  /**
   * Where a ray (voxel coordinates, unit direction) enters the wood of `field`,
   * as a distance along it, searching from t0 to t1. It has to pass through air
   * first, so starting inside a ridge doesn't count as a hit.
   */
  rayEntry(o: VC, dir: VC, t0: number, t1: number, field: Float32Array = this.dens): number | null {
    let air = false;
    let pt = t0;
    let pd = 0;
    for (let t = t0; t <= t1 + 1e-9; t += 0.2) {
      const d = this.sample([o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t], field);
      if (d < 0.5) {
        air = true;
        pt = t;
        pd = d;
      } else if (air) return pt + ((0.5 - pd) / (d - pd)) * (t - pt);
    }
    return null;
  }

  /** Visit the cells a shave would lower, with their new density. */
  private sweep(a: VC, b: VC, r: number, each: (i: number, v: number) => void) {
    const { nx, ny, nz } = this.spec;
    const lo = (i: 0 | 1 | 2) => Math.max(0, Math.floor(Math.min(a[i], b[i]) - r - 1.5));
    const hi = (i: 0 | 1 | 2, n: number) => Math.min(n - 1, Math.ceil(Math.max(a[i], b[i]) + r + 1.5));
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const ab2 = abx * abx + aby * aby + abz * abz;
    for (let z = lo(2); z <= hi(2, nz); z++)
      for (let y = lo(1); y <= hi(1, ny); y++)
        for (let x = lo(0); x <= hi(0, nx); x++) {
          const i = this.idx(x, y, z);
          const old = this.dens[i];
          if (old <= 0) continue;
          const px = x + 0.5 - a[0];
          const py = y + 0.5 - a[1];
          const pz = z + 0.5 - a[2];
          let t = ab2 > 0 ? (px * abx + py * aby + pz * abz) / ab2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = px - abx * t;
          const qy = py - aby * t;
          const qz = pz - abz * t;
          const dist = Math.sqrt(qx * qx + qy * qy + qz * qz);
          // Signed distance from the blade's surface, as density around the 0.5 surface.
          const v = Math.max(0, Math.min(1, 0.5 + dist - r));
          if (v < old - 1e-4) each(i, v);
        }
  }

  /** What a shave would do, without doing it: whether it changes anything, and the cells it would cut through. */
  shavePreview(a: VC, b: VC, r: number) {
    let changed = 0;
    const cut: number[] = [];
    this.sweep(a, b, r, (i, v) => {
      changed++;
      if (v <= 0.5 && this.solid[i]) cut.push(i);
    });
    return { changed, cut };
  }

  private sphere(p: THREE.Vector3, r: number, each: (i: number, x: number, y: number, z: number) => void) {
    const [cx, cy, cz] = this.toVoxel(p);
    const r2 = r * r;
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if (!this.inside(x, y, z)) continue;
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 + (z + 0.5 - cz) ** 2 > r2) continue;
          each(this.idx(x, y, z), x, y, z);
        }
  }

  /** Solid cells within `r` voxels of local point `p` (what a cut there would remove). */
  carveCells(p: THREE.Vector3, r: number) {
    const cells: number[] = [];
    this.sphere(p, r, (i) => this.solid[i] && cells.push(i));
    return cells;
  }

  apply(op: Op) {
    const o = op as unknown as VoxelOp;
    if (o.k === 'carve')
      for (const c of o.cells) {
        this.solid[c] = 0;
        this.dens[c] = 0;
      }
    else if (o.k === 'shave')
      this.sweep(o.a, o.b, o.r, (i, v) => {
        this.dens[i] = v;
        if (v <= 0.5) this.solid[i] = 0;
      });
    this.version++;
  }

  snapshot() {
    return { solid: this.solid.slice(), dens: this.dens.slice() };
  }
  restore(s: unknown) {
    const v = s as { solid: Uint8Array; dens: Float32Array };
    this.solid = v.solid.slice();
    this.dens = v.dens.slice();
    this.version++;
  }

  /** How the carving compares with the target: waste removed, and keep lost. */
  carveProgress() {
    const t = this.spec.target;
    if (!t) return { waste: 0, lost: 0 };
    let waste = 0;
    let wasteGone = 0;
    let keep = 0;
    let keepGone = 0;
    for (let i = 0; i < this.n; i++) {
      if (t[i]) {
        keep++;
        if (!this.solid[i]) keepGone++;
      } else {
        waste++;
        if (!this.solid[i]) wasteGone++;
      }
    }
    return { waste: waste ? wasteGone / waste : 0, lost: keep ? keepGone / keep : 0 };
  }
}

/** Fill a target from a predicate over voxel coordinates. */
export function makeMask(spec: Pick<VoxelSpec, 'nx' | 'ny' | 'nz'>, keep: (x: number, y: number, z: number) => number) {
  const m = new Uint8Array(spec.nx * spec.ny * spec.nz);
  for (let z = 0; z < spec.nz; z++) for (let y = 0; y < spec.ny; y++) for (let x = 0; x < spec.nx; x++) m[x + spec.nx * (y + spec.ny * z)] = keep(x, y, z);
  return m;
}
