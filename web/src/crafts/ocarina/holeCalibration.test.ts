import { describe, expect, it } from 'vitest';
import type { Dof6 } from '../../robot/retarget';
import { HoleTracker } from './fingering';
import { DEFAULT_THRESHOLDS, meanReadings, MIN_SPAN, missingHoles, SteadyDetector, thresholdsFrom, weakHoles, type HoleCalibration } from './holeCalibration';
import { HOLES } from './types';

const flat = (v: number): Dof6 => [v, v, v, v, v, v];
const all = (v: number | null) => HOLES.map(() => v);

describe('meanReadings', () => {
  it('averages each hole over the frames where its hand was tracked', () => {
    const r = meanReadings([{ left: flat(0.2), right: flat(0.4) }, { right: flat(0.6) }]);
    HOLES.forEach((h, i) => expect(r[i], h.id).toBeCloseTo(h.side === 'left' ? 0.2 : 0.5));
  });

  it('is null for a hand never seen', () => {
    const r = meanReadings([{ right: flat(0.5) }]);
    HOLES.forEach((h, i) => expect(r[i] === null, h.id).toBe(h.side === 'left'));
  });
});

describe('thresholdsFrom', () => {
  it('uses the defaults without a calibration', () => {
    expect(thresholdsFrom(undefined)).toEqual(DEFAULT_THRESHOLDS);
  });

  it('puts the hysteresis band between hover and cover', () => {
    const t = thresholdsFrom({ open: all(0.1), covered: all(0.3) });
    for (const x of t) {
      expect(x.on).toBeCloseTo(0.2);
      expect(x.off).toBeCloseTo(0.16);
      expect(x.off).toBeLessThan(x.on);
    }
  });

  it('keeps the defaults for weak or unmeasured fingers, and reports them', () => {
    const cal: HoleCalibration = { open: all(0.1), covered: all(0.4) };
    cal.covered[0] = 0.1 + MIN_SPAN / 2; // R.little barely moved
    cal.covered[3] = 0.05; // R.index went the wrong way
    cal.open[8] = null; // L.thumb not tracked
    const t = thresholdsFrom(cal);
    for (const i of [0, 3, 8]) expect(t[i]).toEqual(DEFAULT_THRESHOLDS[i]);
    expect(t[1].on).toBeCloseTo(0.25);
    expect(weakHoles(cal)).toEqual([0, 3]);
    expect(missingHoles(cal)).toEqual([8]);
  });
});

describe('HoleTracker with calibrated thresholds', () => {
  it('covers a light bend once calibrated for it', () => {
    const t = new HoleTracker();
    const light = { left: flat(0.18), right: flat(0.18) };
    expect(t.update(light).some(Boolean)).toBe(false);
    t.setThresholds(thresholdsFrom({ open: all(0.05), covered: all(0.2) }));
    expect(t.update(light).every(Boolean)).toBe(true);
    t.setThresholds(undefined);
    t.reset();
    expect(t.update(light).some(Boolean)).toBe(false);
  });
});

describe('SteadyDetector', () => {
  it('reaches 1 after holding within tolerance, and averages the hold', () => {
    const d = new SteadyDetector(1000, 0.05);
    expect(d.push(0, [0.3])).toBe(0);
    expect(d.push(500, [0.32])).toBeCloseTo(0.5);
    expect(d.push(1000, [0.28])).toBe(1);
    expect(d.mean[0]).toBeCloseTo(0.3);
  });

  it('restarts when any value moves too far', () => {
    const d = new SteadyDetector(1000, 0.05);
    d.push(0, [0.1, 0.5]);
    d.push(800, [0.1, 0.5]);
    expect(d.push(900, [0.1, 0.7])).toBe(0);
    expect(d.push(1400, [0.1, 0.7])).toBeCloseTo(0.5);
    d.reset();
    expect(d.push(2000, [0.4, 0.4])).toBe(0);
  });
});
