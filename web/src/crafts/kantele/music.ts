// The five-string kantele: the oldest form of Finland's national instrument,
// usually tuned to a pentachord. Ours is D E F G A (a D-minor pentachord).
// Traditional playing rests the fingers over the strings, one finger per
// string, which maps directly onto a five-finger hand.

import type { Recording } from '../../recording/recording';

export const STRINGS = [
  { note: 'D', freq: 293.66, finger: 'Thumb' },
  { note: 'E', freq: 329.63, finger: 'Index' },
  { note: 'F', freq: 349.23, finger: 'Middle' },
  { note: 'G', freq: 392.0, finger: 'Ring' },
  { note: 'A', freq: 440.0, finger: 'Little' },
] as const;

/** Which robot DoF plucks each string (thumb uses thumb-bend). */
export const STRING_DOF = [1, 2, 3, 4, 5];

export interface LessonNote {
  t: number; // ms from start
  string: number;
}

export interface Lesson {
  id: string;
  title: string;
  description: string;
  /** Wait for the player on each note instead of keeping time. */
  wait: boolean;
  notes: LessonNote[];
  /** Present when the lesson was generated from a community creation. */
  fromCreation?: { id: string; title: string; author: string; recording: Recording };
}

function fromBeats(bpm: number, beats: [number, number][]): LessonNote[] {
  const ms = 60000 / bpm;
  return beats.map(([beat, string]) => ({ t: Math.round(beat * ms), string }));
}

const seq = (strings: number[], start = 0, step = 1): [number, number][] => strings.map((s, i) => [start + i * step, s]);

// A melody *in the style of* Kalevala runo-song: eight-syllable lines in 5/4,
// moving stepwise within the pentachord and falling back to the tonic.
const RUNO_LINE_A = [0, 1, 2, 2, 3, 2, 1, 1, 0];
const RUNO_LINE_B = [2, 3, 4, 4, 3, 2, 1, 1, 0];
const runoBeats: [number, number][] = [...seq(RUNO_LINE_A, 0), ...seq(RUNO_LINE_B, 10), ...seq(RUNO_LINE_A, 20)];

export const LESSONS: Lesson[] = [
  {
    id: 'meet',
    title: '1 · Meet the strings',
    description: 'Each finger rests over its own string. Pluck them in order (thumb is the low D) and the robot waits for you.',
    wait: true,
    notes: fromBeats(60, seq([0, 1, 2, 3, 4, 3, 2, 1, 0])),
  },
  {
    id: 'walk',
    title: '2 · Pentachord walk',
    description: 'Now in time. Up and down the five notes at a gentle walking pace. Pluck when each light reaches the ring.',
    wait: false,
    notes: fromBeats(66, [...seq([0, 1, 2, 3, 4, 3, 2, 1, 0], 0), ...seq([0, 2, 1, 3, 2, 4, 3, 1, 0], 10)]),
  },
  {
    id: 'runo',
    title: '3 · Runo song',
    description: 'A melody in the style of Kalevala runo-singing: eight syllables to a line, five beats to a bar, always returning home to D.',
    wait: false,
    notes: fromBeats(96, runoBeats),
  },
];

/** Turns a community creation's plucks into a lesson that anyone can learn. */
export function lessonFromRecording(creation: { id: string; title: string; author: string; recording: Recording }, wait = true): Lesson {
  const plucks = creation.recording.events.filter((e): e is Extract<typeof e, { type: 'pluck' }> => e.type === 'pluck');
  const t0 = plucks[0]?.t ?? 0;
  return {
    id: `creation-${creation.id}`,
    title: creation.title,
    description: `Learn ${creation.author}'s piece. The ghost hand shows their real recorded movements.`,
    wait,
    notes: plucks.map((p) => ({ t: p.t - t0, string: p.string })),
    fromCreation: creation,
  };
}

/** Velocity used when the frame interval is unknown (dt <= 0). */
const DEFAULT_VELOCITY = 0.7;

/**
 * Maps a DoF rise rate (normalised flexion per second) to a pluck velocity in [0.35, 1].
 * A slow, deliberate curl (~1.75 /s) gives ~0.4; a fast flick (~9 /s or more) reaches 1.
 * The retargeter's DoF smoothing (tau 0.03 s gloves, 0.07 s webcam) caps the rate seen at
 * the `on` threshold at roughly 15 /s (gloves) and 6-7 /s (webcam) even for an instant
 * step, so gloves can hit full velocity and a fast webcam pluck lands around 0.8.
 */
export function pluckVelocity(delta: number, dtMs: number): number {
  if (!(dtMs > 0)) return DEFAULT_VELOCITY;
  const rate = delta / Math.max(1e-3, dtMs / 1000);
  return Math.min(1, Math.max(0.35, 0.25 + rate * 0.085));
}

/** Rising-edge pluck detection on the robot's finger DoFs, with hysteresis. */
export class PluckDetector {
  private armed = [true, true, true, true, true];
  private prev = [0, 0, 0, 0, 0];
  constructor(
    public on = 0.55,
    public off = 0.38,
  ) {}

  update(dof: number[], dtMs: number): { string: number; velocity: number }[] {
    const out: { string: number; velocity: number }[] = [];
    for (let s = 0; s < 5; s++) {
      const v = dof[STRING_DOF[s]];
      if (this.armed[s] && v > this.on) {
        out.push({ string: s, velocity: pluckVelocity(v - this.prev[s], dtMs) });
        this.armed[s] = false;
      } else if (!this.armed[s] && v < this.off) {
        this.armed[s] = true;
      }
      this.prev[s] = v;
    }
    return out;
  }
}
