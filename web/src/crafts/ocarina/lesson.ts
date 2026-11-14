// Lesson timing and scoring: timed (play at tempo) or wait-for-me (advance on the held note).

import { noteToMidi } from './fingering';
import type { Song } from './types';

/** A scheduled note in song time (0 = first note, after the count-in). */
export interface NoteEvent {
  index: number;
  midi: number | null;
  startMs: number;
  durMs: number;
}

export function scheduleSong(song: Song): { events: NoteEvent[]; countInMs: number; totalMs: number } {
  const beatMs = 60000 / song.bpm;
  let t = 0;
  const events = song.notes.map((n, index) => {
    const ev: NoteEvent = { index, midi: noteToMidi(n.note), startMs: t, durMs: n.beats * beatMs };
    t += ev.durMs;
    return ev;
  });
  return { events, countInMs: song.beatsPerBar * beatMs, totalMs: t };
}

export type NoteResult = 'pending' | 'hit' | 'miss' | 'rest';

/** Timed mode: share of a note's duration the right pitch must sound. */
const HIT_FRACTION = 0.5;
/** Wait mode: how long the right note must be held before the melody moves on. */
const HOLD_MS = 300;
const EPS = 1e-6;

export class Lesson {
  readonly song: Song;
  readonly wait: boolean;
  readonly events: NoteEvent[];
  private time: number;
  private cur = 0;
  private res: NoteResult[];
  private acc: number[];
  private hold = 0;

  constructor(song: Song, opts: { wait: boolean }) {
    this.song = song;
    this.wait = opts.wait;
    const s = scheduleSong(song);
    this.events = s.events;
    this.time = -s.countInMs;
    this.res = this.events.map(() => 'pending');
    this.acc = this.events.map(() => 0);
  }

  get state(): 'countin' | 'playing' | 'done' {
    if (this.time < 0) return 'countin';
    return this.cur >= this.events.length ? 'done' : 'playing';
  }

  get songTime(): number {
    return this.time;
  }

  get current(): number {
    return this.cur;
  }

  get results(): NoteResult[] {
    return [...this.res];
  }

  get hitPercent(): number {
    let hits = 0;
    let scored = 0;
    for (const r of this.res) {
      if (r === 'hit') hits++;
      if (r === 'hit' || r === 'miss') scored++;
    }
    return scored ? (hits * 100) / scored : 0;
  }

  get stars(): 0 | 1 | 2 | 3 {
    const p = this.hitPercent;
    return p >= 95 ? 3 : p >= 80 ? 2 : p >= 60 ? 1 : 0;
  }

  tick(dtMs: number, playedMidi: number | null): void {
    let left = Math.max(0, dtMs);
    for (;;) {
      if (this.time < 0) {
        if (left <= 0) return;
        const step = Math.min(left, -this.time);
        this.time = step === -this.time ? 0 : this.time + step;
        left -= step;
        continue;
      }
      if (this.cur >= this.events.length) return;
      const ev = this.events[this.cur];
      const end = ev.startMs + ev.durMs;
      const correct = ev.midi !== null && playedMidi === ev.midi;

      if (this.time >= end) {
        if (ev.midi === null) this.settle('rest');
        else if (!this.wait) this.settle(this.acc[this.cur] >= ev.durMs * HIT_FRACTION - EPS ? 'hit' : 'miss');
        else if (this.hold >= HOLD_MS - EPS) this.settle('hit');
        else if (left <= 0) return;
        else if (correct) {
          const step = Math.min(left, HOLD_MS - this.hold);
          this.hold += step;
          left -= step;
        } else {
          this.hold = 0;
          return;
        }
        continue;
      }

      if (left <= 0) return;
      const step = Math.min(left, end - this.time);
      this.time = step === end - this.time ? end : this.time + step;
      left -= step;
      if (correct) {
        this.acc[this.cur] += step;
        this.hold += step;
      } else {
        this.hold = 0;
      }
    }
  }

  private settle(r: NoteResult): void {
    this.res[this.cur] = r;
    this.cur++;
    this.hold = 0;
  }
}
