// Lesson songs as plain data. Add a tune by appending a Song; notes are 'C5', 'F#5', 'Bb5' or 'rest'.

import type { Song, SongNote } from './types';

/** 'A5:2 B5 C6:0.5' -> notes (beats default to 1). */
const seq = (s: string): SongNote[] =>
  s.trim().split(/\s+/).map((tok) => {
    const [note, beats] = tok.split(':');
    return { note, beats: beats === undefined ? 1 : Number(beats) };
  });

const SCALE_UP = 'C5 D5 E5 F5 G5 A5 B5 C6 D6 E6';
const SCALE_DOWN = 'D6 C6 B5 A5 G5 F5 E5 D5 C5:2';

export const SONGS: Song[] = [
  {
    id: 'scale',
    title: 'C major scale',
    bpm: 80,
    beatsPerBar: 4,
    notes: seq(`${SCALE_UP} ${SCALE_DOWN}`),
  },
  {
    // Original composition for Senecai: A minor, a two-bar rising-and-turning motif.
    id: 'clockwork-waltz',
    title: 'Clockwork Waltz',
    bpm: 96,
    beatsPerBar: 3,
    notes: seq(`
      A5:2 B5     C6 B5 A5
      G5:1.5 A5:0.5 B5     A5 G5 E5
      A5:2 B5     C6 D6 E6
      D6:2 C6     B5:2 rest
      E6:1.5 D6:0.5 C6     D6 C6 B5
      C6:2 B5     A5 B5 G#5
      A5:2 B5     C6 B5 A5
      F5 E5 G#5   A5:3
    `),
  },
];
