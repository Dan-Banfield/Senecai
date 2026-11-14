// The robot hand shows your fingers one to one, whatever the source.
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module from the bridge package
import { buildStudioFrame, synthOpenXrHand } from '../../../bridge/src/openxr-hand.js';
import { buildFrame, FLEX_RANGE } from '../rokoko/build';
import { parseFrame } from '../rokoko/parse';
import type { RokokoFrame, Side } from '../rokoko/types';
import { handShape, packShape, unpackShape, type HandShape } from './handShape';

type C5 = [number, number, number, number, number];
/** A hand from the keyboard/webcam frame builder (Rokoko convention), held at an arbitrary angle. */
const emulated = (side: Side, curl: C5) =>
  handShape(parseFrame(buildFrame([{ side, wristPosition: new Vector3(0.1, 1.2, 0.3), wristRotation: new Quaternion().setFromAxisAngle(new Vector3(1, 2, 0.5).normalize(), 0.9), curl, thumbRotate: 0 }], 0))[side]!)!;
/** The same hand as the Rokoko Device SDK reports it (OpenXR convention, through the bridge). */
const sdk = (side: Side, curl: C5) => {
  type J = { name: string; p: number[]; q: number[] };
  const joints = (synthOpenXrHand(side, curl, 0) as J[]).map((j) => [j.name, { p: j.p, q: j.q }] as const);
  return handShape(parseFrame(buildStudioFrame({ [side]: new Map(joints) }, 0) as RokokoFrame)[side]!)!;
};
const angle = (q: Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
const along = (q: Quaternion) => new Vector3(0, 0, -1).applyQuaternion(q);

describe('hand shape', () => {
  for (const side of ['left', 'right'] as Side[]) {
    it(`${side}: a straight hand shows straight fingers`, () => {
      const s = emulated(side, [0, 0, 0, 0, 0]);
      for (const f of s.fingers) for (const q of f) expect(angle(q)).toBeLessThan(1e-3); // joint positions are rounded to 0.01 mm
    });

    it(`${side}: each joint bends by exactly the hand's angle, towards the palm`, () => {
      const s = emulated(side, [0, 0.5, 0.5, 0.5, 0.5]);
      for (const f of s.fingers) {
        f.forEach((q, j) => expect(Math.abs(angle(q) - FLEX_RANGE[1][j] * 0.5)).toBeLessThan(2e-3));
        expect(along(f[0]).y).toBeLessThan(-0.3); // the proximal link points down, into the palm side
        expect(Math.abs(along(f[0]).x)).toBeLessThan(1e-3); // and not sideways
      }
    });

    it(`${side}: one finger bends while the others stay straight`, () => {
      const s = emulated(side, [0, 0, 0.8, 0, 0]);
      expect(angle(s.fingers[1][0])).toBeGreaterThan(1);
      for (const f of [0, 2, 3]) expect(angle(s.fingers[f][0])).toBeLessThan(1e-3);
    });

    it(`${side}: gloves (SDK) and the emulators give the same shape for the same hand`, () => {
      const curl: C5 = [0.3, 0.2, 0.6, 0.9, 0.4];
      const a = sdk(side, curl);
      const b = emulated(side, curl);
      a.fingers.forEach((f, i) => f.forEach((q, j) => expect(q.angleTo(b.fingers[i][j])).toBeLessThan(0.02)));
    });
  }

  it('packs into recordings and back unchanged', () => {
    const s = emulated('right', [0.2, 0.4, 0.1, 0.7, 0.3]);
    const back = unpackShape(packShape(s)) as HandShape;
    s.fingers.forEach((f, i) => f.forEach((q, j) => expect(q.angleTo(back.fingers[i][j])).toBeLessThan(1e-6)));
    s.thumb.forEach((q, i) => expect(q.angleTo(back.thumb[i])).toBeLessThan(1e-6));
  });
});
