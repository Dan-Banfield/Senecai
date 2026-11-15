// Pure helpers behind the merged atlas layers (layers.ts). They port the bits
// of three-globe we must reproduce exactly, so they are kept free of WebGL and
// unit tested in node.

import { Color } from 'three';

/** three-globe's GLOBE_RADIUS. */
export const GLOBE_RADIUS = 100;

/** three-globe's polar2Cartesian, writing [x, y, z] into `out` at `o`. */
export function polar2Cartesian(lat: number, lng: number, relAltitude: number, out: Float32Array | number[], o: number) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((90 - lng) * Math.PI) / 180;
  const r = GLOBE_RADIUS * (1 + relAltitude);
  const phiSin = Math.sin(phi);
  out[o] = r * phiSin * Math.cos(theta);
  out[o + 1] = r * Math.cos(phi);
  out[o + 2] = r * phiSin * Math.sin(theta);
}

/**
 * The paths layer's point densifier (`calcPath` > `interpolateLine` in
 * three-globe): inserts floor(dist / maxDeg) evenly spaced points between any
 * two points further apart than `maxDeg` in planar lat/lng degrees, taking the
 * short way across the antimeridian.
 */
export function interpolatePath(points: [number, number, number][], maxDeg: number): [number, number, number][] {
  const between = (a: number, b: number, n: number) => {
    const r: number[] = [];
    for (let i = 1; i <= n; i++) r.push(a + ((b - a) * i) / (n + 1));
    return r;
  };
  const out: [number, number, number][] = [];
  let prev: [number, number, number] | null = null;
  for (const src of points) {
    const pnt: [number, number, number] = [src[0], src[1], src[2]];
    if (prev) {
      while (Math.abs(prev[1] - pnt[1]) > 180) prev[1] += 360 * (prev[1] < pnt[1] ? 1 : -1);
      const dist = Math.sqrt((pnt[0] - prev[0]) ** 2 + (pnt[1] - prev[1]) ** 2);
      if (dist > maxDeg) {
        const n = Math.floor(dist / maxDeg);
        const lats = between(prev[0], pnt[0], n);
        const lngs = between(prev[1], pnt[1], n);
        const alts = between(prev[2], pnt[2], n);
        for (let i = 0; i < lats.length; i++) out.push([lats[i], lngs[i], alts[i]]);
      }
    }
    out.push((prev = pnt));
  }
  return out;
}

/**
 * Positions for ONE LineSegments that draws every path the way the paths
 * layer draws each as its own Line strip: densified, at a constant altitude.
 */
export function pathSegments(paths: [number, number][][], alt: number, resolution: number): Float32Array {
  const strips = paths.map((pts) => interpolatePath(pts.map(([lat, lng]) => [lat, lng, alt]), resolution));
  const segs = strips.reduce((n, s) => n + Math.max(0, s.length - 1), 0);
  const out = new Float32Array(segs * 6);
  let o = 0;
  for (const s of strips) {
    for (let i = 1; i < s.length; i++) {
      polar2Cartesian(s[i - 1][0], s[i - 1][1], s[i - 1][2], out, o);
      polar2Cartesian(s[i][0], s[i][1], s[i][2], out, o + 3);
      o += 6;
    }
  }
  return out;
}

/**
 * three-globe's color2ShaderArr(str, true, true): the RGBA its line shader
 * writes straight to gl_FragColor (sRGB values, no output conversion).
 */
export function shaderRgba(str: string): [number, number, number, number] {
  let color: Color;
  let alpha = 1;
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.eE+-]+)\s*\)$/.exec(str.trim().toLowerCase());
  if (m) {
    color = new Color(`rgb(${+m[1]},${+m[2]},${+m[3]})`);
    alpha = Math.min(+m[4], 1);
  } else {
    color = new Color(str);
  }
  color.convertLinearToSRGB();
  return [color.r, color.g, color.b, alpha];
}

/** tween.js Easing.Quadratic.InOut. */
export function quadInOut(k: number) {
  if ((k *= 2) < 1) return 0.5 * k * k;
  return -0.5 * (--k * (k - 2) - 1);
}

export interface IndexRange {
  start: number;
  count: number;
}

/**
 * Copy the index range of every item not skipped from `src` into `dst`,
 * back to back. Returns how many indices were written.
 */
export function compactRanges(src: Uint32Array, ranges: IndexRange[], skip: (item: number) => boolean, dst: Uint32Array): number {
  let n = 0;
  // Runs of kept items are contiguous in src, so copy them in one go.
  let runStart = -1;
  let runEnd = -1;
  const flush = () => {
    if (runStart < 0) return;
    dst.set(src.subarray(runStart, runEnd), n);
    n += runEnd - runStart;
    runStart = -1;
  };
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (skip(i)) {
      flush();
      continue;
    }
    if (runStart >= 0 && r.start === runEnd) runEnd += r.count;
    else {
      flush();
      runStart = r.start;
      runEnd = r.start + r.count;
    }
  }
  flush();
  return n;
}
