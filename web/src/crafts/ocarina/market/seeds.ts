// Seeded market songs: short public-domain melodies in the alto range C5..F6,
// credited to made-up players. Notes are 'C5', 'G#5' or 'rest' (see songs.ts).

import type { Song, SongNote } from '../types';

export interface SeedSong {
  id: string;
  title: string;
  artist: string;
  /** ms epoch, fixed so the market looks the same on every load. */
  createdAt: number;
  song: Song;
}

/** 'A5:2 B5 C6:0.5' -> notes (beats default to 1). */
const seq = (s: string): SongNote[] =>
  s.trim().split(/\s+/).map((tok) => {
    const [note, beats] = tok.split(':');
    return { note, beats: beats === undefined ? 1 : Number(beats) };
  });

const DAY = 86_400_000;
/** 2026-11-01T00:00:00Z */
const EPOCH = 1_793_491_200_000;
/** `days` before EPOCH, plus a few hours so they don't all land at midnight. */
const ago = (days: number, hours: number) => EPOCH - days * DAY + hours * 3_600_000;

const seed = (
  id: string,
  title: string,
  artist: string,
  createdAt: number,
  bpm: number,
  beatsPerBar: number,
  notes: string,
): SeedSong => ({ id: `seed-${id}`, title, artist, createdAt, song: { id: `seed-${id}`, title, bpm, beatsPerBar, notes: seq(notes) } });

export const SEED_SONGS: SeedSong[] = [
  seed('ode-to-joy', 'Ode to Joy', 'Aino K.', ago(3, 19), 116, 4, `
    E5 E5 F5 G5   G5 F5 E5 D5   C5 C5 D5 E5   E5:1.5 D5:0.5 D5:2
    E5 E5 F5 G5   G5 F5 E5 D5   C5 C5 D5 E5   D5:1.5 C5:0.5 C5:2
    D5 D5 E5 C5   D5 E5:0.5 F5:0.5 E5 C5   D5 E5:0.5 F5:0.5 E5 D5   C5 D5 G5:2
    E5 E5 F5 G5   G5 F5 E5 D5   C5 C5 D5 E5   D5:1.5 C5:0.5 C5:2
  `),
  // In G major, which this tune never needs an F# for.
  seed('frere-jacques', 'Frère Jacques', 'Marco B.', ago(9, 8), 126, 4, `
    G5 A5 B5 G5   G5 A5 B5 G5   B5 C6 D6:2   B5 C6 D6:2
    D6:0.5 E6:0.5 D6:0.5 C6:0.5 B5 G5   D6:0.5 E6:0.5 D6:0.5 C6:0.5 B5 G5
    G5 D5 G5:2   G5 D5 G5:2
  `),
  seed('greensleeves', 'Greensleeves', 'Sophie L.', ago(14, 21), 168, 3, `
    A5   C6:2 D6   E6:1.5 F6:0.5 E6   D6:2 B5   G5:1.5 A5:0.5 B5
    C6:2 A5   A5:1.5 G#5:0.5 A5   B5:2 G#5   E5:2 A5
    C6:2 D6   E6:1.5 F6:0.5 E6   D6:2 B5   G5:1.5 A5:0.5 B5
    C6:1.5 B5:0.5 A5   G#5:1.5 F#5:0.5 G#5   A5:3   A5:2
  `),
  seed('twinkle', 'Twinkle, Twinkle, Little Star', 'Kenji T.', ago(21, 10), 112, 4, `
    C5 C5 G5 G5   A5 A5 G5:2   F5 F5 E5 E5   D5 D5 C5:2
    G5 G5 F5 F5   E5 E5 D5:2   G5 G5 F5 F5   E5 E5 D5:2
    C5 C5 G5 G5   A5 A5 G5:2   F5 F5 E5 E5   D5 D5 C5:2
  `),
  seed('jingle-bells', 'Jingle Bells', 'Grace O.', ago(27, 15), 144, 4, `
    E5 E5 E5:2   E5 E5 E5:2   E5 G5 C5:1.5 D5:0.5   E5:4
    F5 F5 F5:1.5 F5:0.5   F5 E5 E5 E5:0.5 E5:0.5   E5 D5 D5 E5   D5:2 G5:2
    E5 E5 E5:2   E5 E5 E5:2   E5 G5 C5:1.5 D5:0.5   E5:4
    F5 F5 F5:1.5 F5:0.5   F5 E5 E5 E5:0.5 E5:0.5   G5 G5 F5 D5   C5:4
  `),
  // Finnish traditional children's song.
  seed('ukko-nooa', 'Ukko Nooa', 'Eero V.', ago(34, 12), 132, 4, `
    C5 C5 C5 E5   D5 D5 D5 F5   E5 E5 D5 D5   C5:2 rest:2
    E5 E5 E5 E5   G5:2 F5:2   D5 D5 D5 D5   F5:2 E5:2
    C5 C5 C5 E5   D5 D5 D5 F5   E5 E5 D5 D5   C5:4
  `),
  seed('saints', 'When the Saints Go Marching In', 'Malik J.', ago(42, 17), 160, 4, `
    rest C5 E5 F5   G5:4   rest C5 E5 F5   G5:4
    rest C5 E5 F5   G5:2 E5:2   C5:2 E5:2   D5:4
    rest E5 E5 D5   C5:3 C5   E5:2 G5:2   G5 F5:3
    rest E5 F5 G5   E5:2 C5:2   D5:2 D5:2   C5:4
  `),
  // In F major, which this tune never needs a Bb for.
  seed('amazing-grace', 'Amazing Grace', 'Hannah W.', ago(51, 9), 84, 3, `
    C5   F5:2 A5:0.5 F5:0.5   A5:2 G5   F5:2 D5   C5:2 C5
    F5:2 A5:0.5 F5:0.5   A5:2 G5:0.5 A5:0.5   C6:3   C6:2 A5
    C6:1.5 A5:0.5 C6:0.5 A5:0.5   F5:2 C5   D5:1.5 F5:0.5 F5:0.5 D5:0.5   C5:2 C5
    F5:2 A5:0.5 F5:0.5   A5:2 G5   F5:3
  `),
  // D Dorian: all naturals.
  seed('scarborough-fair', 'Scarborough Fair', 'Ines R.', ago(60, 20), 132, 3, `
    D5:2 D5   A5:2 A5   E5:1.5 F5:0.5 E5   D5:3
    rest A5 C6   D6:2 C6   A5 B5 G5   A5:3
    rest:2 D6   D6:2 D6   C6:2 A5   A5 G5 F5   E5 C5:2
    D5:2 A5   G5:2 F5   E5 D5 C5   D5:3
  `),
  seed('lightly-row', 'Lightly Row', 'Lukas M.', ago(68, 7), 132, 4, `
    G5 E5 E5:2   F5 D5 D5:2   C5 D5 E5 F5   G5 G5 G5:2
    G5 E5 E5:2   F5 D5 D5:2   C5 E5 G5 G5   C5:4
    D5 D5 D5 D5   D5 E5 F5:2   E5 E5 E5 E5   E5 F5 G5:2
    G5 E5 E5:2   F5 D5 D5:2   C5 E5 G5 G5   C5:4
  `),
  // In F major so the low phrase stays above C5.
  seed('au-clair-de-la-lune', 'Au Clair de la Lune', 'Camille D.', ago(77, 14), 120, 4, `
    F5 F5 F5 G5   A5:2 G5:2   F5 A5 G5 G5   F5:4
    F5 F5 F5 G5   A5:2 G5:2   F5 A5 G5 G5   F5:4
    G5 G5 G5 G5   D5:2 D5:2   G5 F5 E5 D5   C5:4
    F5 F5 F5 G5   A5:2 G5:2   F5 A5 G5 G5   F5:4
  `),
  seed('brahms-lullaby', "Brahms' Lullaby", 'Priya S.', ago(88, 11), 76, 3, `
    E5:0.5 E5:0.5   G5:2 E5:0.5 E5:0.5   G5:2 E5:0.5 G5:0.5   C6 B5:1.5 A5:0.5   A5 G5 D5:0.5 E5:0.5
    F5 D5 D5:0.5 E5:0.5   F5:2 D5:0.5 F5:0.5   B5:0.5 A5:0.5 G5 B5   C6:2 C5:0.5 C5:0.5
    C6:2 A5:0.5 F5:0.5   G5:2 E5:0.5 C5:0.5   F5 G5 A5   G5:2 C5:0.5 C5:0.5
    C6:2 A5:0.5 F5:0.5   G5:2 E5:0.5 C5:0.5   F5 E5 D5   C5:3
  `),
];
