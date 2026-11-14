// Rokoko JSON v3 frame -> per-hand pose, the only thing the rest of the app reads.
// Real gloves (via the bridge), the webcam emulator and the keyboard emulator
// all produce RokokoFrames, so they all go through this one function.

import { Quaternion, Vector3 } from 'three';
import { FINGERS, fingerJoint, handJoint, type ActorFrame, type Finger, type JointFrame, type RokokoFrame, type Side } from './types';

export interface HumanHand {
  side: Side;
  /** Rokoko space (Y-up, left-handed), metres. */
  wristPosition: Vector3;
  wristRotation: Quaternion;
  /** Per finger: [hand→proximal, proximal→medial, medial→distal] relative rotations. */
  relative: Record<Finger, [Quaternion, Quaternion, Quaternion]>;
  thumbTip?: Vector3;
  indexBase?: Vector3;
  littleBase?: Vector3;
  /** Per finger: positions of the Proximal, Medial and Distal joints and the Tip (Rokoko space). */
  points?: Record<Finger, [Vector3, Vector3, Vector3, Vector3]>;
}

export interface HumanHands {
  actorName: string;
  timestamp: number;
  /** True when the source has no world hand position (SDK gloves without a Coil Pro). */
  positionsRelative?: boolean;
  /**
   * True when wrist orientations use OpenXR's hand frame in a gravity-aligned
   * world (Rokoko Device SDK): fingers along -Z, back of the hand +Y, Y up.
   */
  framesOpenXR?: boolean;
  left?: HumanHand;
  right?: HumanHand;
}

const vec = (j: JointFrame) => new Vector3(j.position.x, j.position.y, j.position.z);
const quat = (j: JointFrame) => new Quaternion(j.rotation.x, j.rotation.y, j.rotation.z, j.rotation.w).normalize();
const rel = (parent: Quaternion, child: Quaternion) => parent.clone().invert().multiply(child);

function parseHand(actor: ActorFrame, side: Side): HumanHand | undefined {
  const b = actor.body;
  const hand = b[handJoint(side)];
  if (!hand) return undefined;
  const flag = side === 'left' ? actor.meta?.hasLeftGlove : actor.meta?.hasRightGlove;
  if (flag === false) return undefined;

  const handQ = quat(hand);
  const relative = {} as HumanHand['relative'];
  for (const finger of FINGERS) {
    const p = b[fingerJoint(side, finger, 'Proximal')];
    const m = b[fingerJoint(side, finger, 'Medial')];
    const d = b[fingerJoint(side, finger, 'Distal')];
    if (!p || !m || !d) return undefined;
    const pq = quat(p);
    const mq = quat(m);
    relative[finger] = [rel(handQ, pq), rel(pq, mq), rel(mq, quat(d))];
  }
  const tip = b[fingerJoint(side, 'Thumb', 'Tip')];
  const ib = b[fingerJoint(side, 'Index', 'Proximal')];
  const lb = b[fingerJoint(side, 'Little', 'Proximal')];
  let points: HumanHand['points'];
  const all = FINGERS.map((f) => (['Proximal', 'Medial', 'Distal', 'Tip'] as const).map((ph) => b[fingerJoint(side, f, ph)]));
  if (all.every((js) => js.every(Boolean))) points = Object.fromEntries(FINGERS.map((f, i) => [f, all[i].map((j) => vec(j!))])) as HumanHand['points'];
  return {
    side,
    wristPosition: vec(hand),
    wristRotation: handQ,
    relative,
    thumbTip: tip && vec(tip),
    indexBase: ib && vec(ib),
    littleBase: lb && vec(lb),
    points,
  };
}

/** Picks the first actor that has hand data (gloves preferred) and extracts both hands. */
export function parseFrame(frame: RokokoFrame, preferredActor?: string): HumanHands {
  const actors = frame.scene.actors;
  const actor =
    (preferredActor && actors.find((a) => a.name === preferredActor)) ||
    actors.find((a) => a.meta?.hasGloves) ||
    actors.find((a) => a.body?.leftHand || a.body?.rightHand);
  if (!actor) return { actorName: '', timestamp: frame.scene.timestamp };
  return {
    actorName: actor.name,
    timestamp: frame.scene.timestamp,
    positionsRelative: actor.senecai?.positions === 'wrist-relative',
    framesOpenXR: actor.senecai?.frames === 'openxr',
    left: parseHand(actor, 'left'),
    right: parseHand(actor, 'right'),
  };
}

/** Rotation angle of a quaternion, in degrees (0..180). */
export function angleDeg(q: Quaternion): number {
  return (2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180) / Math.PI;
}
