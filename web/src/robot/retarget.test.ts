import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { buildFrame, type HandPoseSpec } from '../rokoko/build';
import { parseFrame } from '../rokoko/parse';
import { captureFist, captureOpen, defaultCalibration, measure, Retargeter, toInspireAngles } from './retarget';

function pose(curl: number, thumbRotate = 0, side: 'left' | 'right' = 'right', rot = new Quaternion()): HandPoseSpec {
  return { side, wristPosition: new Vector3(0.1, 1.3, 0.35), wristRotation: rot, curl: [curl, curl, curl, curl, curl], thumbRotate };
}
const hands = (spec: HandPoseSpec) => parseFrame(buildFrame([spec], 0));

describe('Rokoko frame -> robot command', () => {
  it('parses both hands from a built frame', () => {
    const f = buildFrame([pose(0, 0, 'left'), pose(0.5)], 1);
    const h = parseFrame(f);
    expect(h.left?.side).toBe('left');
    expect(h.right?.side).toBe('right');
    expect(h.actorName).toBe('Senecai Emulator');
  });

  it('respects meta flags: a hand flagged absent is ignored', () => {
    const f = buildFrame([pose(0)], 0);
    f.scene.actors[0].meta.hasRightGlove = false;
    expect(parseFrame(f).right).toBeUndefined();
  });

  it('raw channels grow monotonically with curl and opposition', () => {
    const cal = defaultCalibration();
    const open = measure(hands(pose(0, 0)).right!, cal.right);
    const half = measure(hands(pose(0.5, 0.5)).right!, cal.right);
    const fist = measure(hands(pose(1, 1)).right!, cal.right);
    for (let i = 0; i < 6; i++) {
      expect(half[i]).toBeGreaterThan(open[i]);
      expect(fist[i]).toBeGreaterThan(half[i]);
    }
    // Keep the default calibration honest: it should roughly span the emulator's range.
    expect(open[0]).toBeGreaterThan(0.8);
    expect(fist[0]).toBeLessThan(2.4);
  });

  it('calibrated open/fist map to ~0 and ~1, independent of wrist orientation', () => {
    const rot = new Quaternion().setFromAxisAngle(new Vector3(0.3, 1, 0.2).normalize(), 1.2);
    const cal = defaultCalibration();
    cal.autoRange = false;
    captureOpen(cal, hands(pose(0, 0, 'right', rot)).right!);
    captureFist(cal, hands(pose(1, 1, 'right', rot)).right!);
    const r = new Retargeter(cal);
    const open = r.update(hands(pose(0, 0, 'right', rot)), 0).right!;
    expect(Math.max(...open.dof)).toBeLessThan(0.02);
    r.update(hands(pose(1, 1, 'right', rot)), 10);
    const fist = r.update(hands(pose(1, 1, 'right', rot)), 20).right!;
    expect(Math.min(...fist.dof)).toBeGreaterThan(0.98);
    // Neutral orientation captured -> robot wrist at identity.
    expect(open.rotation.angleTo(new Quaternion())).toBeLessThan(1e-3);
    expect(open.position.length()).toBeLessThan(1e-6);
  });

  it('auto-range ignores missing thumb landmarks and bounds min against noise', () => {
    const cal = defaultCalibration();
    captureOpen(cal, hands(pose(0, 0)).right!);
    captureFist(cal, hands(pose(1, 1)).right!);
    const calMin = cal.right.min[0];
    const r = new Retargeter(cal);
    let t = 0;
    r.update(hands(pose(0.5, 0.5)), t);
    const held = r.update(hands(pose(0.5, 0.5)), (t += 1)).right!.dof[0];

    // ~20 frames without the thumb tip: thumbRotate measures 0 but is not a reading.
    for (let i = 0; i < 20; i++) {
      const f = buildFrame([pose(0.5, 0.5)], 0);
      delete f.scene.actors[0].body.rightThumbTip;
      const h = parseFrame(f);
      expect(h.right?.thumbTip).toBeUndefined();
      const cmd = r.update(h, (t += 1 / 30)).right!;
      expect(cmd.raw[0]).toBe(0);
      expect(cmd.dof[0]).toBeCloseTo(held, 6); // holds instead of snapping open
    }
    expect(cal.right.min[0]).toBe(calMin);

    // Noisy frames with a valid but absurdly low reading can't drag min past its floor.
    for (let i = 0; i < 200; i++) {
      const h = hands(pose(0.5, 0.5));
      h.right!.thumbTip = h.right!.littleBase!.clone().add(h.right!.indexBase!.clone().sub(h.right!.littleBase!).multiplyScalar(10));
      r.update(h, (t += 1 / 30));
    }
    expect(cal.right.min[0]).toBeGreaterThanOrEqual(0.55 - 1e-9);
    expect(cal.right.min[0]).toBeLessThan(calMin);

    // Normal values afterwards still map linearly through the (bounded) range.
    r.update(hands(pose(1, 1)), (t += 10));
    expect(r.update(hands(pose(1, 1)), (t += 10)).right!.dof[0]).toBeGreaterThan(0.98);
    r.update(hands(pose(0, 0)), (t += 10));
    const open = r.update(hands(pose(0, 0)), (t += 10)).right!;
    const { min, max } = cal.right;
    expect(open.dof[0]).toBeCloseTo((open.raw[0] - min[0]) / (max[0] - min[0]), 4);
    expect(open.dof[0]).toBeLessThan(0.4);
    expect(Math.max(...open.dof.slice(1))).toBeLessThan(0.02);
  });

  it('auto-range with missing thumb landmarks keeps the calibrated mapping exact', () => {
    const cal = defaultCalibration();
    captureOpen(cal, hands(pose(0, 0)).right!);
    captureFist(cal, hands(pose(1, 1)).right!);
    const before = { min: [...cal.right.min], max: [...cal.right.max] };
    const r = new Retargeter(cal);
    for (let i = 0; i < 20; i++) {
      const f = buildFrame([pose(0, 0)], 0);
      delete f.scene.actors[0].body.rightThumbTip;
      r.update(parseFrame(f), i / 30);
    }
    expect(cal.right.min).toEqual(before.min);
    expect(cal.right.max).toEqual(before.max);
    const r2 = new Retargeter(cal);
    expect(r2.update(hands(pose(0, 0)), 0).right!.dof[0]).toBeLessThan(0.02);
    r2.update(hands(pose(1, 1)), 10);
    expect(r2.update(hands(pose(1, 1)), 20).right!.dof[0]).toBeGreaterThan(0.98);
  });

  it('exports Inspire angles (1000 = open)', () => {
    expect(toInspireAngles([0, 0, 0, 0, 0, 0])).toEqual([1000, 1000, 1000, 1000, 1000, 1000]);
    expect(toInspireAngles([1, 0.5, 0.25, 0, 0, 1])).toEqual([0, 1000, 1000, 750, 500, 0]);
  });
});
