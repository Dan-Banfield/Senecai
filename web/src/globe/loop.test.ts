import { describe, expect, it } from 'vitest';
import {
  decidePixelRatio,
  easeCubicInOut,
  easeQuadraticOut,
  easeQuinticOut,
  flyPovAt,
  introStateAt,
  tweenPortion,
  unwrapStartLng,
} from './loop';
import { boxChanged, focalPx, silhouetteRadiusPx } from './shadow';
import { fpsFromTimes, mean } from './perfHud';

describe('easings match tween.js', () => {
  it('Cubic.InOut', () => {
    expect(easeCubicInOut(0)).toBe(0);
    expect(easeCubicInOut(1)).toBe(1);
    expect(easeCubicInOut(0.5)).toBeCloseTo(0.5, 12);
    expect(easeCubicInOut(0.25)).toBeCloseTo(0.0625, 12); // 0.5 * 0.5^3
    expect(easeCubicInOut(0.75)).toBeCloseTo(0.9375, 12);
  });
  it('Quadratic.Out and Quintic.Out', () => {
    expect(easeQuadraticOut(0)).toBe(0);
    expect(easeQuadraticOut(1)).toBe(1);
    expect(easeQuadraticOut(0.5)).toBe(0.75);
    expect(easeQuinticOut(0)).toBe(0);
    expect(easeQuinticOut(1)).toBe(1);
    expect(easeQuinticOut(0.5)).toBeCloseTo(1 - 0.5 ** 5, 12);
  });
  it('portion clamps and handles zero duration', () => {
    expect(tweenPortion(-5, 100)).toBe(0);
    expect(tweenPortion(50, 100)).toBe(0.5);
    expect(tweenPortion(500, 100)).toBe(1);
    expect(tweenPortion(0, 0)).toBe(1);
  });
});

describe('flyTo longitude handling (globe.gl pointOfView)', () => {
  it('takes the short way round the antimeridian', () => {
    expect(unwrapStartLng(170, -170)).toBe(-190);
    expect(unwrapStartLng(-170, 170)).toBe(190);
    expect(unwrapStartLng(10, 30)).toBe(10);
    expect(unwrapStartLng(540, 0)).toBe(180); // exactly 180 apart is left alone
    expect(unwrapStartLng(-725, 0)).toBe(-5);
  });
  it('interpolates with Cubic.InOut and lands exactly on the target', () => {
    const from = { lat: 0, lng: unwrapStartLng(170, -170), altitude: 2 };
    const to = { lat: 20, lng: -170, altitude: 1 };
    expect(flyPovAt(from, to, 0, 1000)).toEqual(from);
    const mid = flyPovAt(from, to, 500, 1000);
    expect(mid.lat).toBeCloseTo(10, 9);
    expect(mid.lng).toBeCloseTo(-180, 9);
    expect(mid.altitude).toBeCloseTo(1.5, 9);
    expect(flyPovAt(from, to, 1300, 1000)).toEqual(to);
  });
});

describe('intro (three-globe animateIn)', () => {
  it('scales over 600ms and spins over 1200ms', () => {
    const s0 = introStateAt(0);
    expect(s0.scale).toBeCloseTo(1e-6, 12);
    expect(s0.rotation).toBeCloseTo(Math.PI * 2, 12);
    expect(s0.done).toBe(false);
    const s600 = introStateAt(600);
    expect(s600.scale).toBe(1);
    expect(s600.rotation).toBeCloseTo(Math.PI * 2 * (1 - easeQuinticOut(0.5)), 12);
    const s1200 = introStateAt(1200);
    expect(s1200.rotation).toBe(0);
    expect(s1200.done).toBe(true);
  });
});

describe('adaptive pixel ratio', () => {
  const base = { base: 2, low: 1.25, settleMs: 150 };
  it('drops while moving', () => {
    expect(decidePixelRatio({ ...base, current: 2, moving: true, now: 0, lastMotionAt: 0 })).toEqual({ ratio: 1.25, settleIn: null });
  });
  it('never raises above base', () => {
    expect(decidePixelRatio({ ...base, base: 1, current: 1, moving: true, now: 0, lastMotionAt: 0 }).ratio).toBe(1);
  });
  it('holds the low ratio until motion has settled, then restores', () => {
    expect(decidePixelRatio({ ...base, current: 1.25, moving: false, now: 100, lastMotionAt: 40 })).toEqual({ ratio: 1.25, settleIn: 90 });
    expect(decidePixelRatio({ ...base, current: 1.25, moving: false, now: 190, lastMotionAt: 40 })).toEqual({ ratio: 2, settleIn: null });
  });
  it('stays sharp when idle at base', () => {
    expect(decidePixelRatio({ ...base, current: 2, moving: false, now: 10, lastMotionAt: 5 })).toEqual({ ratio: 2, settleIn: null });
  });
  it('follows a devicePixelRatio change once idle', () => {
    expect(decidePixelRatio({ ...base, base: 1, current: 2, moving: false, now: 1000, lastMotionAt: 0 }).ratio).toBe(1);
  });
});

describe('globe silhouette', () => {
  it('matches f * tan(asin(R/d))', () => {
    const R = 100.5;
    const d = 330;
    const f = 800;
    expect(silhouetteRadiusPx(R, d, f)).toBeCloseTo(f * Math.tan(Math.asin(R / d)), 9);
  });
  it('returns null inside the sphere', () => {
    expect(silhouetteRadiusPx(100, 100, 800)).toBeNull();
    expect(silhouetteRadiusPx(100, 50, 800)).toBeNull();
  });
  it('focal length from the projection matrix', () => {
    // PerspectiveCamera fov 50: elements[5] = 1 / tan(25deg)
    const e = new Array(16).fill(0);
    e[5] = 1 / Math.tan((25 * Math.PI) / 180);
    expect(focalPx(e, 768)).toBeCloseTo(384 / Math.tan((25 * Math.PI) / 180), 9);
  });
  it('only reports changes above a quarter pixel', () => {
    const a = { x: 10, y: 10, size: 200 };
    expect(boxChanged(null, a)).toBe(true);
    expect(boxChanged(a, { x: 10.2, y: 9.8, size: 200.2 })).toBe(false);
    expect(boxChanged(a, { x: 10.3, y: 10, size: 200 })).toBe(true);
    expect(boxChanged(a, { x: 10, y: 10, size: 199.6 })).toBe(true);
  });
});

describe('perf HUD maths', () => {
  it('mean and fps ignore idle gaps', () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
    expect(fpsFromTimes([0, 16, 32, 48])).toBeCloseTo(62.5, 9);
    expect(fpsFromTimes([0, 20, 5000, 5020])).toBeCloseTo(50, 9);
    expect(fpsFromTimes([0])).toBe(0);
  });
});
