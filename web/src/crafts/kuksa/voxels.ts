// Voxel model of a birch burl block, plus the target kuksa shape.
//
// A kuksa is the traditional Sámi/Finnish drinking cup, carved from a single
// birch burl: a deep rounded bowl with a handle, often with a finger hole.

export const DIM = { x: 34, y: 20, z: 26 } as const;
export const VOXEL = 0.12; // world units per voxel
export const CELLS = DIM.x * DIM.y * DIM.z;

export const idx = (x: number, y: number, z: number) => x + DIM.x * (y + DIM.y * z);
export function coords(i: number): [number, number, number] {
  const x = i % DIM.x;
  const yz = (i - x) / DIM.x;
  const y = yz % DIM.y;
  return [x, y, (yz - y) / DIM.y];
}
export const inBounds = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < DIM.x && y < DIM.y && z < DIM.z;

/** Voxel centre (in voxel units) -> block-local world position (block centred at origin). */
export function cellToLocal(x: number, y: number, z: number): [number, number, number] {
  return [(x + 0.5 - DIM.x / 2) * VOXEL, (y + 0.5 - DIM.y / 2) * VOXEL, (z + 0.5 - DIM.z / 2) * VOXEL];
}
/** Block-local world position -> continuous voxel coordinates. */
export function localToVoxel(x: number, y: number, z: number): [number, number, number] {
  return [x / VOXEL + DIM.x / 2, y / VOXEL + DIM.y / 2, z / VOXEL + DIM.z / 2];
}

export class VoxelGrid {
  data: Uint8Array;
  version = 0;
  constructor(data?: Uint8Array) {
    this.data = data ?? new Uint8Array(CELLS).fill(1);
  }
  get(x: number, y: number, z: number) {
    return inBounds(x, y, z) ? this.data[idx(x, y, z)] : 0;
  }
  count() {
    let n = 0;
    for (let i = 0; i < CELLS; i++) n += this.data[i];
    return n;
  }
  clone() {
    return new VoxelGrid(this.data.slice());
  }
  removeCells(cells: number[]) {
    for (const c of cells) this.data[c] = 0;
    if (cells.length) this.version++;
  }
}

export interface KuksaParams {
  rx: number;
  rz: number;
  depth: number;
  wall: number;
  handleLen: number;
  handleWidth: number;
  hole: boolean;
}

export const DEFAULT_KUKSA: KuksaParams = { rx: 10, rz: 9.5, depth: 15, wall: 2.2, handleLen: 8, handleWidth: 3.6, hole: true };

export function makeTarget(p: KuksaParams = DEFAULT_KUKSA): VoxelGrid {
  const g = new VoxelGrid(new Uint8Array(CELLS));
  const cx = 2 + p.rx;
  const cz = DIM.z / 2;
  const top = DIM.y;
  const handleY0 = top - 5;
  const holeX = cx + p.rx + p.handleLen * 0.55;
  for (let z = 0; z < DIM.z; z++)
    for (let y = 0; y < DIM.y; y++)
      for (let x = 0; x < DIM.x; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const pz = z + 0.5;
        const outer = ((px - cx) / p.rx) ** 2 + ((pz - cz) / p.rz) ** 2 + ((top - py) / p.depth) ** 2 <= 1;
        const cavity = ((px - cx) / (p.rx - p.wall)) ** 2 + ((pz - cz) / (p.rz - p.wall)) ** 2 + ((top + 0.5 - py) / (p.depth - p.wall)) ** 2 <= 1;
        const along = (px - (cx + p.rx - 2)) / (p.handleLen + 2);
        const halfW = p.handleWidth * (1 - 0.3 * Math.max(0, along));
        let handle = along >= 0 && along <= 1 && py >= handleY0 && Math.abs(pz - cz) <= halfW;
        // Round the handle's end.
        if (handle && along > 0.8) handle = (px - (cx + p.rx + p.handleLen - halfW)) ** 2 + (pz - cz) ** 2 <= (halfW + 0.5) ** 2 || px < cx + p.rx + p.handleLen - halfW;
        if (handle && p.hole && (px - holeX) ** 2 + (pz - cz) ** 2 <= 1.7 ** 2) handle = false;
        if ((outer && !cavity) || (handle && !cavity)) g.data[idx(x, y, z)] = 1;
      }
  return g;
}

/** Removes solid cells within radius r (voxels) of a point. Returns the removed cell indices. */
export function carveSphere(g: VoxelGrid, cx: number, cy: number, cz: number, r: number): number[] {
  const cells: number[] = [];
  const r2 = r * r;
  for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (!inBounds(x, y, z)) continue;
        const i = idx(x, y, z);
        if (!g.data[i]) continue;
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 + (z + 0.5 - cz) ** 2 <= r2) cells.push(i);
      }
  g.removeCells(cells);
  return cells;
}

/** Amanatides–Woo voxel traversal. Origin/dir in continuous voxel coordinates. */
export function raycast(g: VoxelGrid, o: [number, number, number], d: [number, number, number]): { cell: [number, number, number]; t: number } | null {
  // Clip the ray to the grid's bounding box first.
  let tmin = 0;
  let tmax = Infinity;
  const size = [DIM.x, DIM.y, DIM.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < 0 || o[a] > size[a]) return null;
      continue;
    }
    let t1 = (0 - o[a]) / d[a];
    let t2 = (size[a] - o[a]) / d[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  const start = [o[0] + d[0] * (tmin + 1e-6), o[1] + d[1] * (tmin + 1e-6), o[2] + d[2] * (tmin + 1e-6)];
  const cell = start.map((v, a) => Math.min(size[a] - 1, Math.max(0, Math.floor(v))));
  const step = d.map((v) => (v > 0 ? 1 : -1));
  const tDelta = d.map((v) => (Math.abs(v) < 1e-9 ? Infinity : Math.abs(1 / v)));
  const tNext = d.map((v, a) => (Math.abs(v) < 1e-9 ? Infinity : tmin + ((v > 0 ? cell[a] + 1 : cell[a]) - start[a]) / v));
  let t = tmin;
  for (let n = 0; n < 200; n++) {
    if (!inBounds(cell[0], cell[1], cell[2])) return null;
    if (g.data[idx(cell[0], cell[1], cell[2])]) return { cell: [cell[0], cell[1], cell[2]], t };
    const a = tNext[0] < tNext[1] ? (tNext[0] < tNext[2] ? 0 : 2) : tNext[1] < tNext[2] ? 1 : 2;
    t = tNext[a];
    cell[a] += step[a];
    tNext[a] += tDelta[a];
  }
  return null;
}

export interface Analysis {
  /** Waste cells that sit above part of the cup (the bowl's hollow) vs. everything else. */
  cavity: Uint8Array;
  wasteTotal: number;
  cavityTotal: number;
  targetTotal: number;
}

export function analyseTarget(target: VoxelGrid): Analysis {
  const cavity = new Uint8Array(CELLS);
  let wasteTotal = 0;
  let cavityTotal = 0;
  let targetTotal = 0;
  for (let z = 0; z < DIM.z; z++)
    for (let x = 0; x < DIM.x; x++) {
      let below = false;
      for (let y = 0; y < DIM.y; y++) {
        const i = idx(x, y, z);
        if (target.data[i]) {
          below = true;
          targetTotal++;
        } else {
          wasteTotal++;
          if (below) {
            cavity[i] = 1;
            cavityTotal++;
          }
        }
      }
    }
  return { cavity, wasteTotal, cavityTotal, targetTotal };
}

export interface Progress {
  outside: number;
  cavity: number;
  overall: number;
  overcut: number;
  score: number;
}

export function measureProgress(g: VoxelGrid, target: VoxelGrid, a: Analysis): Progress {
  let wasteLeft = 0;
  let cavityLeft = 0;
  let overcut = 0;
  for (let i = 0; i < CELLS; i++) {
    const solid = g.data[i];
    if (target.data[i]) {
      if (!solid) overcut++;
    } else if (solid) {
      wasteLeft++;
      if (a.cavity[i]) cavityLeft++;
    }
  }
  const outsideTotal = a.wasteTotal - a.cavityTotal;
  const outsideLeft = wasteLeft - cavityLeft;
  const overall = 1 - wasteLeft / Math.max(1, a.wasteTotal);
  const accuracy = 1 - overcut / Math.max(1, a.targetTotal);
  return {
    outside: 1 - outsideLeft / Math.max(1, outsideTotal),
    cavity: 1 - cavityLeft / Math.max(1, a.cavityTotal),
    overall,
    overcut: overcut / Math.max(1, a.targetTotal),
    score: Math.round(100 * overall * accuracy ** 3),
  };
}

/** Run-length encode a grid (alternating runs, starting with empty). */
export function encodeShape(g: VoxelGrid): string {
  const runs: number[] = [];
  let cur = 0;
  let n = 0;
  for (let i = 0; i < CELLS; i++) {
    if (g.data[i] === cur) n++;
    else {
      runs.push(n);
      cur = g.data[i];
      n = 1;
    }
  }
  runs.push(n);
  return runs.map((r) => r.toString(36)).join('.');
}

export function decodeShape(s: string): VoxelGrid {
  const data = new Uint8Array(CELLS);
  let i = 0;
  let cur = 0;
  for (const part of s.split('.')) {
    const n = parseInt(part, 36);
    if (cur) data.fill(1, i, i + n);
    i += n;
    cur ^= 1;
  }
  return new VoxelGrid(data);
}
