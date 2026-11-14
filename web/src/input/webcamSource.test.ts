// Checks the webcam emulator against the keyboard FK: synthesise MediaPipe
// landmarks from a known hand pose, convert them to Rokoko joints, and check
// the retargeter reads back the curl we put in.
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { buildFrame } from '../rokoko/build';
import { parseFrame } from '../rokoko/parse';
import { FINGERS, PHALANGES, fingerJoint, type JointFrame, type Side } from '../rokoko/types';
import { measure, defaultCalibration } from '../robot/retarget';
import { landmarksToJoints } from './webcamSource';

function syntheticLandmarks(curl: number, side: Side, thumbRotate = 0) {
  const f = buildFrame([{ side, wristPosition: new Vector3(), wristRotation: new Quaternion(), curl: [curl, curl, curl, curl, curl], thumbRotate }], 0);
  const b = f.scene.actors[0].body;
  const order: string[] = [`${side}Hand`];
  for (const finger of FINGERS) for (const ph of PHALANGES) order.push(fingerJoint(side, finger, ph));
  const world = order.map((k) => {
    const p = b[k]!.position;
    return { x: -p.x, y: -p.y, z: -p.z, visibility: 1 }; // Rokoko -> MediaPipe axes
  });
  const image = world.map((w) => ({ x: 0.5 + w.x, y: 0.5 + w.y, z: w.z, visibility: 1 }));
  return { world, image };
}

function readLandmarks(side: Side, curl: number, rot = 0) {
  const { world, image } = syntheticLandmarks(curl, side, rot);
  const body: Record<string, JointFrame> = {};
  landmarksToJoints(side, world, image, body);
  const hands = parseFrame({ version: 3, fps: 30, scene: { timestamp: 0, actors: [{ name: 'w', meta: { hasGloves: true, hasLeftGlove: side === 'left', hasRightGlove: side === 'right', hasBody: false, hasFace: false }, body }], props: [] } });
  return { raw: measure(hands[side]!, defaultCalibration()[side]), hand: hands[side]! };
}

describe('webcam emulator', () => {
  for (const side of ['left', 'right'] as Side[]) {
    it(`${side} hand: landmark-derived frames track curl`, () => {
      const read = (curl: number, rot = 0) => readLandmarks(side, curl, rot);
      const open = read(0);
      const half = read(0.5, 0.5);
      const fist = read(1, 1);
      for (let i = 1; i < 6; i++) {
        expect(half.raw[i]).toBeGreaterThan(open.raw[i] + 20);
        expect(fist.raw[i]).toBeGreaterThan(half.raw[i] + 20);
      }
      expect(fist.raw[0]).toBeGreaterThan(open.raw[0]);
      // Open hand in the canonical pose (palm to camera, fingers up) => near-identity wrist.
      expect(open.hand.wristRotation.angleTo(new Quaternion())).toBeLessThan(0.15);
      // Open hand: fingers nearly straight.
      expect(open.raw[2]).toBeLessThan(10);
    });

    it(`${side} hand: curl sweep past 90 degrees has no frame flip`, () => {
      // curl 0..1 bends the index proximal joint to 80 deg and the medial bone
      // to ~175 deg from the palm plane, so every bone passes the palm normal.
      const steps = 100;
      let prev = readLandmarks(side, 0).raw;
      for (let s = 1; s <= steps; s++) {
        const c = s / steps;
        const raw = readLandmarks(side, c, c).raw;
        // Index: ~2.35 deg of summed flex per step.
        expect(raw[2]).toBeGreaterThanOrEqual(prev[2] - 0.5);
        expect(raw[2] - prev[2]).toBeLessThan(6);
        // Thumb bend must not jump either.
        expect(Math.abs(raw[1] - prev[1])).toBeLessThan(6);
        prev = raw;
      }
      expect(prev[2]).toBeGreaterThan(200);
    });
  }
});
