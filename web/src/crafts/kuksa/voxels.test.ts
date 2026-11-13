import { describe, expect, it } from 'vitest';
import { analyseTarget, carveSphere, CELLS, decodeShape, DIM, encodeShape, idx, makeTarget, measureProgress, raycast, VoxelGrid } from './voxels';

describe('kuksa voxels', () => {
  const target = makeTarget();
  const a = analyseTarget(target);

  it('target is a plausible cup: has material, a hollow, and fits the block', () => {
    expect(a.targetTotal).toBeGreaterThan(1500);
    expect(a.cavityTotal).toBeGreaterThan(500);
    expect(a.targetTotal).toBeLessThan(CELLS * 0.5);
    // Bowl centre at the rim is hollow; below the bottom is solid wall.
    expect(target.get(12, DIM.y - 1, 13)).toBe(0);
  });

  it('progress goes 0 -> 100 when carving exactly the waste', () => {
    const g = new VoxelGrid();
    expect(measureProgress(g, target, a).overall).toBe(0);
    const waste: number[] = [];
    for (let i = 0; i < CELLS; i++) if (!target.data[i]) waste.push(i);
    g.removeCells(waste);
    const p = measureProgress(g, target, a);
    expect(p.overall).toBe(1);
    expect(p.cavity).toBe(1);
    expect(p.score).toBe(100);
  });

  it('overcutting is penalised', () => {
    const g = target.clone();
    carveSphere(g, 12, 10, 13, 6);
    const p = measureProgress(g, target, a);
    expect(p.overcut).toBeGreaterThan(0);
    expect(p.score).toBeLessThan(100);
  });

  it('raycast hits the first solid voxel', () => {
    const g = new VoxelGrid(new Uint8Array(CELLS));
    g.data[idx(5, 5, 5)] = 1;
    g.data[idx(9, 5, 5)] = 1;
    const hit = raycast(g, [-3, 5.5, 5.5], [1, 0, 0]);
    expect(hit?.cell).toEqual([5, 5, 5]);
    expect(raycast(g, [-3, 15.5, 5.5], [1, 0, 0])).toBeNull();
  });

  it('shape encoding round-trips', () => {
    const s = encodeShape(target);
    expect(decodeShape(s).data).toEqual(target.data);
    expect(s.length).toBeLessThan(20000);
  });
});
