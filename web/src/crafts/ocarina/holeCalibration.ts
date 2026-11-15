// Ocarina hole calibration: measures how far each finger really bends when it
// covers its hole versus when it hovers above it, and turns that into per-hole
// cover thresholds for the HoleTracker. Saved per input source, on top of the
// usual open/fist hand calibration (whose normalised flexion it is measured in).

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Dof6 } from '../../robot/retarget';
import type { Side } from '../../rokoko/types';
import { HOLES } from './types';

/** Mean flexion per hole (indexed like HOLES); null = that hand was not tracked. */
export type HoleReadings = (number | null)[];

export interface HoleCalibration {
  /** Every finger lifted, hovering just above its hole. */
  open: HoleReadings;
  /** Every hole covered (the C5 pose). */
  covered: HoleReadings;
}

export interface HoleThreshold {
  /** Covered at >= on, uncovered below off. */
  on: number;
  off: number;
}

/** Below this much difference between hovering and covering, a finger can't be told apart: keep its defaults. */
export const MIN_SPAN = 0.06;
/** Where between hover (0) and cover (1) the hysteresis band sits. */
export const ON_AT = 0.5;
export const OFF_AT = 0.3;

export const DEFAULT_THRESHOLDS: readonly HoleThreshold[] = HOLES.map((h) => ({ on: h.coverOn, off: h.coverOff }));

/** Mean flexion of each hole's finger over the samples (frames where its hand was missing are skipped). */
export function meanReadings(samples: readonly Partial<Record<Side, Dof6>>[]): HoleReadings {
  return HOLES.map((h) => {
    let sum = 0;
    let n = 0;
    for (const s of samples) {
      const v = s[h.side]?.[h.dofIndex];
      if (v === undefined || !Number.isFinite(v)) continue;
      sum += v;
      n++;
    }
    return n ? sum / n : null;
  });
}

/** Hover-to-cover span for hole i, or null when either reading is missing. */
function spanOf(cal: HoleCalibration, i: number): number | null {
  const o = cal.open[i];
  const c = cal.covered[i];
  return o == null || c == null ? null : c - o;
}

/** Per-hole thresholds; holes without a usable measurement keep their defaults. */
export function thresholdsFrom(cal: HoleCalibration | undefined): HoleThreshold[] {
  return HOLES.map((_, i) => {
    const span = cal ? spanOf(cal, i) : null;
    if (span === null || span < MIN_SPAN) return { ...DEFAULT_THRESHOLDS[i] };
    const o = cal!.open[i]!;
    return { on: o + span * ON_AT, off: o + span * OFF_AT };
  });
}

/** Holes whose finger barely moved (or moved the wrong way) between hovering and covering. */
export function weakHoles(cal: HoleCalibration): number[] {
  return HOLES.flatMap((_, i) => {
    const span = spanOf(cal, i);
    return span !== null && span < MIN_SPAN ? [i] : [];
  });
}

/** Holes that weren't measured because their hand wasn't tracked. */
export function missingHoles(cal: HoleCalibration): number[] {
  return HOLES.flatMap((_, i) => (spanOf(cal, i) === null ? [i] : []));
}

interface HoleCalibrationStore {
  /** By input source kind. */
  bySource: Record<string, HoleCalibration>;
  save(kind: string, cal: HoleCalibration): void;
  clear(kind: string): void;
}

const validReadings = (r: unknown): r is HoleReadings =>
  Array.isArray(r) && r.length === HOLES.length && r.every((v) => v === null || (typeof v === 'number' && Number.isFinite(v)));

export const useHoleCalibration = create<HoleCalibrationStore>()(
  persist(
    (set, get) => ({
      bySource: {},
      save: (kind, cal) => set({ bySource: { ...get().bySource, [kind]: cal } }),
      clear(kind) {
        if (!(kind in get().bySource)) return;
        const bySource = { ...get().bySource };
        delete bySource[kind];
        set({ bySource });
      },
    }),
    {
      name: 'senecai.ocarina.holes.v1',
      partialize: (s) => ({ bySource: s.bySource }),
      merge: (persisted, current) => {
        const raw = ((persisted ?? {}) as { bySource?: Record<string, Partial<HoleCalibration>> }).bySource ?? {};
        const bySource: Record<string, HoleCalibration> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (v && validReadings(v.open) && validReadings(v.covered)) bySource[k] = { open: v.open, covered: v.covered };
        }
        return { ...current, bySource };
      },
    },
  ),
);

/** How long a pose has to be held steady before it is captured. */
export const HOLD_MS = 1500;
/** How far (normalised flexion) a held finger may wander and still count as steady. */
export const STEADY_TOL = 0.04;

/**
 * Detects a held pose: tracks how long a set of values has stayed within
 * STEADY_TOL of their running mean. Any value wandering further restarts the hold.
 */
export class SteadyDetector {
  private since = 0;
  private sum: number[] = [];
  private n = 0;

  constructor(
    private readonly holdMs = HOLD_MS,
    private readonly tol = STEADY_TOL,
  ) {}

  /** Feed one reading at time t (ms); returns hold progress 0..1 (1 = held long enough). */
  push(t: number, values: readonly number[]): number {
    const restart = () => {
      this.since = t;
      this.sum = [...values];
      this.n = 1;
    };
    if (this.n === 0 || values.length !== this.sum.length) restart();
    else if (values.some((v, i) => Math.abs(v - this.sum[i] / this.n) > this.tol)) restart();
    else {
      values.forEach((v, i) => (this.sum[i] += v));
      this.n++;
    }
    return Math.min(1, (t - this.since) / this.holdMs);
  }

  /** Mean of the values over the current hold. */
  get mean(): number[] {
    return this.sum.map((s) => s / Math.max(1, this.n));
  }

  reset(): void {
    this.n = 0;
    this.sum = [];
  }
}
