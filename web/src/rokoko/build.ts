// Builds Rokoko JSON v3 frames from a simple hand description, using forward
// kinematics. The keyboard emulator uses it, and so do the tests that check the
// parser recovers what we put in. The webcam emulator builds its frames
// directly from tracked landmarks (see input/webcamSource.ts) but emits the
// same structure.
//
// Hand-local axes (canonical pose: hand raised, palm facing the screen):
//   +Y = along the fingers, +Z = out of the palm, +X = Y × Z.
// Flexing a joint rotates about local +X, which turns the bone towards the palm.

import { Matrix4, Quaternion, Vector3 } from 'three';
import { FINGERS, PHALANGES, fingerJoint, handJoint, type ActorFrame, type JointFrame, type RokokoFrame, type Side } from './types';

export interface HandPoseSpec {
  side: Side;
  /** Rokoko space, metres. */
  wristPosition: Vector3;
  wristRotation: Quaternion;
  /** 0 = straight, 1 = fully curled. Index 0 = thumb (bend), 1..4 = index..little. */
  curl: [number, number, number, number, number];
  /** Thumb opposition (swing across the palm), 0..1. */
  thumbRotate: number;
}

const FINGER_LENGTHS: [number, number, number][] = [
  [0.04, 0.032, 0.025], // thumb
  [0.045, 0.028, 0.022],
  [0.05, 0.031, 0.024],
  [0.046, 0.029, 0.023],
  [0.036, 0.022, 0.02],
];
/** Max flex per joint (radians) at curl = 1. Thumb's first joint is driven by thumbRotate. */
export const FLEX_RANGE: [number, number, number][] = [
  [0, 0.9, 1.2],
  [1.4, 1.65, 1.05],
  [1.4, 1.65, 1.05],
  [1.4, 1.65, 1.05],
  [1.4, 1.65, 1.05],
];

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
function joint(p: Vector3, q: Quaternion): JointFrame {
  return {
    position: { x: r5(p.x), y: r5(p.y), z: r5(p.z) },
    rotation: { x: r5(q.x), y: r5(q.y), z: r5(q.z), w: r5(q.w) },
  };
}

export function buildHandJoints(spec: HandPoseSpec, body: Record<string, JointFrame>) {
  const sgn = spec.side === 'right' ? 1 : -1;
  const handRot = spec.wristRotation;
  body[handJoint(spec.side)] = joint(spec.wristPosition, handRot);

  FINGERS.forEach((finger, fi) => {
    const isThumb = fi === 0;
    const base = isThumb ? new Vector3(sgn * -0.025, 0.02, 0.01) : new Vector3(sgn * (-0.03 + (fi - 1) * 0.02), 0.09, 0);
    let rot = handRot.clone();
    if (isThumb) {
      // Rest: thumb splayed 45° out to the side. Opposition swings it towards the palm.
      const splay = new Quaternion().setFromAxisAngle(Z, sgn * 0.8);
      const oppose = new Quaternion().setFromAxisAngle(Y, sgn * spec.thumbRotate * 1.1);
      rot.multiply(oppose).multiply(splay);
    }
    const pos = spec.wristPosition.clone().add(base.applyQuaternion(handRot));
    PHALANGES.forEach((ph, pi) => {
      if (pi < 3) rot = rot.clone().multiply(new Quaternion().setFromAxisAngle(X, FLEX_RANGE[fi][pi] * spec.curl[fi]));
      body[fingerJoint(spec.side, finger, ph)] = joint(pos, rot);
      if (pi < 3) pos.add(new Vector3(0, FINGER_LENGTHS[fi][pi], 0).applyQuaternion(rot));
    });
  });
}

export function buildFrame(hands: HandPoseSpec[], timestamp: number, actorName = 'Senecai Emulator', fps = 60): RokokoFrame {
  const body: Record<string, JointFrame> = {};
  for (const h of hands) buildHandJoints(h, body);
  const has = (s: Side) => hands.some((h) => h.side === s);
  const actor: ActorFrame = {
    name: actorName,
    color: [200, 121, 65],
    meta: { hasGloves: hands.length > 0, hasLeftGlove: has('left'), hasRightGlove: has('right'), hasBody: false, hasFace: false },
    dimensions: { totalHeight: 1.8, hipHeight: 0.95 },
    body,
  };
  return { version: 3, fps, scene: { timestamp, actors: [actor], props: [] } };
}

/** Orientation whose +Y points along `forward` and +Z along (orthogonalised) `normal`. */
export function basisQuaternion(forward: Vector3, normal: Vector3, out = new Quaternion()): Quaternion {
  const y = forward.clone().normalize();
  const z = normal.clone().addScaledVector(y, -normal.dot(y)).normalize();
  const x = new Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}
