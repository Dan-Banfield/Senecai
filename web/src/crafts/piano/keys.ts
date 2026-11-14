// The keyboard. One scene unit is 10 cm. White keys are 2.2 cm wide, a touch
// narrower than a real piano's 2.35 cm, so the robot hand's fingers (2 cm
// apart) sit one per key in the C position, as a pianist's do.
//
// Keys sit along X (low notes to the left), the player is at +Z, and the white
// key tops are at y = 0 when at rest. A key goes down by up to TRAVEL.

export const WHITE_W = 0.22;
export const WHITE_L = 1.6;
export const BLACK_W = 0.125;
export const BLACK_L = 0.95;
/** How far a black key's top stands above the white keys. */
export const BLACK_H = 0.11;
/** Key travel (a real piano key goes down about 1 cm). */
export const TRAVEL = 0.1;
/** C3 to E5: room for both hands, with middle C (C4 = 60) in the middle. */
export const LOW = 48;
export const HIGH = 76;

export interface PianoKey {
  midi: number;
  black: boolean;
  /** Centre along the keyboard. */
  x: number;
  w: number;
  /** Front (towards the player) and back edges. */
  zFront: number;
  zBack: number;
  /** Height of the key's top at rest. */
  top: number;
  name: string;
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);
export const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
export const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function layout(): PianoKey[] {
  const whites: number[] = [];
  for (let m = LOW; m <= HIGH; m++) if (!isBlack(m)) whites.push(m);
  const x0 = -((whites.length - 1) / 2) * WHITE_W;
  const whiteX = new Map(whites.map((m, i) => [m, x0 + i * WHITE_W]));
  const keys: PianoKey[] = [];
  for (let m = LOW; m <= HIGH; m++) {
    if (!isBlack(m)) {
      keys.push({ midi: m, black: false, x: whiteX.get(m)!, w: WHITE_W, zFront: WHITE_L / 2, zBack: -WHITE_L / 2, top: 0, name: noteName(m) });
    } else {
      // Centred on the gap between its two white neighbours.
      const x = (whiteX.get(m - 1)! + whiteX.get(m + 1)!) / 2;
      keys.push({ midi: m, black: true, x, w: BLACK_W, zFront: -WHITE_L / 2 + BLACK_L, zBack: -WHITE_L / 2, top: BLACK_H, name: noteName(m) });
    }
  }
  return keys;
}

export const KEYS = layout();
export const KEYBOARD_WIDTH = KEYS.filter((k) => !k.black).length * WHITE_W;
export const keyIndex = (midi: number) => midi - LOW;

/** The key whose top is under (x, z), black keys first since they sit on top. Returns its index, or -1. */
export function keyAt(x: number, z: number): number {
  let white = -1;
  for (let i = 0; i < KEYS.length; i++) {
    const k = KEYS[i];
    if (Math.abs(x - k.x) > k.w / 2 || z > k.zFront || z < k.zBack) continue;
    if (k.black) return i;
    white = i;
  }
  return white;
}

/** Mary Had a Little Lamb, in C: [midi, beats, lyric]. Right hand, thumb on middle C. */
export const SONG: [number, number, string][] = [
  [64, 1, 'Ma'], [62, 1, 'ry'], [60, 1, 'had'], [62, 1, 'a'], [64, 1, 'lit'], [64, 1, 'tle'], [64, 2, 'lamb,'],
  [62, 1, 'lit'], [62, 1, 'tle'], [62, 2, 'lamb,'],
  [64, 1, 'lit'], [67, 1, 'tle'], [67, 2, 'lamb,'],
  [64, 1, 'Ma'], [62, 1, 'ry'], [60, 1, 'had'], [62, 1, 'a'], [64, 1, 'lit'], [64, 1, 'tle'], [64, 1, 'lamb,'], [64, 1, 'its'],
  [62, 1, 'fleece'], [62, 1, 'was'], [64, 1, 'white'], [62, 1, 'as'], [60, 4, 'snow.'],
];
export const SONG_BPM = 100;

/** Which finger plays which note in the right hand's C position. */
export const RIGHT_FINGERING: Record<number, string> = { 60: 'thumb', 62: 'index', 64: 'middle', 65: 'ring', 67: 'little' };
