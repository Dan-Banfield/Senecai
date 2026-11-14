// Shared contract for the ocarina craft (see SPEC.md). Every ocarina module
// (fingering, lesson, recording, audio, stage, session, page) agrees on these.
//
// The instrument is a 12-hole Italian alto C with the two subholes omitted:
// ten holes, one per finger. Wrists are fixed; only finger flexion matters.

import type { Side } from '../../rokoko/types';
import type { Dof6 } from '../../robot/retarget';

export type HoleFinger = 'thumb' | 'index' | 'middle' | 'ring' | 'little';

export interface HoleDef {
  /** e.g. 'R.little', 'L.thumb'. */
  id: string;
  side: Side;
  finger: HoleFinger;
  /** Index into the Retargeter's Dof6 (thumb uses thumbBend). */
  dofIndex: number;
  /** Thumb holes are on the back (underside) of the ocarina. */
  back: boolean;
}

const DOF_INDEX: Record<HoleFinger, number> = { thumb: 1, index: 2, middle: 3, ring: 4, little: 5 };
const hole = (side: Side, finger: HoleFinger): HoleDef => ({
  id: `${side === 'left' ? 'L' : 'R'}.${finger}`,
  side,
  finger,
  dofIndex: DOF_INDEX[finger],
  back: finger === 'thumb',
});

/**
 * The ten holes in standard lift order: lifting HOLES[0..k-1] (all others
 * covered) plays SCALE_MIDI[k].
 */
export const HOLES: readonly HoleDef[] = [
  hole('right', 'little'),
  hole('right', 'ring'),
  hole('right', 'middle'),
  hole('right', 'index'),
  hole('left', 'little'),
  hole('left', 'ring'),
  hole('left', 'middle'),
  hole('left', 'index'),
  hole('left', 'thumb'),
  hole('right', 'thumb'),
];

/** C5 D5 E5 F5 G5 A5 B5 C6 D6 E6 F6: index k = first k holes of HOLES open. k = 10 (all open) is silent in play. */
export const SCALE_MIDI = [72, 74, 76, 77, 79, 81, 83, 84, 86, 88, 89] as const;

/** Flexion hysteresis: a hole becomes covered at >= COVER_ON, uncovered at < COVER_OFF. */
export const COVER_ON = 0.55;
export const COVER_OFF = 0.45;

/** true = covered, indexed like HOLES (length 10). */
export type HoleStates = boolean[];

/** What the 3D stage draws each frame (live or replay). */
export interface OcarinaView {
  /** Finger flexion per tracked side; missing side = hand hidden. Wrists are fixed by the stage. */
  dof: Partial<Record<Side, Dof6>>;
  holes: HoleStates;
  /** Sounding note, or null when silent. */
  midi: number | null;
}

/** `note` is scientific pitch ('C5', 'F#5', 'Bb5') or 'rest'. */
export interface SongNote {
  note: string;
  beats: number;
}

export interface Song {
  id: string;
  title: string;
  bpm: number;
  beatsPerBar: number;
  notes: SongNote[];
}

/** One recorded frame. `t` is ms since the take started. */
export interface TakeFrame {
  t: number;
  dof: Partial<Record<Side, Dof6>>;
  holes: HoleStates;
  midi: number | null;
  /** Each side's RobotHandCommand as Inspire 0..1000 angles (toInspireAngles). */
  inspire: Partial<Record<Side, number[]>>;
}

/** A session-only take (kept in memory, never persisted). */
export interface Take {
  id: string;
  name: string;
  createdAt: number;
  durationMs: number;
  frames: TakeFrame[];
}

export interface OcarinaSynth {
  /** Create/resume the AudioContext; call from a user gesture. Safe to call repeatedly. */
  unlock(): void;
  /** Glide to `midi` (or release to silence with null). gain 0..1, default 0.8. */
  setNote(midi: number | null, gain?: number): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  /** True once the AudioContext exists and is running (browsers keep it suspended until a user gesture). */
  readonly ready: boolean;
  /** Silence and release audio nodes. */
  dispose(): void;
}
