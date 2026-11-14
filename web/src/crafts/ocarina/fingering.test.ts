import { describe, expect, it } from 'vitest';
import type { Dof6 } from '../../robot/retarget';
import { fingeringFor, frequencyOf, HoleTracker, HOLE_AREAS, midiToName, noteToMidi, pitchOf } from './fingering';
import { SONGS } from './songs';
import { HOLES, SCALE_MIDI } from './types';

const freq = (m: number) => 440 * 2 ** ((m - 69) / 12);
/** First k holes of the lift order open, the rest covered. */
const lifted = (k: number) => HOLES.map((_, i) => i >= k);
const flat = (v: number): Dof6 => [v, v, v, v, v, v];

describe('pitch model', () => {
  const table = ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6', 'D6', 'E6'];
  table.forEach((name, k) => {
    it(`lifting ${k} holes plays ${name}`, () => {
      expect(pitchOf(lifted(k))).toBe(noteToMidi(name));
      expect(frequencyOf(lifted(k))).toBeCloseTo(freq(SCALE_MIDI[k]), 6);
    });
  });

  it('all holes open is silent', () => {
    expect(pitchOf(lifted(10))).toBeNull();
  });

  it('has one positive area per hole', () => {
    expect(HOLE_AREAS).toHaveLength(10);
    for (const a of HOLE_AREAS) expect(a).toBeGreaterThan(0);
  });

  it('depends only on total open area, not which holes', () => {
    const a = HOLES.map(() => true);
    const b = HOLES.map(() => true);
    a[0] = false; // R.little
    b[1] = false; // R.ring
    expect(frequencyOf(a)).toBeCloseTo(freq(72) * Math.sqrt(1 + HOLE_AREAS[0]), 9);
    expect(frequencyOf(b)).toBeCloseTo(freq(72) * Math.sqrt(1 + HOLE_AREAS[1]), 9);
  });

  it('cross-fingerings snap to whole semitones', () => {
    for (let mask = 0; mask < 1023; mask++) {
      const holes = HOLES.map((_, i) => (mask & (1 << i)) === 0);
      const m = pitchOf(holes)!;
      expect(Number.isInteger(m)).toBe(true);
      expect(Math.abs(69 + 12 * Math.log2(frequencyOf(holes) / 440) - m)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('fingeringFor', () => {
  it('returns the standard fingering for scale notes', () => {
    for (let k = 0; k < 10; k++) expect(fingeringFor(SCALE_MIDI[k])).toEqual(lifted(k));
  });

  it('finds cross-fingerings for accidentals', () => {
    for (const name of ['D#5', 'F#5', 'G#5', 'A#5', 'C#6', 'D#6']) {
      const f = fingeringFor(noteToMidi(name)!);
      expect(f, name).toBeDefined();
      expect(pitchOf(f!)).toBe(noteToMidi(name));
    }
  });

  it('is undefined for unreachable notes', () => {
    expect(fingeringFor(73)).toBeUndefined(); // C#5: even the smallest hole jumps past it
    expect(fingeringFor(60)).toBeUndefined();
    expect(fingeringFor(95)).toBeUndefined();
  });

  it('returns copies', () => {
    fingeringFor(72)![0] = false;
    expect(fingeringFor(72)).toEqual(lifted(0));
  });
});

describe('note names', () => {
  it('parses scientific pitch', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('C5')).toBe(72);
    expect(noteToMidi('F#5')).toBe(78);
    expect(noteToMidi('Bb5')).toBe(82);
    expect(noteToMidi('rest')).toBeNull();
    for (const bad of ['', 'H5', 'C', 'c5', 'C#', 'Cx5', 'rest ']) expect(() => noteToMidi(bad)).toThrow();
  });

  it('names MIDI with sharps', () => {
    expect(midiToName(73)).toBe('C#5');
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(88)).toBe('E6');
    for (let m = 60; m < 96; m++) expect(noteToMidi(midiToName(m))).toBe(m);
  });
});

describe('hole hysteresis', () => {
  it('covers at 0.55 and uncovers below 0.45', () => {
    const t = new HoleTracker();
    expect(t.update({ left: flat(0.5), right: flat(0.5) }).every((c) => !c)).toBe(true);
    expect(t.update({ left: flat(0.55), right: flat(0.55) }).every((c) => c)).toBe(true);
    expect(t.update({ left: flat(0.45), right: flat(0.45) }).every((c) => c)).toBe(true);
    expect(t.update({ left: flat(0.4499), right: flat(0.4499) }).every((c) => !c)).toBe(true);
    expect(t.update({ left: flat(0.54), right: flat(0.54) }).every((c) => !c)).toBe(true);
  });

  it('reads each hole from its own side and DoF', () => {
    const t = new HoleTracker();
    const right: Dof6 = [1, 0, 0, 0, 0, 1]; // thumbRotate ignored, little closed
    const holes = t.update({ right });
    expect(holes).toHaveLength(10);
    HOLES.forEach((h, i) => expect(holes[i], h.id).toBe(h.id === 'R.little'));
  });

  it('a missing side uncovers its holes and forgets their state', () => {
    const t = new HoleTracker();
    t.update({ left: flat(1), right: flat(1) });
    const holes = t.update({ right: flat(0.5) });
    HOLES.forEach((h, i) => expect(holes[i]).toBe(h.side === 'right'));
    expect(t.update({ left: flat(0.5), right: flat(0.5) }).filter(Boolean)).toHaveLength(5);
  });

  it('reset uncovers everything', () => {
    const t = new HoleTracker();
    t.update({ left: flat(1), right: flat(1) });
    t.reset();
    expect(t.update({ left: flat(0.5), right: flat(0.5) }).some(Boolean)).toBe(false);
  });

  it('returns a fresh array each call', () => {
    const t = new HoleTracker();
    const a = t.update({ left: flat(1) });
    a[9] = true;
    expect(t.update({ left: flat(0.5) })[9]).toBe(false);
  });
});

describe('songs', () => {
  it('every note is a rest or playable', () => {
    for (const song of SONGS) {
      for (const { note } of song.notes) {
        const midi = noteToMidi(note);
        if (midi === null) continue;
        const f = fingeringFor(midi);
        expect(f, `${song.id} ${note}`).toBeDefined();
        expect(pitchOf(f!)).toBe(midi);
      }
    }
  });

  it('the waltz is 16 whole bars of 3/4 within C5..E6', () => {
    const waltz = SONGS.find((s) => s.id === 'clockwork-waltz')!;
    expect(waltz.beatsPerBar).toBe(3);
    const total = waltz.notes.reduce((s, n) => s + n.beats, 0);
    expect(total % 3).toBe(0);
    expect(total).toBe(48);
    let bar = 0;
    for (const n of waltz.notes) {
      bar += n.beats;
      expect(bar).toBeLessThanOrEqual(3);
      if (bar === 3) bar = 0;
    }
    expect(bar).toBe(0);
    for (const { note } of waltz.notes) {
      const m = noteToMidi(note);
      if (m !== null) expect(m >= 72 && m <= 88, note).toBe(true);
    }
  });

  it('the scale goes up to E6 and back down to a long C5', () => {
    const scale = SONGS.find((s) => s.id === 'scale')!;
    const names = scale.notes.map((n) => n.note);
    expect(names).toEqual(['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6', 'D6', 'E6', 'D6', 'C6', 'B5', 'A5', 'G5', 'F5', 'E5', 'D5', 'C5']);
    expect(scale.notes.at(-1)!.beats).toBe(2);
  });
});
