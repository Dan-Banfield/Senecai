import { describe, expect, it } from 'vitest';
import { Lesson, scheduleSong } from './lesson';
import type { Song } from './types';

// 120 bpm: 500 ms per beat, 2000 ms count-in.
const song: Song = {
  id: 'test',
  title: 'Test',
  bpm: 120,
  beatsPerBar: 4,
  notes: [
    { note: 'C5', beats: 1 },
    { note: 'D5', beats: 1 },
    { note: 'rest', beats: 1 },
    { note: 'E5', beats: 1 },
  ],
};

/** The note the score asks for at song time t (null during count-in / rests). */
const target = (l: Lesson) => (l.state === 'playing' ? l.events[l.current].midi : null);

describe('scheduleSong', () => {
  it('lays out notes after a one-bar count-in', () => {
    const s = scheduleSong(song);
    expect(s.countInMs).toBe(2000);
    expect(s.totalMs).toBe(2000);
    expect(s.events.map((e) => [e.midi, e.startMs, e.durMs])).toEqual([
      [72, 0, 500],
      [74, 500, 500],
      [null, 1000, 500],
      [76, 1500, 500],
    ]);
  });
});

describe('timed lesson', () => {
  it('counts in, then plays to the end', () => {
    const l = new Lesson(song, { wait: false });
    expect(l.state).toBe('countin');
    expect(l.songTime).toBe(-2000);
    l.tick(1999, null);
    expect(l.state).toBe('countin');
    l.tick(1, null);
    expect(l.state).toBe('playing');
    expect(l.current).toBe(0);
  });

  it('perfect play scores 100% and 3 stars', () => {
    const l = new Lesson(song, { wait: false });
    l.tick(2000, null);
    while (l.state !== 'done') l.tick(10, target(l));
    expect(l.results).toEqual(['hit', 'hit', 'rest', 'hit']);
    expect(l.hitPercent).toBe(100);
    expect(l.stars).toBe(3);
    expect(l.current).toBe(4);
    expect(l.songTime).toBe(2000);
  });

  it('playing nothing scores 0%', () => {
    const l = new Lesson(song, { wait: false });
    while (l.state !== 'done') l.tick(16, null);
    expect(l.results).toEqual(['miss', 'miss', 'rest', 'miss']);
    expect(l.hitPercent).toBe(0);
    expect(l.stars).toBe(0);
  });

  it('half of each note is exactly enough', () => {
    const l = new Lesson(song, { wait: false });
    l.tick(2000, null);
    for (const ev of l.events) {
      l.tick(ev.durMs / 2, ev.midi);
      l.tick(ev.durMs / 2, null);
    }
    expect(l.results).toEqual(['hit', 'hit', 'rest', 'hit']);
  });

  it('just under half is a miss', () => {
    const l = new Lesson(song, { wait: false });
    l.tick(2000, null);
    for (const ev of l.events) {
      l.tick(ev.durMs / 2 - 1, ev.midi);
      l.tick(ev.durMs / 2 + 1, null);
    }
    expect(l.results).toEqual(['miss', 'miss', 'rest', 'miss']);
  });

  it('a wrong note is a miss', () => {
    const l = new Lesson(song, { wait: false });
    l.tick(2000, null);
    l.tick(500, 73);
    expect(l.results[0]).toBe('miss');
  });

  it('one huge tick settles every event', () => {
    const l = new Lesson(song, { wait: false });
    l.tick(100000, 72);
    expect(l.state).toBe('done');
    expect(l.results).toEqual(['hit', 'miss', 'rest', 'miss']);
    expect(l.hitPercent).toBeCloseTo(100 / 3);
    expect(l.stars).toBe(0);
  });

  it('a tick spanning count-in and notes splits time across boundaries', () => {
    const l = new Lesson(song, { wait: false });
    l.tick(2750, 72); // count-in + all of C5 + half of D5 (with the wrong note)
    expect(l.results.slice(0, 2)).toEqual(['hit', 'pending']);
    expect(l.current).toBe(1);
    expect(l.songTime).toBe(750);
  });

  it('stars follow the thresholds', () => {
    const many: Song = { ...song, notes: Array.from({ length: 20 }, () => ({ note: 'C5', beats: 1 })) };
    const run = (hits: number) => {
      const l = new Lesson(many, { wait: false });
      l.tick(2000, null);
      for (let i = 0; i < 20; i++) l.tick(500, i < hits ? 72 : null);
      return [l.hitPercent, l.stars];
    };
    expect(run(19)).toEqual([95, 3]);
    expect(run(18)).toEqual([90, 2]);
    expect(run(16)).toEqual([80, 2]);
    expect(run(15)).toEqual([75, 1]);
    expect(run(12)).toEqual([60, 1]);
    expect(run(11)).toEqual([55, 0]);
  });

  it('hitPercent is 0 before anything is scored', () => {
    expect(new Lesson(song, { wait: false }).hitPercent).toBe(0);
  });
});

describe('wait-for-me lesson', () => {
  it('freezes at the end of a note until it is held 300 ms', () => {
    const l = new Lesson(song, { wait: true });
    l.tick(2000, null);
    l.tick(5000, null);
    expect(l.songTime).toBe(500);
    expect(l.current).toBe(0);
    expect(l.results[0]).toBe('pending');
    l.tick(299, 72);
    expect(l.current).toBe(0);
    l.tick(1, 72);
    expect(l.results[0]).toBe('hit');
    expect(l.current).toBe(1);
    expect(l.songTime).toBe(500);
  });

  it('a wrong note resets the hold', () => {
    const l = new Lesson(song, { wait: true });
    l.tick(2500, null);
    l.tick(200, 72);
    l.tick(10, 74);
    l.tick(200, 72);
    expect(l.current).toBe(0);
    l.tick(100, 72);
    expect(l.current).toBe(1);
  });

  it('silence also resets the hold', () => {
    const l = new Lesson(song, { wait: true });
    l.tick(2500, null);
    l.tick(250, 72);
    l.tick(10, null);
    l.tick(250, 72);
    expect(l.current).toBe(0);
  });

  it('holding during the note advances at tempo without stopping', () => {
    const l = new Lesson(song, { wait: true });
    l.tick(2000, null);
    l.tick(500, 72);
    expect(l.results[0]).toBe('hit');
    expect(l.songTime).toBe(500);
    l.tick(500, 74);
    expect(l.results[1]).toBe('hit');
    // the rest passes without waiting
    l.tick(500, null);
    expect(l.results[2]).toBe('rest');
    expect(l.songTime).toBe(1500);
  });

  it('a big tick of the right note carries through the hold into the next note', () => {
    const l = new Lesson(song, { wait: true });
    l.tick(2000, null);
    l.tick(500, null); // frozen at C5's end
    l.tick(400, 72); // 300 to hold, then 100 into D5
    expect(l.current).toBe(1);
    expect(l.songTime).toBe(600);
  });

  it('finishes with 100% once every note is held', () => {
    const l = new Lesson(song, { wait: true });
    for (let i = 0; i < 1000 && l.state !== 'done'; i++) l.tick(33, target(l));
    expect(l.state).toBe('done');
    expect(l.results).toEqual(['hit', 'hit', 'rest', 'hit']);
    expect(l.stars).toBe(3);
  });
});
