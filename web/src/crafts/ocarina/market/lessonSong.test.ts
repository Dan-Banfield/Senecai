import { describe, expect, it } from 'vitest';
import { noteToMidi } from '../fingering';
import { scheduleSong } from '../lesson';
import { SONGS } from '../songs';
import { clampSpeed, songAtSpeed, songToDemoTake, takeAtSpeed, takeToSong } from './lessonSong';
import { songToTake } from './generate';
import { SEED_SONGS } from './seeds';

/** Sounding notes of a song, rests dropped. */
const pitches = (notes: { note: string }[]) => notes.map((n) => noteToMidi(n.note)).filter((m) => m !== null);

describe('takeToSong', () => {
  it('recovers every seed melody note-for-note from its generated take', () => {
    for (const seed of SEED_SONGS) {
      const derived = takeToSong(songToTake(seed), `lib:${seed.id}`, seed.title);
      expect(pitches(derived.notes), seed.id).toEqual(pitches(seed.song.notes));
      expect(derived.notes[0].note).not.toBe('rest');
      expect(derived.notes[derived.notes.length - 1].note).not.toBe('rest');
    }
  });

  it('keeps note timing close to the original', () => {
    const seed = SEED_SONGS[0];
    const derived = takeToSong(songToTake(seed), 'x', seed.title);
    const origMs = scheduleSong(seed.song).totalMs;
    const derivedMs = scheduleSong(derived).totalMs;
    expect(Math.abs(derivedMs - origMs)).toBeLessThan(origMs * 0.05 + 200);
  });

  it('returns no notes for a silent take', () => {
    const take = songToTake({ ...SEED_SONGS[0], song: { ...SEED_SONGS[0].song, notes: [{ note: 'rest', beats: 4 }] } });
    expect(takeToSong(take, 'x', 'Silence').notes).toEqual([]);
  });
});

describe('speed', () => {
  it('snaps to the offered speeds', () => {
    expect(clampSpeed(0.2)).toBe(0.5);
    expect(clampSpeed(9)).toBe(2);
    expect(clampSpeed(0.95)).toBe(1);
    expect(clampSpeed(0.7)).toBe(0.75);
    expect(clampSpeed(1.4)).toBe(1.5);
    expect(clampSpeed(Number.NaN)).toBe(1);
  });

  it('scales song tempo and take timing', () => {
    const song = SONGS[0];
    expect(songAtSpeed(song, 1)).toBe(song);
    expect(songAtSpeed(song, 0.5).bpm).toBe(song.bpm / 2);
    const take = songToDemoTake(song);
    const slow = takeAtSpeed(take, 0.5);
    expect(slow.durationMs).toBeCloseTo(take.durationMs * 2);
    expect(slow.frames[10].t).toBeCloseTo(take.frames[10].t * 2);
    expect(slow.frames[10].holes).toEqual(take.frames[10].holes);
    expect(take.frames[10].t).toBe(songToDemoTake(song).frames[10].t);
  });
});
