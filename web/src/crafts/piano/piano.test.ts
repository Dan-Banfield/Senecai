import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { fingertips } from '../../robot/fingertips';
import type { Dof6 } from '../../robot/retarget';
import type { Side } from '../../rokoko/types';
import { PAD, pressKeys, RESET, STRIKE, stepKeys } from './collision';
import { KEYS, keyAt, keyIndex, noteName, SONG, TRAVEL } from './keys';
import { homePosition } from './session';

/** The default resting hand the keyboard is laid out for, and a robot hand posed with extra curl on top. */
const REST: Dof6 = [0.4, 0.2, 0.25, 0.22, 0.25, 0.3];
const pressed = (finger: number, p: number): Dof6 => {
  const d = [...REST] as Dof6;
  if (finger === 0) {
    d[0] -= 0.16 * p; // a thumb pressing down onto its key
    d[1] += 0.2 * p;
  } else d[finger + 1] += 0.22 * p;
  return d;
};
const pose = (side: Side, dof: Dof6, lower = 0) => ({ dof, position: homePosition(side).add(new THREE.Vector3(0, -lower, 0)), rotation: new THREE.Quaternion() });
const keyUnder = (p: THREE.Vector3) => KEYS[keyAt(p.x, p.z)]?.name ?? 'none';

describe('the keyboard', () => {
  it('runs C3 to E5 with black keys in the right places', () => {
    expect(KEYS.filter((k) => !k.black)).toHaveLength(17);
    expect(KEYS.filter((k) => k.black)).toHaveLength(12);
    expect(noteName(60)).toBe('C4');
    const [c, cs, d] = [KEYS[keyIndex(60)], KEYS[keyIndex(61)], KEYS[keyIndex(62)]];
    expect(cs.black).toBe(true);
    expect(cs.x).toBeGreaterThan(c.x);
    expect(cs.x).toBeLessThan(d.x);
  });

  it('finds the key under a point: black keys at the back, white keys in front and between them', () => {
    const cs = KEYS[keyIndex(61)];
    expect(keyAt(cs.x, cs.zBack + 0.3)).toBe(keyIndex(61));
    expect(keyAt(cs.x, 0.5)).toBe(keyAt(cs.x, 0.5)); // in front of the black key: a white key
    expect(KEYS[keyAt(cs.x, 0.5)].black).toBe(false);
    const d = KEYS[keyIndex(62)];
    expect(keyAt(d.x, cs.zBack + 0.3)).toBe(keyIndex(62)); // between C# and D#
    expect(keyAt(d.x, 5)).toBe(-1);
  });

  it('the song is Mary Had a Little Lamb on C, D, E and G', () => {
    expect(SONG).toHaveLength(26);
    expect(new Set(SONG.map(([m]) => noteName(m)))).toEqual(new Set(['C4', 'D4', 'E4', 'G4']));
    expect(SONG.map(([, , w]) => w).join(' ')).toBe('Ma ry had a lit tle lamb, lit tle lamb, lit tle lamb, Ma ry had a lit tle lamb, its fleece was white as snow.');
  });
});

describe('fingers against keys', () => {
  const white = KEYS[keyIndex(64)];
  const tip = (dy: number, k = white) => new THREE.Vector3(k.x, k.top + PAD + dy, 0.4 * (k.black ? -1 : 1));

  it('a fingertip above a key does nothing; pushing into it moves the key exactly as far', () => {
    expect(pressKeys([tip(0.02)]).depress[keyIndex(64)]).toBe(0);
    const c = pressKeys([tip(-0.05)]);
    expect(c.depress[keyIndex(64)]).toBeCloseTo(0.05, 6);
    expect(c.lift).toBe(0);
  });

  it('a key stops at the bottom of its travel and the finger is pushed back up', () => {
    const c = pressKeys([tip(-0.25)]);
    expect(c.depress[keyIndex(64)]).toBeCloseTo(TRAVEL, 6);
    expect(c.lift).toBeCloseTo(0.25 - TRAVEL, 6);
  });

  it('black keys stand higher, so they are met first', () => {
    const black = KEYS[keyIndex(63)];
    const p = new THREE.Vector3(black.x, black.top + PAD - 0.03, black.zBack + 0.3);
    expect(pressKeys([p]).depress[keyIndex(63)]).toBeCloseTo(0.03, 6);
  });

  it('a note sounds when the key nears the bottom, and stops after it springs back up', () => {
    const state = { depth: new Float32Array(KEYS.length), down: new Uint8Array(KEYS.length) };
    const pushed = new Float32Array(KEYS.length);
    pushed[keyIndex(64)] = STRIKE * 0.9;
    expect(stepKeys(state, pushed, 1 / 60)).toEqual([]);
    pushed[keyIndex(64)] = TRAVEL;
    const on = stepKeys(state, pushed, 1 / 60);
    expect(on).toHaveLength(1);
    expect(on[0]).toMatchObject({ midi: 64, on: true });
    expect(on[0].velocity).toBeGreaterThan(0.1);
    pushed.fill(0);
    const off = [];
    for (let i = 0; i < 20 && state.depth[keyIndex(64)] >= RESET; i++) off.push(...stepKeys(state, pushed, 1 / 60));
    expect(off.some((e) => e.midi === 64 && !e.on)).toBe(true);
  });
});

describe('robot hands on the keys', () => {
  it('at rest the right hand sits in the C position: thumb C4, index D4, middle E4, ring F4, little G4, nothing pressed', () => {
    const tips = fingertips(pose('right', REST), 'right');
    expect(tips.map(keyUnder)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4']);
    const c = pressKeys(tips);
    expect(Math.max(...c.depress)).toBe(0);
    expect(c.lift).toBe(0);
  });

  it('at rest the left hand covers C3 to G3, little finger on C', () => {
    const tips = fingertips(pose('left', REST), 'left');
    expect(tips.map(keyUnder)).toEqual(['G3', 'F3', 'E3', 'D3', 'C3']);
    expect(Math.max(...pressKeys(tips).depress)).toBe(0);
  });

  it('pressing down with one finger plays that finger’s key only', () => {
    const names = ['C4', 'D4', 'E4', 'F4', 'G4'];
    for (let f = 0; f < 5; f++) {
      const c = pressKeys(fingertips(pose('right', pressed(f, 1)), 'right'));
      const down = KEYS.filter((_, i) => c.depress[i] >= STRIKE).map((k) => k.name);
      expect(down, `finger ${f}`).toEqual([names[f]]);
    }
  });

  it('at every depth of a press, a finger only ever touches its own key', () => {
    const names = ['C4', 'D4', 'E4', 'F4', 'G4'];
    for (let f = 0; f < 5; f++)
      for (let p = 0; p <= 1.1001; p += 0.05) {
        const c = pressKeys(fingertips(pose('right', pressed(f, p)), 'right'));
        const touched = KEYS.filter((_, i) => c.depress[i] > 0).map((k) => k.name);
        expect(touched.every((n) => n === names[f]), `finger ${f} at ${p.toFixed(2)} touched ${touched}`).toBe(true);
      }
  });

  it('lowering the whole hand presses the keys under all five fingers, and it rests on them', () => {
    const c = pressKeys(fingertips(pose('right', REST, 0.4), 'right'));
    const down = KEYS.filter((_, i) => c.depress[i] > 0).map((k) => k.name);
    expect(down).toEqual(expect.arrayContaining(['C4', 'D4', 'E4', 'F4', 'G4']));
    expect(c.lift).toBeGreaterThan(0);
  });
});
