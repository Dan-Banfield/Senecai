// Surface nets: a smooth mesh through the 0.5 level of a voxel density field.
// One vertex per cube of 8 neighbouring cell centres that straddles the
// surface (placed at the average of its edge crossings), one quad per cell
// edge that crosses it. Sub-voxel density shows as the surface moving within a
// voxel, so a thin shaving is visible as a thin shaving.

export interface NetMesh {
  /** Local positions (block frame: bottom centre at the origin). */
  positions: Float32Array;
  indices: Uint32Array;
  /** Per vertex, the 8 corner cells of its cube that are solid (-1 = not solid / outside). */
  corners: Int32Array;
  vertexCount: number;
}

// The 12 edges of a cube, as pairs of corner numbers (bit 0 = +x, bit 1 = +y, bit 2 = +z).
const EDGES: [number, number][] = [];
for (let k = 0; k < 8; k++) for (const bit of [1, 2, 4]) if (!(k & bit)) EDGES.push([k, k | bit]);

export function surfaceNets(nx: number, ny: number, nz: number, size: number, dens: ArrayLike<number>, iso = 0.5): NetMesh {
  const n = [nx, ny, nz];
  const S = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : dens[x + nx * (y + ny * z)]);
  const cx = nx + 1;
  const cy = ny + 1;
  const cube = (x: number, y: number, z: number) => x + 1 + cx * (y + 1 + cy * (z + 1));
  const vert = new Int32Array(cx * cy * (nz + 1)).fill(-1);
  const pos: number[] = [];
  const corners: number[] = [];
  const vals = new Float64Array(8);
  let count = 0;

  for (let z = -1; z < nz; z++)
    for (let y = -1; y < ny; y++)
      for (let x = -1; x < nx; x++) {
        let mask = 0;
        for (let k = 0; k < 8; k++) {
          const v = S(x + (k & 1), y + ((k >> 1) & 1), z + ((k >> 2) & 1));
          vals[k] = v;
          if (v > iso) mask |= 1 << k;
        }
        if (mask === 0 || mask === 255) continue;
        let px = 0;
        let py = 0;
        let pz = 0;
        let m = 0;
        for (const [a, b] of EDGES) {
          if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
          const t = (iso - vals[a]) / (vals[b] - vals[a]);
          px += (a & 1) + ((b & 1) - (a & 1)) * t;
          py += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          pz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          m++;
        }
        vert[cube(x, y, z)] = count++;
        pos.push((x + px / m + 0.5 - nx / 2) * size, (y + py / m + 0.5) * size, (z + pz / m + 0.5 - nz / 2) * size);
        for (let k = 0; k < 8; k++) {
          const ix = x + (k & 1);
          const iy = y + ((k >> 1) & 1);
          const iz = z + ((k >> 2) & 1);
          corners.push(mask & (1 << k) && ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz ? ix + nx * (iy + ny * iz) : -1);
        }
      }

  // Quads across every cell edge whose ends are on different sides of the surface.
  const idx: number[] = [];
  const p = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3;
    const c = (a + 2) % 3;
    for (let pc = 0; pc < n[c]; pc++)
      for (let pb = 0; pb < n[b]; pb++)
        for (let pa = -1; pa < n[a]; pa++) {
          p[a] = pa;
          p[b] = pb;
          p[c] = pc;
          const s0 = S(p[0], p[1], p[2]) > iso;
          p[a] = pa + 1;
          const s1 = S(p[0], p[1], p[2]) > iso;
          if (s0 === s1) continue;
          p[a] = pa;
          const at = (ob: number, oc: number) => {
            const q = [p[0], p[1], p[2]];
            q[b] += ob;
            q[c] += oc;
            return vert[cube(q[0], q[1], q[2])];
          };
          const v00 = at(-1, -1);
          const v10 = at(0, -1);
          const v11 = at(0, 0);
          const v01 = at(-1, 0);
          if (v00 < 0 || v10 < 0 || v11 < 0 || v01 < 0) continue;
          if (s0) idx.push(v00, v10, v11, v00, v11, v01);
          else idx.push(v00, v11, v10, v00, v01, v11);
        }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), corners: Int32Array.from(corners), vertexCount: count };
}
