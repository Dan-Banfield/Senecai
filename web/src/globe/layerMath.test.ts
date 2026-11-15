import { describe, expect, it } from 'vitest';
import { graticule } from './atlas';
import { compactRanges, interpolatePath, pathSegments, polar2Cartesian, quadInOut, shaderRgba } from './layerMath';

describe('atlas layer maths', () => {
  it('uses three-globe polar coordinates (y up, lng 0 towards +z)', () => {
    const p = [0, 0, 0];
    polar2Cartesian(0, 0, 0, p, 0);
    expect(p.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 100]);
    polar2Cartesian(90, 0, 0.5, p, 0);
    expect(p[1]).toBeCloseTo(150);
    polar2Cartesian(0, 90, 0, p, 0);
    expect(p[0]).toBeCloseTo(100);
  });

  it('densifies paths like three-globe pathResolution', () => {
    const pts = interpolatePath(
      [
        [0, 0, 0.1],
        [0, 4, 0.1],
      ],
      2,
    );
    expect(pts.map((p) => p[1])).toEqual([0, 4 / 3, 8 / 3, 4]);
    // Short way across the antimeridian: the earlier point is shifted by 360.
    const am = interpolatePath(
      [
        [0, 179, 0],
        [0, -179, 0],
      ],
      2,
    );
    expect(am.map((p) => p[1])).toEqual([-181, -179]);
  });

  it('turns the graticule into the same segments as its line strips', () => {
    const lines = graticule().map((l) => l.pts);
    const segs = pathSegments(lines, 0.0062, 2);
    // Meridians: 41 points, 3 segments per 4 degree step; parallels: 91 points.
    expect(segs.length / 6).toBe(24 * 40 * 3 + 11 * 90 * 3);
    const r = Math.hypot(segs[0], segs[1], segs[2]);
    expect(r).toBeCloseTo(100.62, 3);
  });

  it('gives the sRGB colour three-globe writes from its line shader', () => {
    const [r, g, b, a] = shaderRgba('rgba(78,61,43,0.22)');
    expect(r).toBeCloseTo(78 / 255, 4);
    expect(g).toBeCloseTo(61 / 255, 4);
    expect(b).toBeCloseTo(43 / 255, 4);
    expect(a).toBe(0.22);
  });

  it('eases like Quadratic.InOut', () => {
    expect(quadInOut(0)).toBe(0);
    expect(quadInOut(0.25)).toBeCloseTo(0.125);
    expect(quadInOut(0.5)).toBeCloseTo(0.5);
    expect(quadInOut(0.75)).toBeCloseTo(0.875);
    expect(quadInOut(1)).toBe(1);
  });

  it('compacts index ranges, skipping items', () => {
    const src = Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const ranges = [
      { start: 0, count: 3 },
      { start: 3, count: 2 },
      { start: 5, count: 4 },
    ];
    const dst = new Uint32Array(src.length);
    expect(compactRanges(src, ranges, () => false, dst)).toBe(9);
    expect([...dst]).toEqual([...src]);
    dst.fill(99);
    const n = compactRanges(src, ranges, (i) => i === 1, dst);
    expect(n).toBe(7);
    expect([...dst.subarray(0, n)]).toEqual([0, 1, 2, 5, 6, 7, 8]);
    expect(compactRanges(src, ranges, () => true, dst)).toBe(0);
  });
});
