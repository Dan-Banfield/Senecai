// Pure geometry of the ocarina stage: the 12-hole alto model (web/public/crafts/
// ocarina.stl) placed in the scene, where its holes are, and how the two robot
// hands hold it.
//
// World frame: +X to the player's right, +Y up, +Z towards the player. The
// ocarina lies along X with its wide end (and mouthpiece) on the left, finger
// holes on top, thumb holes underneath, and the mouthpiece pointing at the
// player.
//
// The hold is a flute hold, which is what the hole layout implies (the subholes
// sit beside the middle-finger holes, and each thumb hole lies under its index
// finger): both hands run index -> little from the mouthpiece end. The right
// hand is on the player's side, palm facing away, fingers curling over the top;
// the left hand is on the far side, palm facing the player, fingers curling back
// over the top towards them. Wrists never move.
//
// Each digit is posed by a small IK solve (yaw, curl, base pitch) so that its
// pad lands exactly on its hole when covered and hovers clear of it otherwise.

import * as THREE from 'three';
import { CURL_GAIN, FINGER_BASE, fingerLinks, THUMB_BASE, THUMB_LEN, THUMB_YAW, type RobotPose } from '../../robot/RobotHand';
import type { HandShape } from '../../robot/handShape';
import type { Dof6 } from '../../robot/retarget';
import type { Side } from '../../rokoko/types';
import { HOLES, type HoleStates } from './types';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const v3 = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);

// ---- The model -------------------------------------------------------------

export const MODEL_URL = '/crafts/ocarina.stl';
/** Scene units per model millimetre: the hole pitch (~16 mm) matches the robot's finger pitch (0.2). */
export const MODEL_SCALE = 0.0125;
/** Centre of the model's bounding box (mm). */
const MODEL_CENTER = new THREE.Vector3(125, 105, 67.5);
/** Model axes -> scene: holes face (-X) up, mouthpiece (-Y) towards the player, wide end (Z = 0) on the left. */
export const MODEL_ROTATION = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)));
/** Position of the model group so that MODEL_CENTER lands on the origin. */
export const MODEL_POSITION = MODEL_CENTER.clone().applyQuaternion(MODEL_ROTATION).multiplyScalar(-MODEL_SCALE);

export function modelToScene(p: THREE.Vector3): THREE.Vector3 {
  return p.clone().sub(MODEL_CENTER).applyQuaternion(MODEL_ROTATION).multiplyScalar(MODEL_SCALE);
}

/**
 * Hole centres on the outer surface (mm), outward normals and radii, measured
 * from the STL (depth maps along its thickness). Keyed by HoleDef.id.
 */
const MODEL_HOLES: Record<string, { center: number[]; normal: number[]; radius: number }> = {
  'L.index': { center: [107.84, 120.19, 16.99], normal: [-0.894, 0.184, -0.407], radius: 3.56 },
  'L.middle': { center: [104.66, 120.33, 32.34], normal: [-0.984, -0.133, -0.12], radius: 4.83 },
  'L.ring': { center: [102.83, 124.48, 49.41], normal: [-0.962, 0.272, -0.007], radius: 4.3 },
  'L.little': { center: [107.01, 131.99, 64.43], normal: [-0.845, 0.524, 0.105], radius: 4.13 },
  'R.index': { center: [103.22, 108.51, 68.78], normal: [-0.975, -0.189, 0.119], radius: 3.59 },
  'R.middle': { center: [106.06, 115.5, 85.48], normal: [-0.922, 0.373, 0.102], radius: 3.3 },
  'R.ring': { center: [108.98, 116.77, 102.79], normal: [-0.966, 0.072, 0.25], radius: 3.29 },
  'R.little': { center: [113.99, 112.93, 118.8], normal: [-0.923, -0.122, 0.366], radius: 2.5 },
  'L.thumb': { center: [144.47, 121, 24.87], normal: [0.944, -0.189, 0.27], radius: 5.87 },
  'R.thumb': { center: [147.95, 116.48, 61.13], normal: [0.996, -0.034, -0.079], radius: 5.12 },
};

/** Hole centres in the scene, in HOLES order. */
export const HOLE_POSITIONS: readonly THREE.Vector3[] = HOLES.map((h) => modelToScene(v3(MODEL_HOLES[h.id].center)));
/** Outward surface normals at the holes, in HOLES order. */
export const HOLE_NORMALS: readonly THREE.Vector3[] = HOLES.map((h) => v3(MODEL_HOLES[h.id].normal).applyQuaternion(MODEL_ROTATION).normalize());
/** Hole radii in scene units, in HOLES order. */
export const HOLE_RADII: readonly number[] = HOLES.map((h) => MODEL_HOLES[h.id].radius * MODEL_SCALE);

// ---- The hold --------------------------------------------------------------

export interface HoldPose {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
}

const basis = (x: number[], y: number[], z: number[]) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(v3(x), v3(y), v3(z)));
const hold = (base: THREE.Quaternion, p: number[], tilt: number[]): HoldPose => ({
  position: v3(p),
  rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt[0], tilt[1], tilt[2])).multiply(base),
});

/**
 * Fixed wrist pose per side (treat as read-only). Canonical hand: palm -Y,
 * fingers -Z. Right: palm faces away from the player (-Z), fingers up. Left
 * (drawn mirrored): palm faces the player (+Z), fingers up, index towards the
 * mouthpiece. The positions and tilts were searched against the real mesh so
 * every digit reaches its hole squarely and nothing passes through the clay
 * (see stageGeometry.test.ts).
 */
export const HOLD_POSES: Readonly<Record<Side, HoldPose>> = {
  right: hold(basis([1, 0, 0], [0, 0, 1], [0, -1, 0]), [0.318, -0.658, 0.552], [-0.113, 0.398, -0.165]),
  left: hold(basis([-1, 0, 0], [0, 0, -1], [0, -1, 0]), [-0.309, -0.591, -0.922], [0.19, -0.081, -0.119]),
};

// ---- Digit chains (the same joint chain RobotHand draws with a shape) -------

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();

/** Finger i's link rotations for (yaw, curl, base pitch). */
function fingerQuats(yaw: number, curl: number, pitch: number, out: [THREE.Quaternion, THREE.Quaternion, THREE.Quaternion]) {
  out[0].setFromAxisAngle(Y, yaw).multiply(qa.setFromAxisAngle(X, pitch - curl * CURL_GAIN[0]));
  out[1].setFromAxisAngle(X, -curl * CURL_GAIN[1]);
  out[2].setFromAxisAngle(X, -curl * CURL_GAIN[2]);
  return out;
}

/**
 * Thumb link rotations for (swing, bend, base pitch, twist): swing as the
 * thumb-rotate DoF, then the thumb's mounting yaw, then pitch, then a twist
 * about its own axis so the pad can face the hole.
 */
function thumbQuats(swing: number, bend: number, pitch: number, twist: number, out: [THREE.Quaternion, THREE.Quaternion]) {
  out[0].setFromAxisAngle(Z, swing * 1.15).multiply(qa.setFromAxisAngle(Y, THUMB_YAW)).multiply(qb.setFromAxisAngle(X, pitch - bend)).multiply(qa.setFromAxisAngle(Z, twist));
  out[1].setFromAxisAngle(X, -bend * 1.4);
  return out;
}

/** Joint points (base, knuckles..., pad) of finger i in the hand frame (right-hand canonical, unscaled). */
export function fingerPoints(i: number, q: readonly THREE.Quaternion[]): THREE.Vector3[] {
  const [l0, l1, l2] = fingerLinks(i);
  const base = v3(FINGER_BASE[i]);
  const r0 = q[0].clone();
  const r1 = r0.clone().multiply(q[1]);
  const r2 = r1.clone().multiply(q[2]);
  const j1 = base.clone().add(new THREE.Vector3(0, 0, -l0).applyQuaternion(r0));
  const j2 = j1.clone().add(new THREE.Vector3(0, 0, -l1).applyQuaternion(r1));
  const tip = j2.clone().add(new THREE.Vector3(0, 0, -l2).applyQuaternion(r2));
  const pad = j2.clone().add(new THREE.Vector3(0, -0.05, -l2).applyQuaternion(r2));
  return [base, j1, j2, tip, pad];
}

/** Joint points (base, knuckle, tip, pad) of the thumb in the hand frame. */
export function thumbPoints(q: readonly THREE.Quaternion[]): THREE.Vector3[] {
  const base = v3(THUMB_BASE);
  const r1 = q[0].clone().multiply(q[1]);
  const j1 = base.clone().add(new THREE.Vector3(0, 0, -THUMB_LEN[0]).applyQuaternion(q[0]));
  const tip = j1.clone().add(new THREE.Vector3(0, 0, -THUMB_LEN[1]).applyQuaternion(r1));
  const pad = j1.clone().add(new THREE.Vector3(0, -0.05, -THUMB_LEN[1]).applyQuaternion(r1));
  return [base, j1, tip, pad];
}

/** Hand frame -> world for a side's hold (mirrors the left hand like RobotHand does). */
export function handToWorld(side: Side, p: THREE.Vector3): THREE.Vector3 {
  const h = HOLD_POSES[side];
  return p.clone().setX(side === 'left' ? -p.x : p.x).applyQuaternion(h.rotation).add(h.position);
}

function worldToHand(side: Side, p: THREE.Vector3): THREE.Vector3 {
  const h = HOLD_POSES[side];
  const l = p.clone().sub(h.position).applyQuaternion(h.rotation.clone().invert());
  if (side === 'left') l.x = -l.x;
  return l;
}

function worldDirToHand(side: Side, d: THREE.Vector3): THREE.Vector3 {
  const l = d.clone().applyQuaternion(HOLD_POSES[side].rotation.clone().invert());
  if (side === 'left') l.x = -l.x;
  return l;
}

// ---- IK ----------------------------------------------------------------------

/** How far above the hole surface the pad point sits when covering (the pad sphere's thickness). */
const PAD_GAP = 0.02;
/** How much the solver cares about the pad facing straight into its hole, relative to hitting it. */
const FACE_WEIGHT = 0.08;

/** A digit's pose parameters: fingers [yaw, curl, base pitch]; thumbs [swing, bend, base pitch, twist]. */
export type DigitParams = number[];

const q2 = (): [THREE.Quaternion, THREE.Quaternion] => [new THREE.Quaternion(), new THREE.Quaternion()];
const q3 = (): [THREE.Quaternion, THREE.Quaternion, THREE.Quaternion] => [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];

/** Hand-frame joint points of a hole's digit: [base, ...joints, tip, pad]. */
function digitChain(holeIndex: number, p: DigitParams): THREE.Vector3[] {
  const h = HOLES[holeIndex];
  if (h.finger === 'thumb') return thumbPoints(thumbQuats(p[0], p[1], p[2], p[3], q2()));
  const i = h.dofIndex - 2;
  return fingerPoints(i, fingerQuats(p[0], p[1], p[2], q3()));
}

/** Residuals: pad - target (3), and how far the pad's facing is from `into` (weighted). */
function residual(holeIndex: number, p: DigitParams, target: THREE.Vector3, into: THREE.Vector3): number[] {
  const c = digitChain(holeIndex, p);
  const pad = c[c.length - 1];
  const face = pad.clone().sub(c[c.length - 2]).normalize().dot(into);
  return [pad.x - target.x, pad.y - target.y, pad.z - target.z, FACE_WEIGHT * (1 - face)];
}

/** Solve A x = b (small, dense) by Gaussian elimination with partial pivoting. */
function linSolve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let v = M[r][n];
    for (let k = r + 1; k < n; k++) v -= M[r][k] * x[k];
    x[r] = v / M[r][r];
  }
  return x;
}

/** Damped Gauss-Newton: params that put the pad on `target`, facing along `into` (hand frame). */
function solve(holeIndex: number, target: THREE.Vector3, into: THREE.Vector3, start: DigitParams): DigitParams {
  const p = [...start];
  const n = p.length;
  const eps = 1e-5;
  for (let iter = 0; iter < 200; iter++) {
    const f = residual(holeIndex, p, target, into);
    const J = f.map(() => new Array<number>(n).fill(0));
    for (let k = 0; k < n; k++) {
      const q = [...p];
      q[k] += eps;
      const g = residual(holeIndex, q, target, into);
      for (let r = 0; r < f.length; r++) J[r][k] = (g[r] - f[r]) / eps;
    }
    const A = [...Array(n)].map((_, r) => [...Array(n)].map((_, c) => J.reduce((s, row) => s + row[r] * row[c], 0) + (r === c ? 1e-4 : 0)));
    const b = [...Array(n)].map((_, r) => -J.reduce((s, row, i) => s + row[r] * f[i], 0));
    const dp = linSolve(A, b);
    let moved = 0;
    for (let k = 0; k < n; k++) {
      const step = THREE.MathUtils.clamp(dp[k], -0.2, 0.2);
      p[k] += step;
      moved = Math.max(moved, Math.abs(step));
    }
    if (moved < 1e-7) break;
  }
  return p;
}

/** Pad targets (world): just above each hole centre. */
export const PAD_TARGETS: readonly THREE.Vector3[] = HOLE_POSITIONS.map((p, i) => p.clone().addScaledVector(HOLE_NORMALS[i], PAD_GAP));

/** How far an open digit's pad lifts straight off its hole. */
export const LIFT: Record<'finger' | 'thumb', number> = { finger: 0.16, thumb: 0.2 };

/** Solve the params that put a digit's pad `lift` straight off its hole (0 = seated), from the current HOLD_POSES. */
export function solveDigit(holeIndex: number, lift: number, start?: DigitParams): DigitParams {
  const h = HOLES[holeIndex];
  const into = worldDirToHand(h.side, HOLE_NORMALS[holeIndex].clone().negate());
  const target = PAD_TARGETS[holeIndex].clone().addScaledVector(HOLE_NORMALS[holeIndex], lift);
  return solve(holeIndex, worldToHand(h.side, target), into, start ?? (h.finger === 'thumb' ? [1, 0.6, 0, 0] : [0, 0.8, 0]));
}

const liftOf = (i: number) => LIFT[HOLES[i].finger === 'thumb' ? 'thumb' : 'finger'];

/** Params that seat each digit on its hole, in HOLES order. */
export const COVER_PARAMS: DigitParams[] = HOLES.map((_, i) => solveDigit(i, 0));
/** Params with each digit lifted fully open, in HOLES order (solved from the seated pose, so it lifts straight off). */
export const OPEN_PARAMS: DigitParams[] = HOLES.map((_, i) => solveDigit(i, liftOf(i), COVER_PARAMS[i]));

/** Re-solve every digit of one side (after its HOLD_POSES entry changed). */
export function resolveSide(side: Side) {
  HOLES.forEach((h, i) => {
    if (h.side !== side) return;
    COVER_PARAMS[i] = solveDigit(i, 0);
    OPEN_PARAMS[i] = solveDigit(i, liftOf(i), COVER_PARAMS[i]);
  });
}

/** The furthest an uncovered digit travels towards its hole (as a fraction of the way). */
export const HOVER_MAX = 0.6;

/**
 * How far along from open (0) to seated (1) a digit is drawn: seated whenever
 * its hole counts as covered, otherwise following the flexion but stopping
 * short, so a finger only touches a hole when it really covers it.
 */
export function reach(flex: number, covered: boolean, coverOn: number): number {
  return covered ? 1 : HOVER_MAX * THREE.MathUtils.clamp(flex / coverOn, 0, 1);
}

export function digitParams(holeIndex: number, t: number, out: DigitParams = []): DigitParams {
  const c = COVER_PARAMS[holeIndex];
  const o = OPEN_PARAMS[holeIndex];
  for (let k = 0; k < c.length; k++) out[k] = o[k] + (c[k] - o[k]) * t;
  return out;
}

/** Pad position (world) of a hole's digit at reach t. */
export function padWorld(holeIndex: number, t: number): THREE.Vector3 {
  const c = digitChain(holeIndex, digitParams(holeIndex, t));
  return handToWorld(HOLES[holeIndex].side, c[c.length - 1]);
}

/** World joint points (base .. tip, without the pad) of a hole's digit at reach t. */
export function digitJoints(holeIndex: number, t: number): THREE.Vector3[] {
  return digitChain(holeIndex, digitParams(holeIndex, t))
    .slice(0, -1)
    .map((q) => handToWorld(HOLES[holeIndex].side, q));
}

/** How squarely a digit's pad faces into its hole when seated (1 = straight in). */
export function padFacing(holeIndex: number): number {
  const c = digitChain(holeIndex, COVER_PARAMS[holeIndex]).map((q) => handToWorld(HOLES[holeIndex].side, q));
  return c[c.length - 1].clone().sub(c[c.length - 2]).normalize().dot(HOLE_NORMALS[holeIndex].clone().negate());
}

// ---- Per-frame pose ----------------------------------------------------------

const HOLE_OF: Record<Side, (number | undefined)[]> = { left: [], right: [] };
HOLES.forEach((h, i) => (HOLE_OF[h.side][h.dofIndex] = i));

export function makeShape(): HandShape {
  const q = () => new THREE.Quaternion();
  return { thumb: [q(), q()], fingers: [0, 1, 2, 3].map(() => [q(), q(), q()] as [THREE.Quaternion, THREE.Quaternion, THREE.Quaternion]) };
}

const tmp: DigitParams = [0, 0, 0, 0];

/**
 * The pose the stage draws for one hand: the fixed hold, with every digit
 * placed by its hole state and flexion. Writes into `out` (allocation-free).
 */
export function holdPose(
  side: Side,
  dof: Readonly<Dof6>,
  holes: Readonly<HoleStates>,
  out: RobotPose,
  coverOn?: readonly number[],
): RobotPose {
  const h = HOLD_POSES[side];
  out.position = h.position;
  out.rotation = h.rotation;
  for (let k = 0; k < 6; k++) out.dof[k] = dof[k] || 0;
  const shape = out.shape ?? (out.shape = makeShape());
  const thumb = HOLE_OF[side][1]!;
  const tp = digitParams(thumb, reach(dof[1] || 0, !!holes[thumb], coverOn?.[thumb] ?? HOLES[thumb].coverOn), tmp);
  thumbQuats(tp[0], tp[1], tp[2], tp[3], shape.thumb);
  for (let i = 0; i < 4; i++) {
    const hi = HOLE_OF[side][i + 2]!;
    const fp = digitParams(hi, reach(dof[i + 2] || 0, !!holes[hi], coverOn?.[hi] ?? HOLES[hi].coverOn), tmp);
    fingerQuats(fp[0], fp[1], fp[2], shape.fingers[i]);
  }
  return out;
}
