// Human hand (from any Rokoko-format source) -> robot hand command.
//
// The robot model follows the Inspire RH56 dexterous hand that the Aalto
// Robotics Club already integrated: 6 actuated DoF (thumb rotate, thumb bend,
// and one per finger, with each finger's two links coupled). A human hand has
// about 20 DoF, so retargeting is a deliberate reduction. Each actuator is driven
// by the summed flexion of the matching human finger, normalised against a
// per-user calibration.

import { Matrix4, Quaternion, Vector3 } from 'three';
import { FINGERS, type Quat, type Side, type Vec3 } from '../rokoko/types';
import { angleDeg, type HumanHand, type HumanHands } from '../rokoko/parse';

export const DOF_NAMES = ['thumbRotate', 'thumbBend', 'index', 'middle', 'ring', 'little'] as const;
export const DOF_LABELS = ['Thumb rot', 'Thumb bend', 'Index', 'Middle', 'Ring', 'Little'];
export type Dof6 = [number, number, number, number, number, number];

export interface RobotHandCommand {
  side: Side;
  /** 0 = open, 1 = closed, in DOF_NAMES order. */
  dof: Dof6;
  /** Raw (un-normalised) human measurements, for calibration and debugging. */
  raw: Dof6;
  /** Wrist position in robot workspace (three.js axes, roughly -1..1). */
  position: Vector3;
  /** Wrist orientation relative to the calibrated neutral pose (three.js axes). */
  rotation: Quaternion;
  /** Mean curl of the four fingers. */
  grip: number;
}

export interface SideCalibration {
  /** Per finger, per joint: relative rotation measured with an open hand. */
  openOffsets?: Quat[][];
  min: Dof6;
  max: Dof6;
  neutral?: Quat;
  center?: Vec3;
}

export interface Calibration {
  left: SideCalibration;
  right: SideCalibration;
  /** Metres of hand travel that map to one workspace unit. */
  positionScale: number;
  mirrorX: boolean;
  /** Widen min/max automatically when the user exceeds them. */
  autoRange: boolean;
  /**
   * Without a calibrated neutral wrist pose, take the first frame's orientation as
   * neutral. Used for gloves, whose yaw is relative to magnetic north (arbitrary zero).
   */
  autoNeutral?: boolean;
}

// thumbRotate raw = 3 - (thumbTip↔littleBase distance / palm width): bigger means more opposed.
const DEFAULT_MIN: Dof6 = [1.1, 5, 15, 15, 15, 15];
const DEFAULT_MAX: Dof6 = [2.1, 110, 220, 220, 220, 220];
/** Auto-range never widens past these, so glitch frames can't wreck the range. */
const AUTO_MIN_FLOOR = DEFAULT_MIN.map((v) => v * 0.5) as Dof6;
const AUTO_MAX_CEIL = DEFAULT_MAX.map((v) => v * 1.4) as Dof6;
/** Pointer-style aiming: ~25° of wrist tilt reaches the edge of the workspace. */
const AIM_GAIN = 2.4;

export function defaultCalibration(center: Vec3 = { x: 0, y: 1.2, z: 0.3 }): Calibration {
  const side = (): SideCalibration => ({ min: [...DEFAULT_MIN], max: [...DEFAULT_MAX], center: { ...center } });
  return { left: side(), right: side(), positionScale: 0.25, mirrorX: false, autoRange: true };
}

const toQ = (q: Quat) => new Quaternion(q.x, q.y, q.z, q.w);
const fromQ = (q: Quaternion): Quat => ({ x: q.x, y: q.y, z: q.z, w: q.w });
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Which raw channels carry a real measurement. thumbRotate needs the thumb tip and
 * both finger bases; without them `measure` reports 0, which is not a reading.
 */
export function validChannels(hand: HumanHand, raw: Dof6): boolean[] {
  const thumbLandmarks = !!(hand.thumbTip && hand.indexBase && hand.littleBase);
  return raw.map((r, i) => Number.isFinite(r) && (i !== 0 || thumbLandmarks));
}

/** Measures the six raw channels for one hand. */
export function measure(hand: HumanHand, cal: SideCalibration): Dof6 {
  const flex = (fi: number, from: number) => {
    let sum = 0;
    const joints = hand.relative[FINGERS[fi]];
    for (let j = from; j < 3; j++) {
      let q = joints[j];
      const off = cal.openOffsets?.[fi]?.[j];
      if (off) q = toQ(off).invert().multiply(q);
      sum += angleDeg(q);
    }
    return sum;
  };
  let thumbRotate = 0;
  if (hand.thumbTip && hand.indexBase && hand.littleBase) {
    const palm = hand.indexBase.distanceTo(hand.littleBase) || 1;
    thumbRotate = 3 - hand.thumbTip.distanceTo(hand.littleBase) / palm;
  }
  return [thumbRotate, flex(0, 1), flex(1, 0), flex(2, 0), flex(3, 0), flex(4, 0)];
}

/** Rokoko (left-handed, Y-up) -> three.js (right-handed, Y-up): reflect Z, optionally mirror X. */
function rotationToThree(q: Quaternion, mirrorX: boolean): Quaternion {
  const m = new Matrix4().makeScale(mirrorX ? -1 : 1, 1, -1);
  const r = new Matrix4().makeRotationFromQuaternion(q);
  return new Quaternion().setFromRotationMatrix(m.clone().multiply(r).multiply(m));
}

interface SmoothState {
  dof: Dof6;
  position: Vector3;
  rotation: Quaternion;
  t: number;
}

export class Retargeter {
  private smooth: Partial<Record<Side, SmoothState>> = {};
  /** Seconds. Lower = snappier but noisier. Webcam wants more smoothing than gloves. */
  dofTau = 0.035;
  posTau = 0.05;

  constructor(public calibration: Calibration) {}

  update(hands: HumanHands, now = performance.now() / 1000): Partial<Record<Side, RobotHandCommand>> {
    const out: Partial<Record<Side, RobotHandCommand>> = {};
    for (const side of ['left', 'right'] as Side[]) {
      const hand = hands[side];
      if (!hand) {
        delete this.smooth[side];
        continue;
      }
      out[side] = this.retargetHand(hand, now, !!hands.positionsRelative);
    }
    return out;
  }

  private retargetHand(hand: HumanHand, now: number, positionsRelative: boolean): RobotHandCommand {
    const cal = this.calibration[hand.side];
    if (!cal.neutral && this.calibration.autoNeutral) cal.neutral = fromQ(hand.wristRotation);
    const raw = measure(hand, cal);
    const valid = validChannels(hand, raw);

    if (this.calibration.autoRange) {
      for (let i = 0; i < 6; i++) {
        if (!valid[i]) continue;
        // Expand slowly and within sane bounds so a single glitchy frame can't wreck the range.
        // Only ever widen: a calibrated range already past a bound is left alone.
        const lo = Math.max(raw[i], AUTO_MIN_FLOOR[i]);
        if (lo < cal.min[i]) cal.min[i] += (lo - cal.min[i]) * 0.1;
        const hi = Math.min(raw[i], AUTO_MAX_CEIL[i]);
        if (hi > cal.max[i]) cal.max[i] += (hi - cal.max[i]) * 0.1;
      }
    }
    // A channel with no reading holds its last value instead of snapping open.
    const prev = this.smooth[hand.side]?.dof;
    const target = raw.map((r, i) =>
      valid[i] ? clamp01((r - cal.min[i]) / Math.max(1e-6, cal.max[i] - cal.min[i])) : (prev?.[i] ?? 0),
    ) as Dof6;

    const c = cal.center ?? { x: 0, y: 1.2, z: 0.3 };
    const s = this.calibration.positionScale;
    const pos = new Vector3(
      ((hand.wristPosition.x - c.x) / s) * (this.calibration.mirrorX ? -1 : 1),
      (hand.wristPosition.y - c.y) / s,
      -(hand.wristPosition.z - c.z) / s,
    ).clampScalar(-1.6, 1.6);

    const neutral = cal.neutral ? toQ(cal.neutral) : new Quaternion();
    const delta = hand.wristRotation.clone().multiply(neutral.invert());
    const rot = rotationToThree(delta, this.calibration.mirrorX);

    if (positionsRelative) {
      // No world position: aim like a pointer instead. Where the fingers point (relative to
      // neutral) moves the robot's wrist, so tilting/turning the hand steers the knife.
      const pointing = new Vector3(0, 0, -1).applyQuaternion(rot);
      pos.set(pointing.x * AIM_GAIN, pointing.y * AIM_GAIN, 0).clampScalar(-1.6, 1.6);
    }

    let st = this.smooth[hand.side];
    if (!st) {
      st = { dof: target, position: pos, rotation: rot, t: now };
      this.smooth[hand.side] = st;
    } else {
      const dt = Math.max(0, Math.min(0.2, now - st.t));
      const a = 1 - Math.exp(-dt / this.dofTau);
      const b = 1 - Math.exp(-dt / this.posTau);
      st.dof = st.dof.map((v, i) => v + (target[i] - v) * a) as Dof6;
      st.position.lerp(pos, b);
      st.rotation.slerp(rot, b);
      st.t = now;
    }
    const grip = (st.dof[2] + st.dof[3] + st.dof[4] + st.dof[5]) / 4;
    return { side: hand.side, dof: [...st.dof] as Dof6, raw, position: st.position.clone(), rotation: st.rotation.clone(), grip };
  }
}

/** Calibration step 1: relaxed open hand, held where the user wants "centre". */
export function captureOpen(cal: Calibration, hand: HumanHand) {
  const sc = cal[hand.side];
  sc.openOffsets = FINGERS.map((f) => hand.relative[f].map(fromQ));
  sc.neutral = fromQ(hand.wristRotation);
  sc.center = { x: hand.wristPosition.x, y: hand.wristPosition.y, z: hand.wristPosition.z };
  const raw = measure(hand, sc);
  sc.min = raw.map((r) => r) as Dof6;
  // Keep max above min even before the fist step.
  sc.max = sc.max.map((m, i) => Math.max(m, raw[i] + (DEFAULT_MAX[i] - DEFAULT_MIN[i]) * 0.5)) as Dof6;
}

/** Calibration step 2: tight fist with the thumb tucked across. */
export function captureFist(cal: Calibration, hand: HumanHand) {
  const sc = cal[hand.side];
  const raw = measure(hand, sc);
  sc.max = raw.map((r, i) => Math.max(r, sc.min[i] + 1e-3)) as Dof6;
}

/**
 * Inspire RH56 angle command: 0..1000, 1000 = open, order
 * [little, ring, middle, index, thumbBend, thumbRotate].
 * TODO(hardware): verify order and direction against the Aalto integration.
 */
export function toInspireAngles(dof: Dof6): number[] {
  const open = (v: number) => Math.round((1 - clamp01(v)) * 1000);
  return [open(dof[5]), open(dof[4]), open(dof[3]), open(dof[2]), open(dof[1]), open(dof[0])];
}
