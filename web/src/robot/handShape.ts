// Your hand's shape, one to one: every bone of every finger, as measured.
//
// Built from joint positions rather than joint rotations, so it means the same
// thing for every source (gloves, webcam, keyboard) whatever their rotation
// conventions. Each robot finger link is turned to point exactly along the
// matching bone of your hand, measured in your palm's own frame: bend at each of
// the three joints, sideways spread, hyperextension, all as they are. Nothing
// is calibrated, scaled or limited.

import { Quaternion, Vector3 } from 'three';
import type { HumanHand } from '../rokoko/parse';
import { FINGERS } from '../rokoko/types';

/** Robot link orientations, each relative to its parent (identity = straight). */
export interface HandShape {
  /** Thumb: [proximal phalanx relative to the palm, distal phalanx relative to the proximal]. */
  thumb: [Quaternion, Quaternion];
  /** Index..little: [proximal, middle, distal], each relative to its parent. */
  fingers: [Quaternion, Quaternion, Quaternion][];
}

/** The shape as a flat list of quaternion components (thumb links, then index..little links), for recordings. */
export function packShape(s: HandShape, round = (v: number) => v): number[] {
  return [...s.thumb, ...s.fingers.flat()].flatMap((q) => q.toArray().map(round));
}

export function unpackShape(a: number[]): HandShape | undefined {
  if (a.length !== 14 * 4) return undefined;
  const q = (i: number) => new Quaternion().fromArray(a, i * 4).normalize();
  return { thumb: [q(0), q(1)], fingers: [0, 1, 2, 3].map((f) => [q(2 + f * 3), q(3 + f * 3), q(4 + f * 3)] as [Quaternion, Quaternion, Quaternion]) };
}

/** Between two shapes, link by link. */
export function blendShape(a: HandShape, b: HandShape, k: number): HandShape {
  return {
    thumb: a.thumb.map((q, i) => q.clone().slerp(b.thumb[i], k)) as [Quaternion, Quaternion],
    fingers: a.fingers.map((f, i) => f.map((q, j) => q.clone().slerp(b.fingers[i][j], k)) as [Quaternion, Quaternion, Quaternion]),
  };
}

/** A link at rest points along -Z (from the knuckle towards the fingertip). */
const ALONG = new Vector3(0, 0, -1);

/** Rokoko space (left-handed) -> three.js (right-handed): reflect Z. */
const toThree = (v: Vector3) => new Vector3(v.x, v.y, -v.z);

/**
 * Chain of links pointing along the given directions (palm frame). Each link
 * turns by the smallest rotation from where its parent points, so links don't
 * pick up a twist the hand doesn't have.
 */
function chain(dirs: Vector3[]): Quaternion[] {
  const out: Quaternion[] = [];
  let global = new Quaternion();
  for (const d of dirs) {
    const from = ALONG.clone().applyQuaternion(global);
    const next = new Quaternion().setFromUnitVectors(from, d).multiply(global);
    out.push(global.clone().invert().multiply(next));
    global = next;
  }
  return out;
}

export function handShape(hand: HumanHand): HandShape | undefined {
  const pts = hand.points;
  if (!pts) return undefined;
  const P = Object.fromEntries(FINGERS.map((f) => [f, pts[f].map(toThree)])) as Record<(typeof FINGERS)[number], Vector3[]>;
  const wrist = toThree(hand.wristPosition);

  // The palm's frame, matched to the robot palm: its knuckles lie on a line
  // across the palm (+X, towards the little finger), the back of the hand is +Y
  // (the plane through the wrist and the knuckles), and a straight finger points
  // along -Z. A robot left hand is drawn mirrored, so its frame is the mirror image.
  const right = hand.side === 'right';
  const toIndex = P.Index[0].clone().sub(wrist);
  const toLittle = P.Little[0].clone().sub(wrist);
  const y = (right ? toLittle.clone().cross(toIndex) : toIndex.clone().cross(toLittle)).normalize();
  const across = P.Little[0].clone().sub(P.Index[0]);
  const x = across.addScaledVector(y, -across.dot(y)).normalize();
  if (!Number.isFinite(x.x) || !Number.isFinite(y.x)) return undefined;
  const z = right ? x.clone().cross(y) : y.clone().cross(x);
  const local = (v: Vector3) => new Vector3(v.dot(x), v.dot(y), v.dot(z)).normalize();
  const bones = (p: Vector3[]) => [local(p[1].clone().sub(p[0])), local(p[2].clone().sub(p[1])), local(p[3].clone().sub(p[2]))];

  const fingers = (['Index', 'Middle', 'Ring', 'Little'] as const).map((f) => chain(bones(P[f])) as [Quaternion, Quaternion, Quaternion]);
  // The thumb's first bone (the metacarpal) lies inside the palm; the robot's two thumb links are its two phalanges.
  const t = bones(P.Thumb);
  const thumb = chain([t[1], t[2]]) as [Quaternion, Quaternion];
  return { thumb, fingers };
}
