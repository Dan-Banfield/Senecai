import { describe, expect, it } from 'vitest';
import { fingeringFor, noteToMidi } from '../fingering';
import { SCALE_MIDI } from '../types';
import { SEED_SONGS } from './seeds';

describe('SEED_SONGS', () => {
  it('has about a dozen uniquely-identified seeds', () => {
    expect(SEED_SONGS.length).toBeGreaterThanOrEqual(10);
    const ids = SEED_SONGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SEED_SONGS) {
      expect(s.id.startsWith('seed-')).toBe(true);
      expect(s.title.trim()).not.toBe('');
      expect(s.artist.trim()).not.toBe('');
    }
  });

  it('every note is in the alto range and has a fingering', () => {
    for (const s of SEED_SONGS) {
      expect(s.song.notes.length).toBeGreaterThan(0);
      for (const n of s.song.notes) {
        expect(n.beats).toBeGreaterThan(0);
        const midi = noteToMidi(n.note);
        if (midi === null) continue;
        expect(midi, `${s.id} ${n.note}`).toBeGreaterThanOrEqual(SCALE_MIDI[0]);
        expect(midi, `${s.id} ${n.note}`).toBeLessThanOrEqual(SCALE_MIDI[SCALE_MIDI.length - 1]);
        expect(fingeringFor(midi), `${s.id} ${n.note}`).toBeDefined();
      }
    }
  });

  it('createdAt is fixed and before 2026-11-01', () => {
    for (const s of SEED_SONGS) {
      expect(Number.isInteger(s.createdAt)).toBe(true);
      expect(s.createdAt).toBeLessThan(Date.UTC(2026, 10, 1));
      expect(s.createdAt).toBeGreaterThan(Date.UTC(2026, 5, 1));
    }
  });
});
