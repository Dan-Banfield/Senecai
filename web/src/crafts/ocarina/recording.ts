// Session-only takes: record frames, sample them by time, and play them back.

import type { Dof6 } from '../../robot/retarget';
import type { Side } from '../../rokoko/types';
import type { Take, TakeFrame } from './types';

let takeSeq = 0;

const copySides = <T extends readonly number[]>(src: Partial<Record<Side, T>>): Partial<Record<Side, T>> => {
  const out: Partial<Record<Side, T>> = {};
  for (const side of ['left', 'right'] as const) {
    const v = src[side];
    if (v) out[side] = [...v] as unknown as T;
  }
  return out;
};

export class TakeRecorder {
  private startedAt = 0;
  private active = false;
  private frames: TakeFrame[] = [];
  private count = 0;

  get recording(): boolean {
    return this.active;
  }

  start(now: number): void {
    this.startedAt = now;
    this.frames = [];
    this.active = true;
  }

  /** Stores a deep copy of `data` stamped with ms since start. No-op when not recording. */
  frame(now: number, data: Omit<TakeFrame, 't'>): void {
    if (!this.active) return;
    this.frames.push({
      t: now - this.startedAt,
      dof: copySides<Dof6>(data.dof),
      holes: [...data.holes],
      midi: data.midi,
      inspire: copySides<number[]>(data.inspire),
    });
  }

  /** Ends recording; null when nothing was captured. */
  stop(now: number): Take | null {
    if (!this.active) return null;
    this.active = false;
    const frames = this.frames;
    this.frames = [];
    if (!frames.length) return null;
    this.count++;
    return {
      id: `take-${Date.now().toString(36)}-${++takeSeq}`,
      name: `Take ${this.count}`,
      createdAt: Date.now(),
      durationMs: Math.max(now - this.startedAt, frames[frames.length - 1].t),
      frames,
    };
  }
}

/** Shortest take a crop can leave. */
export const MIN_CROP_MS = 200;

/**
 * The part of `take` between `startMs` and `endMs`, re-timed to start at 0.
 * The pose held at `startMs` (the latest earlier frame) opens the crop, so it
 * starts exactly as the original looked at that moment. Gets a fresh id.
 */
export function cropTake(take: Take, startMs: number, endMs: number): Take {
  const start = Math.max(0, Math.min(startMs, take.durationMs));
  const end = Math.max(start + MIN_CROP_MS, Math.min(endMs, take.durationMs));
  const frames: TakeFrame[] = [];
  const opening = sampleTake(take, start);
  if (opening && opening.t < start) frames.push({ ...opening, t: 0 });
  for (const f of take.frames) if (f.t >= start && f.t <= end) frames.push({ ...f, t: f.t - start });
  return {
    id: `take-${Date.now().toString(36)}-${++takeSeq}`,
    name: take.name,
    createdAt: Date.now(),
    durationMs: end - start,
    frames,
  };
}

/** Latest frame at or before `t`; undefined before the first frame. */
export function sampleTake(take: Take, t: number): TakeFrame | undefined {
  const f = take.frames;
  let lo = 0;
  let hi = f.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (f[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found < 0 ? undefined : f[found];
}

export class TakePlayer {
  private t = 0;

  constructor(readonly take: Take) {}

  get time(): number {
    return this.t;
  }

  get done(): boolean {
    return this.t > this.take.durationMs;
  }

  tick(dtMs: number): TakeFrame | undefined {
    this.t += dtMs;
    return sampleTake(this.take, this.t);
  }

  /** Jumps to `ms` (clamped to the take) and returns the frame there. */
  seek(ms: number): TakeFrame | undefined {
    this.t = Math.min(this.take.durationMs, Math.max(0, Number.isFinite(ms) ? ms : 0));
    return sampleTake(this.take, this.t);
  }
}
