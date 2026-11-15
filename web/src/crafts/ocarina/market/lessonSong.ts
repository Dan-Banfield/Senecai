// Turning songs and takes into lesson material: a recorded take becomes a
// lesson Song (its sounding notes), a built-in Song becomes a demo take, and
// either can be retimed for the playback speed.

import { midiToName } from '../fingering';
import type { NoteEvent } from '../lesson';
import type { Song, SongNote, Take } from '../types';
import { songToTake } from './generate';

/** The playback/lesson speeds on offer. */
export const SPEEDS = [0.5, 0.75, 1, 1.5, 2] as const;

/** The nearest offered speed (1 for anything that isn't a number). */
export const clampSpeed = (v: number): number =>
  Number.isFinite(v) ? SPEEDS.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), 1) : 1;

/** Lesson tempo for derived songs: one beat = 500 ms, so beats are just ms / 500. */
const DERIVED_BPM = 120;
const BEAT_MS = 60000 / DERIVED_BPM;
/** Runs shorter than this (finger transitions, articulation gaps) are folded into the previous run. */
const MIN_RUN_MS = 90;

interface Run {
  midi: number | null;
  start: number;
  end: number;
}

/** The take's notes in take time (ms): runs of the sounding pitch, blips folded in, silence trimmed at both ends. */
export function takeNoteEvents(take: Take): NoteEvent[] {
  const f = take.frames;
  const runs: Run[] = [];
  for (let i = 0; i < f.length; i++) {
    const end = i + 1 < f.length ? f[i + 1].t : Math.max(take.durationMs, f[i].t);
    const last = runs[runs.length - 1];
    if (last && last.midi === f[i].midi) last.end = end;
    else runs.push({ midi: f[i].midi, start: f[i].t, end });
  }

  // Fold blips (finger transitions, articulation gaps) into the previous run. Neighbouring runs of
  // the same pitch stay separate, so repeated notes remain repeated notes.
  const clean: Run[] = [];
  for (const r of runs) {
    const prev = clean[clean.length - 1];
    if (prev && r.end - r.start < MIN_RUN_MS) {
      prev.end = r.end;
      continue;
    }
    clean.push({ ...r });
  }

  while (clean.length && clean[0].midi === null) clean.shift();
  while (clean.length && clean[clean.length - 1].midi === null) clean.pop();

  return clean.map((r, index) => ({ index, midi: r.midi, startMs: r.start, durMs: r.end - r.start }));
}

/** Index of the note sounding (or last started) at take time `t`; 0 before the first note. */
export function noteIndexAt(events: readonly NoteEvent[], t: number): number {
  let lo = 0;
  let hi = events.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].startMs <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** The take's sounding notes as a lesson Song (silence trimmed at both ends). Empty notes when it never sounds. */
export function takeToSong(take: Take, id: string, title: string): Song {
  const notes: SongNote[] = takeNoteEvents(take).map((e) => ({
    note: e.midi === null ? 'rest' : midiToName(e.midi),
    beats: Math.max(0.05, Math.round((e.durMs / BEAT_MS) * 100) / 100),
  }));
  return { id, title, bpm: DERIVED_BPM, beatsPerBar: 4, notes };
}

/** A built-in Song played by the generated "teacher" hands. */
export function songToDemoTake(song: Song): Take {
  return songToTake({ id: `demo-${song.id}`, title: song.title, artist: '', createdAt: 0, song });
}

/** The same song at `speed`× tempo. */
export const songAtSpeed = (song: Song, speed: number): Song => (speed === 1 ? song : { ...song, bpm: song.bpm * speed });

/** The same take played at `speed`× (frame times and duration divided by speed). */
export function takeAtSpeed(take: Take, speed: number): Take {
  if (speed === 1) return take;
  return {
    ...take,
    durationMs: take.durationMs / speed,
    frames: take.frames.map((fr) => ({ ...fr, t: fr.t / speed })),
  };
}
