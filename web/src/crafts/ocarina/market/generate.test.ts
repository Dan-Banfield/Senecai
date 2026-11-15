import { describe, expect, it } from 'vitest';
import { fingeringFor } from '../fingering';
import { HOLES } from '../types';
import { noteRangeOf, seedMeta, songToTake } from './generate';
import { SEED_SONGS } from './seeds';

const takes = SEED_SONGS.map((s) => ({ seed: s, take: songToTake(s) }));

describe('songToTake', () => {
  it('is deterministic', () => {
    for (const s of SEED_SONGS) expect(songToTake(s)).toEqual(songToTake(s));
  });

  it('carries the seed identity and a reasonable duration', () => {
    for (const { seed, take } of takes) {
      expect(take.id).toBe(seed.id);
      expect(take.name).toBe(seed.title);
      expect(take.createdAt).toBe(seed.createdAt);
      expect(take.durationMs).toBe(take.frames[take.frames.length - 1].t);
      expect(take.durationMs, seed.id).toBeGreaterThanOrEqual(5000);
      expect(take.durationMs, seed.id).toBeLessThanOrEqual(60000);
    }
  });

  it('frames start at 0, run at ~60 fps and increase monotonically', () => {
    for (const { take } of takes) {
      expect(take.frames[0].t).toBe(0);
      for (let i = 1; i < take.frames.length; i++) {
        const dt = take.frames[i].t - take.frames[i - 1].t;
        expect(dt).toBeGreaterThan(0);
        expect(dt).toBeCloseTo(1000 / 60, 6);
      }
    }
  });

  it("holes match the sounding note's fingering", () => {
    for (const { take } of takes) {
      for (const f of take.frames) {
        expect(f.holes).toHaveLength(HOLES.length);
        if (f.midi !== null) expect(f.holes).toEqual(fingeringFor(f.midi));
      }
    }
  });

  it('starts and ends silent, with a lead-in', () => {
    for (const { take } of takes) {
      const firstSound = take.frames.findIndex((f) => f.midi !== null);
      expect(take.frames[firstSound].t).toBeGreaterThanOrEqual(350);
      expect(take.frames[take.frames.length - 1].midi).toBeNull();
    }
  });

  it('both sides have dof in 0..1 and integer Inspire angles in 0..1000', () => {
    for (const { take } of takes) {
      for (const f of take.frames) {
        for (const side of ['left', 'right'] as const) {
          const dof = f.dof[side]!;
          const inspire = f.inspire[side]!;
          expect(dof).toHaveLength(6);
          for (const v of dof) expect(v >= 0 && v <= 1).toBe(true);
          expect(inspire).toHaveLength(6);
          for (const v of inspire) expect(Number.isInteger(v) && v >= 0 && v <= 1000).toBe(true);
        }
      }
    }
  });

  it('fingers settle on covered/open flexion after easing', () => {
    for (const { take } of takes) {
      // A frame well after the lead-in starts holds the first fingering.
      const f = take.frames[15];
      HOLES.forEach((h, i) => {
        const v = f.dof[h.side]![h.dofIndex];
        if (f.holes[i]) expect(v).toBeGreaterThan(0.8);
        else expect(v).toBeLessThan(0.2);
      });
    }
  });

  it('separates repeated identical notes with a silent gap', () => {
    const { take } = takes.find((t) => t.seed.id === 'seed-twinkle')!;
    const firstSound = take.frames.findIndex((f) => f.midi !== null);
    const firstSilence = take.frames.findIndex((f, i) => i > firstSound && f.midi === null);
    expect(take.frames[firstSilence + 3].midi).toBe(take.frames[firstSound].midi);
  });
});

describe('noteRangeOf / seedMeta', () => {
  it('noteRangeOf finds the low and high notes, or null when silent', () => {
    const { take } = takes.find((t) => t.seed.id === 'seed-twinkle')!;
    expect(noteRangeOf(take)).toEqual({ low: 72, high: 81 });
    expect(noteRangeOf({ ...take, frames: take.frames.map((f) => ({ ...f, midi: null })) })).toBeNull();
  });

  it('seedMeta matches the generated take', () => {
    for (const { seed, take } of takes) {
      const meta = seedMeta(seed);
      expect(meta.durationMs).toBe(take.durationMs);
      expect(meta.noteRange).toEqual(noteRangeOf(take));
      expect(meta.mine).toBe(false);
    }
  });
});
