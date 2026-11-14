// Where the robot wrist goes so a held tool's tip lands on a point, and where
// an empty hand hovers. The robot hand's canonical pose is palm down, fingers
// pointing away from the viewer (-Z); tools hang from the fist, tilted by
// their pitch.

import * as THREE from 'three';
import type { Side } from '../rokoko/types';
import type { ToolDef } from './core';

export const HAND_SCALE = 0.8;
/** Centre of the closed fist in the palm frame (hand units). */
export const GRIP = new THREE.Vector3(0, -0.3, -0.52);
/** Hand tilt so the camera sees the back of the hand and the tool. */
const HAND_TILT = 0.22;

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

/** Tool tip in the palm frame (hand units), before the hand's scale. */
export function toolTipLocal(tool: Pick<ToolDef, 'len' | 'pitch'>) {
  return new THREE.Vector3(0, -tool.len, 0).applyAxisAngle(X, tool.pitch ?? 0.35).add(GRIP);
}

export function handRotation(side: Side, extra?: THREE.Quaternion) {
  const base = new THREE.Quaternion().setFromAxisAngle(X, HAND_TILT);
  // A touch of yaw so the two hands don't look copy-pasted.
  base.premultiply(new THREE.Quaternion().setFromAxisAngle(Y, side === 'right' ? 0.12 : -0.12));
  return extra ? extra.clone().multiply(base) : base;
}

/** Wrist pose that puts the held tool's tip at `tip` (world). */
export function wristForTool(tip: THREE.Vector3, side: Side, tool: Pick<ToolDef, 'len' | 'pitch'>, extra?: THREE.Quaternion) {
  const rotation = handRotation(side, extra);
  const local = toolTipLocal(tool).multiplyScalar(HAND_SCALE);
  if (side === 'left') local.x *= -1;
  return { position: tip.clone().sub(local.applyQuaternion(rotation)), rotation };
}

/** World tip position for a wrist pose holding `tool`. */
export function tipForWrist(position: THREE.Vector3, rotation: THREE.Quaternion, side: Side, tool: Pick<ToolDef, 'len' | 'pitch'>) {
  const local = toolTipLocal(tool).multiplyScalar(HAND_SCALE);
  if (side === 'left') local.x *= -1;
  return position.clone().add(local.applyQuaternion(rotation));
}

/** An empty hand hovering with its fingertips near `point`. `down` 0..1 lowers it to grab. */
export function wristForHover(point: THREE.Vector3, side: Side, down = 0, extra?: THREE.Quaternion) {
  const rotation = handRotation(side, extra);
  const reach = new THREE.Vector3(0, -0.25, -0.75).multiplyScalar(HAND_SCALE).applyQuaternion(rotation);
  const lift = 0.55 - 0.4 * down;
  return { position: point.clone().sub(reach).add(new THREE.Vector3(0, lift, 0)), rotation };
}

/** The off hand steadying a workpiece from the side, palm towards it. */
export function wristForSteady(target: THREE.Vector3, side: Side, nudge = new THREE.Vector3()) {
  const s = side === 'left' ? -1 : 1;
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), s * -Math.PI / 2.2);
  rotation.premultiply(new THREE.Quaternion().setFromAxisAngle(Y, s * 0.5));
  return { position: target.clone().add(new THREE.Vector3(s * 1.9, 0.5, 0.6)).add(nudge), rotation };
}

/**
 * The working hand carving a piece held in the other hand: the blade comes in
 * from the hand's own side, pointing across and a little away, lying flat to
 * the work with the back of the hand towards you. On screen the hand sits
 * beside the cut, not on it, and you can see the blade.
 */
export function carvingRotation(side: Side, tool: Pick<ToolDef, 'len' | 'pitch'>) {
  const s = side === 'left' ? -1 : 1;
  // Hand frame: the tool's direction from the fist, and the back of the hand.
  const t = toolTipLocal(tool).sub(GRIP);
  if (side === 'left') t.x *= -1;
  t.normalize();
  const a2 = Y.clone().addScaledVector(t, -Y.dot(t)).normalize();
  const a3 = t.clone().cross(a2); // the knuckle line, across which the blade is thin
  // World: the blade points across and away; its flat faces up towards the camera.
  const want = new THREE.Vector3(-0.78 * s, -0.18, -0.6).normalize();
  const flat = new THREE.Vector3(0, 0.8, 0.6);
  const b3 = flat.addScaledVector(want, -flat.dot(want)).normalize();
  const b2 = b3.clone().cross(want);
  const A = new THREE.Matrix4().makeBasis(t, a2, a3);
  const B = new THREE.Matrix4().makeBasis(want, b2, b3);
  return new THREE.Quaternion().setFromRotationMatrix(B.multiply(A.transpose()));
}
