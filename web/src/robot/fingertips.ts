// Where the robot hand's fingertips are, computed from its pose with the same
// joint chain RobotHand draws (so physics can run before the frame renders).
// Order: thumb, index, middle, ring, little. Each point is the pad under the
// fingertip, which is what touches things.

import * as THREE from 'three';
import type { Side } from '../rokoko/types';
import type { HandShape } from './handShape';
import { CURL_GAIN, FINGER_BASE, fingerLinks, THUMB_BASE, THUMB_LEN, THUMB_YAW, type RobotPose } from './RobotHand';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const rot = (axis: THREE.Vector3, a: number) => new THREE.Quaternion().setFromAxisAngle(axis, a);

/**
 * Fingertip pads in the hand's own frame (before mirroring and scale): from the
 * hand's measured shape when there is one, else from the actuator values.
 */
export function fingertipsLocal(dof: readonly number[], shape?: HandShape): THREE.Vector3[] {
  const tips: THREE.Vector3[] = [];
  if (shape) {
    const t = new THREE.Vector3(0, -0.05, -THUMB_LEN[1]).applyQuaternion(shape.thumb[1]).add(new THREE.Vector3(0, 0, -THUMB_LEN[0]));
    tips.push(t.applyQuaternion(shape.thumb[0]).add(new THREE.Vector3(...THUMB_BASE)));
  } else {
    // Thumb: swings across the palm (rotate), then bends at two coupled joints.
    const t = new THREE.Vector3(0, -0.05, -THUMB_LEN[1]).applyQuaternion(rot(X, -dof[1] * 1.4)).add(new THREE.Vector3(0, 0, -THUMB_LEN[0]));
    t.applyQuaternion(rot(X, -dof[1])).applyQuaternion(rot(Y, THUMB_YAW)).applyQuaternion(rot(Z, dof[0] * 1.15));
    tips.push(t.add(new THREE.Vector3(...THUMB_BASE)));
  }
  for (let i = 0; i < 4; i++) {
    const [l0, l1, l2] = fingerLinks(i);
    const q = shape ? shape.fingers[i] : CURL_GAIN.map((g) => rot(X, -dof[i + 2] * g));
    const p = new THREE.Vector3(0, -0.05, -l2).applyQuaternion(q[2]).add(new THREE.Vector3(0, 0, -l1));
    p.applyQuaternion(q[1]).add(new THREE.Vector3(0, 0, -l0)).applyQuaternion(q[0]);
    tips.push(p.add(new THREE.Vector3(...FINGER_BASE[i])));
  }
  return tips;
}

/** Fingertip pads in the world, for a hand drawn at `pose` with `scale` (left hands are mirrored). */
export function fingertips(pose: RobotPose, side: Side, scale = 1): THREE.Vector3[] {
  const mirror = side === 'left' ? -1 : 1;
  return fingertipsLocal(pose.dof, pose.shape).map((p) => p.set(p.x * mirror * scale, p.y * scale, p.z * scale).applyQuaternion(pose.rotation).add(pose.position));
}
