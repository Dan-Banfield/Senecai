// Hole coverage from finger flexion, and the Helmholtz pitch model (see SPEC.md §4).

import type { Dof6 } from '../../robot/retarget';
import type { Side } from '../../rokoko/types';
import { DEFAULT_THRESHOLDS, type HoleThreshold } from './holeCalibration';
import { HOLES, SCALE_MIDI, type HoleStates } from './types';

/** Tracks hole coverage per finger with hysteresis. */
export class HoleTracker {
  private states: HoleStates = HOLES.map(() => false);
  private thresholds: readonly HoleThreshold[] = DEFAULT_THRESHOLDS;

  /** Per-hole thresholds from the hole calibration; undefined restores the defaults. */
  setThresholds(t: readonly HoleThreshold[] | undefined): void {
    this.thresholds = t ?? DEFAULT_THRESHOLDS;
  }

  update(dof: Partial<Record<Side, Dof6>>): HoleStates {
    this.states = HOLES.map((h, i) => {
      const v = dof[h.side]?.[h.dofIndex];
      if (v === undefined) return false;
      const { on, off } = this.thresholds[i];
      if (v >= on) return true;
      if (v < off) return false;
      return this.states[i];
    });
    return [...this.states];
  }

  reset(): void {
    this.states = HOLES.map(() => false);
  }
}

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const F0 = freq(SCALE_MIDI[0]);

/** Open area each hole adds (relative to the base area 1), so the lift order hits SCALE_MIDI exactly. */
export const HOLE_AREAS: readonly number[] = HOLES.map(
  (_, k) => (freq(SCALE_MIDI[k + 1]) ** 2 - freq(SCALE_MIDI[k]) ** 2) / F0 ** 2,
);

/** Helmholtz resonance: f = f0 * sqrt(1 + total open area). */
export function frequencyOf(holes: HoleStates): number {
  let area = 1;
  for (let i = 0; i < HOLES.length; i++) if (!holes[i]) area += HOLE_AREAS[i];
  return F0 * Math.sqrt(area);
}

/** Sounding MIDI note (nearest semitone), or null when every hole is open. */
export function pitchOf(holes: HoleStates): number | null {
  if (!HOLES.some((_, i) => holes[i])) return null;
  return Math.round(69 + 12 * Math.log2(frequencyOf(holes) / 440));
}

/** Standard fingering for SCALE_MIDI[k]: the first k holes open. */
const standard = (k: number): HoleStates => HOLES.map((_, i) => i >= k);

const fingeringCache = new Map<number, HoleStates | undefined>();

/** A fingering that plays `midi`, preferring the standard one, else the closest cross-fingering. */
export function fingeringFor(midi: number): HoleStates | undefined {
  if (!fingeringCache.has(midi)) fingeringCache.set(midi, searchFingering(midi));
  const f = fingeringCache.get(midi);
  return f && [...f];
}

function searchFingering(midi: number): HoleStates | undefined {
  const n = HOLES.length;
  const k = SCALE_MIDI.indexOf(midi as (typeof SCALE_MIDI)[number]);
  if (k >= 0 && k < n) return standard(k);
  let lower = 0;
  for (let i = 0; i < n; i++) if (SCALE_MIDI[i] <= midi) lower = i;
  const ref = standard(lower);
  let best: HoleStates | undefined;
  let bestDiff = Infinity;
  for (let mask = 0; mask < 1 << n; mask++) {
    const holes = HOLES.map((_, i) => (mask & (1 << i)) !== 0);
    if (pitchOf(holes) !== midi) continue;
    const diff = holes.reduce((d, c, i) => d + (c !== ref[i] ? 1 : 0), 0);
    if (diff < bestDiff) {
      best = holes;
      bestDiff = diff;
    }
  }
  return best;
}

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** 'C5' -> 72, 'F#5' -> 78, 'Bb5' -> 82, 'rest' -> null (C4 = 60). Throws on anything else. */
export function noteToMidi(name: string): number | null {
  if (name === 'rest') return null;
  const m = /^([A-G])(#|b)?(-?\d+)$/.exec(name);
  if (!m) throw new Error(`Invalid note name: ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + PITCH_CLASS[m[1]] + acc;
}

/** 73 -> 'C#5' (always sharps). */
export function midiToName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  return `${SHARP_NAMES[pc]}${Math.floor(midi / 12) - 1}`;
}
