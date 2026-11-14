// Rokoko Device SDK path, end to end inside the app: solved OpenXR hands (as the
// SDK's rkk-hand-solver emits them) -> the bridge's conversion -> the app's
// parser and retargeter -> robot actuator commands.
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
// @ts-expect-error plain JS module from the bridge package
import { buildStudioFrame, synthOpenXrHand } from '../../../bridge/src/openxr-hand.js';
import { parseFrame } from '../rokoko/parse';
import type { RokokoFrame } from '../rokoko/types';
import { captureFist, captureOpen, defaultCalibration, Retargeter } from '../robot/retarget';

type Joint = { name: string; p: number[]; q: number[] };
function sdkFrame(side: 'left' | 'right', curl: number, wristQ: number[] = [0, 0, 0, 1]): RokokoFrame {
  const joints = (synthOpenXrHand(side, [curl, curl, curl, curl, curl], curl, wristQ) as Joint[]).map((j) => [j.name, { p: j.p, q: j.q }] as const);
  return buildStudioFrame({ [side]: new Map(joints) }, 0) as RokokoFrame;
}

describe('Rokoko Device SDK gloves', () => {
  it('parses as a glove actor with wrist-relative positions', () => {
    const hands = parseFrame(sdkFrame('right', 0.3));
    expect(hands.actorName).toBe('Rokoko Device SDK');
    expect(hands.positionsRelative).toBe(true);
    expect(hands.right).toBeDefined();
    expect(hands.left).toBeUndefined();
  });

  for (const side of ['left', 'right'] as const) {
    it(`${side} glove: calibrated open/fist drive all six actuators 0 -> 1`, () => {
      const cal = defaultCalibration();
      cal.autoRange = false;
      captureOpen(cal, parseFrame(sdkFrame(side, 0))[side]!);
      captureFist(cal, parseFrame(sdkFrame(side, 1))[side]!);
      const r = new Retargeter(cal);
      const open = r.update(parseFrame(sdkFrame(side, 0)), 0)[side]!;
      expect(Math.max(...open.dof)).toBeLessThan(0.02);
      r.update(parseFrame(sdkFrame(side, 0.5)), 10);
      const half = r.update(parseFrame(sdkFrame(side, 0.5)), 20)[side]!;
      for (const v of half.dof) expect(v).toBeGreaterThan(0.2), expect(v).toBeLessThan(0.8);
    });
  }

  it('aims from wrist orientation: auto-neutral centres, tilting the hand moves the target', () => {
    const cal = defaultCalibration();
    cal.autoNeutral = true;
    const r = new Retargeter(cal);
    // Arbitrary starting yaw (magnetic north): becomes the neutral pose.
    const start = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.1);
    const first = r.update(parseFrame(sdkFrame('right', 0, start.toArray())), 0).right!;
    expect(first.position.length()).toBeLessThan(1e-6);

    // Turn the hand 20° about the vertical axis: the aim moves sideways, not up/down.
    const turned = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.35).multiply(start);
    const r2 = new Retargeter(cal);
    r2.update(parseFrame(sdkFrame('right', 0, turned.toArray())), 0);
    const aim = r2.update(parseFrame(sdkFrame('right', 0, turned.toArray())), 10).right!;
    expect(Math.abs(aim.position.x)).toBeGreaterThan(0.5);
    expect(Math.abs(aim.position.y)).toBeLessThan(0.05);
  });
});
