// Seed melody -> replayable Take: fingers ease between fingerings at 60 fps,
// with a fixed per-song PRNG so it looks human but is identical every call.

import { toInspireAngles, type Dof6 } from '../../../robot/retarget';
import type { Side } from '../../../rokoko/types';
import { fingeringFor } from '../fingering';
import { scheduleSong } from '../lesson';
import { HOLES, type HoleStates, type Song, type Take, type TakeFrame } from '../types';
import type { MarketSongMeta, NoteRange } from './types';
import type { SeedSong } from './seeds';

const FRAME_MS = 1000 / 60;
/** Hands hold the first fingering silently before the first note. */
const LEAD_MS = 400;
const TAIL_MS = 300;
/** Silence between repeated identical notes (tonguing). */
const GAP_MS = 40;
const EASE_MIN_MS = 60;
const EASE_MAX_MS = 90;
const COVERED = 0.92;
const OPEN = 0.12;
/** Max per-finger deviation from COVERED/OPEN. */
const JITTER = 0.05;
const THUMB_ROTATE = 0.3;
const SIDES: readonly Side[] = ['left', 'right'];

interface Segment {
  start: number;
  holes: HoleStates;
  midi: number | null;
}

/** FNV-1a. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (x: number) => x * x * (3 - 2 * x);

function holesFor(midi: number): HoleStates {
  const f = fingeringFor(midi);
  if (!f) throw new Error(`No fingering for MIDI ${midi}`);
  return f;
}

/** Timeline of what's fingered and sounding, starting at t = 0 (lead-in). */
function segmentsOf(song: Song): { segments: Segment[]; endMs: number } {
  const { events, totalMs } = scheduleSong(song);
  const first = events.find((e) => e.midi !== null);
  let held = first ? holesFor(first.midi!) : HOLES.map(() => false);
  const segments: Segment[] = [{ start: 0, holes: held, midi: null }];
  events.forEach((ev, i) => {
    const start = LEAD_MS + ev.startMs;
    if (ev.midi === null) {
      segments.push({ start, holes: held, midi: null });
      return;
    }
    held = holesFor(ev.midi);
    segments.push({ start, holes: held, midi: ev.midi });
    if (events[i + 1]?.midi === ev.midi) segments.push({ start: start + ev.durMs - GAP_MS, holes: held, midi: null });
  });
  const endMs = LEAD_MS + totalMs + TAIL_MS;
  segments.push({ start: LEAD_MS + totalMs, holes: held, midi: null });
  return { segments, endMs };
}

const lastFrameT = (endMs: number) => Math.floor(endMs / FRAME_MS + 1e-9) * FRAME_MS;

/** Deterministic: the same seed always produces a deep-equal take. */
export function songToTake(seed: SeedSong): Take {
  const rand = mulberry32(hash(seed.id));
  const { segments, endMs } = segmentsOf(seed.song);
  const covered = HOLES.map(() => clamp01(COVERED + (rand() * 2 - 1) * JITTER));
  const open = HOLES.map(() => clamp01(OPEN + (rand() * 2 - 1) * JITTER));
  const target = (i: number, holes: HoleStates) => (holes[i] ? covered[i] : open[i]);

  // Per-hole ease: value goes from `from` to `to` over `dur` ms starting at `t0`.
  const ease = HOLES.map((_, i) => {
    const v = target(i, segments[0].holes);
    return { from: v, to: v, t0: 0, dur: EASE_MIN_MS };
  });
  const valueAt = (i: number, t: number) => {
    const e = ease[i];
    const x = clamp01((t - e.t0) / e.dur);
    return e.from + (e.to - e.from) * smoothstep(x);
  };

  const frames: TakeFrame[] = [];
  const n = Math.round(lastFrameT(endMs) / FRAME_MS);
  let seg = 0;
  for (let k = 0; k <= n; k++) {
    const t = k * FRAME_MS;
    while (seg + 1 < segments.length && segments[seg + 1].start <= t) {
      seg++;
      const s = segments[seg];
      HOLES.forEach((_, i) => {
        const to = target(i, s.holes);
        if (to === ease[i].to) return;
        ease[i] = { from: valueAt(i, s.start), to, t0: s.start, dur: EASE_MIN_MS + rand() * (EASE_MAX_MS - EASE_MIN_MS) };
      });
    }
    const { holes, midi } = segments[seg];
    const dof: Record<Side, Dof6> = {
      left: [THUMB_ROTATE, 0, 0, 0, 0, 0],
      right: [THUMB_ROTATE, 0, 0, 0, 0, 0],
    };
    HOLES.forEach((h, i) => {
      dof[h.side][h.dofIndex] = valueAt(i, t);
    });
    const inspire: Record<Side, number[]> = { left: [], right: [] };
    for (const side of SIDES) inspire[side] = toInspireAngles(dof[side]);
    frames.push({ t, dof, holes: [...holes], midi, inspire });
  }

  return {
    id: seed.id,
    name: seed.title,
    createdAt: seed.createdAt,
    durationMs: frames[frames.length - 1].t,
    frames,
  };
}

/** Lowest/highest sounding MIDI note, or null when the take never sounds. */
export function noteRangeOf(take: Take): NoteRange | null {
  let low = Infinity;
  let high = -Infinity;
  for (const f of take.frames) {
    if (f.midi === null) continue;
    if (f.midi < low) low = f.midi;
    if (f.midi > high) high = f.midi;
  }
  return low === Infinity ? null : { low, high };
}

/** A seed's listing data without generating its frames (matches songToTake). */
export function seedMeta(seed: SeedSong): MarketSongMeta {
  const { segments, endMs } = segmentsOf(seed.song);
  const notes = segments.flatMap((s) => (s.midi === null ? [] : [s.midi]));
  return {
    id: seed.id,
    title: seed.title,
    artist: seed.artist,
    createdAt: seed.createdAt,
    durationMs: lastFrameT(endMs),
    noteRange: notes.length ? { low: Math.min(...notes), high: Math.max(...notes) } : null,
    mine: false,
  };
}
