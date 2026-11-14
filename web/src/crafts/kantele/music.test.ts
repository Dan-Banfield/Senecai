import { describe, expect, it } from 'vitest';
import { PluckDetector, pluckVelocity, STRING_DOF } from './music';

/** DoF vector with the given string's DoF set to v, everything else open. */
function dofFor(string: number, v: number): number[] {
  const dof = [0, 0, 0, 0, 0, 0];
  dof[STRING_DOF[string]] = v;
  return dof;
}

/** Eased curl from 0.1 to 0.9 over durMs, i.e. the same physical motion at any frame rate. */
function curl(tMs: number, durMs: number): number {
  const x = Math.min(1, Math.max(0, tMs / durMs));
  return 0.1 + 0.8 * (0.5 - 0.5 * Math.cos(Math.PI * x));
}

/** Samples a curl at the given fps and returns the plucks detected on string 1. */
function pluckAt(fps: number, durMs: number) {
  const det = new PluckDetector();
  const dt = 1000 / fps;
  const plucks: { string: number; velocity: number }[] = [];
  det.update(dofFor(1, curl(0, durMs)), dt);
  for (let t = dt; t <= durMs + 200; t += dt) plucks.push(...det.update(dofFor(1, curl(t, durMs)), dt));
  return plucks;
}

describe('PluckDetector', () => {
  it('gives a fast rise a higher velocity than a slow rise', () => {
    const fast = pluckAt(60, 120);
    const slow = pluckAt(60, 700);
    expect(fast).toHaveLength(1);
    expect(slow).toHaveLength(1);
    expect(fast[0].velocity).toBeGreaterThan(slow[0].velocity + 0.3);
    expect(slow[0].velocity).toBeLessThan(0.6);
    expect(fast[0].velocity).toBeGreaterThan(0.9);
  });

  it('is frame-rate independent for the same motion', () => {
    for (const dur of [150, 300, 600]) {
      const a = pluckAt(30, dur);
      const b = pluckAt(120, dur);
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(Math.abs(a[0].velocity - b[0].velocity)).toBeLessThan(0.1);
    }
  });

  it('keeps velocity within [0.35, 1]', () => {
    for (const [delta, dt] of [
      [0.001, 16],
      [0.9, 1],
      [5, 0.0001],
      [-0.2, 16],
      [0.3, 0],
      [0.3, -5],
    ]) {
      const v = pluckVelocity(delta, dt);
      expect(v).toBeGreaterThanOrEqual(0.35);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(pluckVelocity(0.03, 16)).toBeCloseTo(0.25 + (0.03 / 0.016) * 0.085, 6);
  });

  it('does not re-trigger until the finger drops below off', () => {
    const det = new PluckDetector(0.55, 0.38);
    expect(det.update(dofFor(2, 0.1), 16)).toHaveLength(0);
    expect(det.update(dofFor(2, 0.6), 16)).toEqual([expect.objectContaining({ string: 2 })]);
    // Wobbling above off (but dipping below on) must not pluck again.
    expect(det.update(dofFor(2, 0.45), 16)).toHaveLength(0);
    expect(det.update(dofFor(2, 0.7), 16)).toHaveLength(0);
    expect(det.update(dofFor(2, 0.4), 16)).toHaveLength(0);
    expect(det.update(dofFor(2, 0.6), 16)).toHaveLength(0);
    // Release below off re-arms; the next rise plucks again.
    expect(det.update(dofFor(2, 0.3), 16)).toHaveLength(0);
    expect(det.update(dofFor(2, 0.6), 16)).toEqual([expect.objectContaining({ string: 2 })]);
  });

  it('reset() with curled fingers suppresses plucks until they extend below off and curl again', () => {
    const det = new PluckDetector(0.55, 0.38);
    // Hand lost, then returns with index curled, middle half-curled (between off and on), ring open.
    const back = [0, 0, 0.8, 0.45, 0.1, 0];
    det.reset(back);
    expect(det.update(back, 16)).toHaveLength(0);
    // Middle rising past on without first extending must not pluck.
    expect(det.update([0, 0, 0.8, 0.7, 0.1, 0], 16)).toHaveLength(0);
    // Ring was open at reset, so it is armed and plucks normally.
    expect(det.update([0, 0, 0.8, 0.7, 0.7, 0], 16)).toEqual([expect.objectContaining({ string: 3 })]);
    // Extend index and middle below off, then curl again: now they pluck.
    expect(det.update([0, 0, 0.2, 0.2, 0.7, 0], 16)).toHaveLength(0);
    const again = det.update([0, 0, 0.8, 0.8, 0.7, 0], 16);
    expect(again.map((p) => p.string).sort()).toEqual([1, 2]);
  });

  it('reset() without a pose arms every string', () => {
    const det = new PluckDetector(0.55, 0.38);
    det.reset([0, 0.9, 0.9, 0.9, 0.9, 0.9]);
    det.reset();
    expect(det.update(dofFor(4, 0.6), 16)).toEqual([expect.objectContaining({ string: 4 })]);
  });
});
