import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { RobotPose } from '../../robot/RobotHand';
import type { Dof6 } from '../../robot/retarget';
import type { Side } from '../../rokoko/types';
import {
  COVER_PARAMS,
  digitJoints,
  handToWorld,
  holdPose,
  HOLE_NORMALS,
  HOLE_POSITIONS,
  HOLE_RADII,
  MODEL_POSITION,
  MODEL_ROTATION,
  MODEL_SCALE,
  modelToScene,
  PAD_TARGETS,
  padFacing,
  padWorld,
  reach,
} from './stageGeometry';
import { HOLES } from './types';

// ---- The real mesh, for inside/outside tests ----------------------------------

// The web package has no Node typings, so reach node:fs through an untyped specifier.
const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync(path: URL): Uint8Array };
const bytes = fs.readFileSync(new URL('../../../public/crafts/ocarina.stl', import.meta.url));
const stl = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const triCount = stl.getUint32(80, true);
const tris = new Float32Array(triCount * 9);
for (let i = 0; i < triCount; i++) for (let j = 0; j < 9; j++) tris[i * 9 + j] = stl.getFloat32(84 + 50 * i + 12 + 4 * j, true);

// Bin triangles by their (y, z) footprint so a ray along model X only tests a few.
const CELL = 2;
const bins = new Map<number, number[]>();
for (let t = 0; t < triCount; t++) {
  const ys = [tris[t * 9 + 1], tris[t * 9 + 4], tris[t * 9 + 7]];
  const zs = [tris[t * 9 + 2], tris[t * 9 + 5], tris[t * 9 + 8]];
  for (let y = Math.floor(Math.min(...ys) / CELL); y <= Math.floor(Math.max(...ys) / CELL); y++)
    for (let z = Math.floor(Math.min(...zs) / CELL); z <= Math.floor(Math.max(...zs) / CELL); z++) {
      const k = y * 10000 + z;
      (bins.get(k) ?? bins.set(k, []).get(k)!).push(t);
    }
}

/** Ray-parity test along +X in model space (mm). */
function insideModel(p: THREE.Vector3): boolean {
  const list = bins.get(Math.floor(p.y / CELL) * 10000 + Math.floor(p.z / CELL)) ?? [];
  let hits = 0;
  for (const t of list) {
    const o = t * 9;
    const [ay, az, by, bz, cy, cz] = [tris[o + 1], tris[o + 2], tris[o + 4], tris[o + 5], tris[o + 7], tris[o + 8]];
    const d = (by - ay) * (cz - az) - (cy - ay) * (bz - az);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((p.y - ay) * (cz - az) - (cy - ay) * (p.z - az)) / d;
    const v = ((by - ay) * (p.z - az) - (p.y - ay) * (bz - az)) / d;
    if (u < 0 || v < 0 || u + v > 1) continue;
    const x = tris[o] + u * (tris[o + 3] - tris[o]) + v * (tris[o + 6] - tris[o]);
    if (x > p.x) hits++;
  }
  return hits % 2 === 1;
}

const sceneToModel = (p: THREE.Vector3) => p.clone().sub(MODEL_POSITION).divideScalar(MODEL_SCALE).applyQuaternion(MODEL_ROTATION.clone().invert());
const insideScene = (p: THREE.Vector3) => insideModel(sceneToModel(p));

/** Points along a polyline, every `step`. */
function along(points: THREE.Vector3[], step = 0.02): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const n = Math.max(1, Math.ceil(points[i].distanceTo(points[i + 1]) / step));
    for (let k = 0; k <= n; k++) out.push(points[i].clone().lerp(points[i + 1], k / n));
  }
  return out;
}

/** Sampled points of a hand (palm box + every digit's links) in the world, each digit at reach t(hole). */
function handPoints(side: Side, t: (holeIndex: number) => number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (const x of [-0.43, -0.2, 0, 0.2, 0.43]) for (const y of [-0.13, 0.13]) for (const z of [-0.53, -0.25, 0, 0.25, 0.53]) pts.push(handToWorld(side, new THREE.Vector3(x, y, z)));
  HOLES.forEach((h, i) => {
    if (h.side === side) pts.push(...along(digitJoints(i, t(i))));
  });
  return pts;
}

describe('ocarina model placement', () => {
  it('maps the model so finger holes face up and thumb holes face down', () => {
    HOLES.forEach((h, i) => {
      if (h.finger === 'thumb') expect(HOLE_NORMALS[i].y).toBeLessThan(-0.8);
      else expect(HOLE_NORMALS[i].y).toBeGreaterThan(0.5);
    });
  });

  it('runs both hands index -> little from the mouthpiece end (left of the scene)', () => {
    const x = (id: string) => HOLE_POSITIONS[HOLES.findIndex((h) => h.id === id)].x;
    expect(x('L.index')).toBeLessThan(x('L.middle'));
    expect(x('L.middle')).toBeLessThan(x('L.ring'));
    expect(x('L.ring')).toBeLessThan(x('L.little'));
    expect(x('L.little')).toBeLessThan(x('R.middle'));
    expect(x('R.index')).toBeLessThan(x('R.middle'));
    expect(x('R.middle')).toBeLessThan(x('R.ring'));
    expect(x('R.ring')).toBeLessThan(x('R.little'));
  });

  it('puts every hole centre on the mesh surface (just outside, with solid clay beneath its rim)', () => {
    HOLES.forEach((_, i) => {
      expect(insideScene(HOLE_POSITIONS[i].clone().addScaledVector(HOLE_NORMALS[i], 0.03))).toBe(false);
      expect(modelToScene(sceneToModel(HOLE_POSITIONS[i])).distanceTo(HOLE_POSITIONS[i])).toBeLessThan(1e-6);
    });
  });
});

describe('the hold', () => {
  it('seats every pad on its hole when covered', () => {
    HOLES.forEach((h, i) => {
      const err = padWorld(i, 1).distanceTo(PAD_TARGETS[i]);
      expect(err, h.id).toBeLessThan(0.005);
    });
  });

  it('keeps the fingers in a natural range and every pad facing into its hole', () => {
    HOLES.forEach((h, i) => {
      expect(padFacing(i), h.id).toBeGreaterThan(0.9);
      if (h.finger === 'thumb') return;
      const [yaw, curl, pitch] = COVER_PARAMS[i];
      expect(Math.abs(yaw), `${h.id} yaw`).toBeLessThan(0.3);
      expect(curl, `${h.id} curl`).toBeGreaterThan(0.2);
      expect(curl, `${h.id} curl`).toBeLessThan(1.2);
      expect(Math.abs(pitch), `${h.id} pitch`).toBeLessThan(0.5);
    });
  });

  it('lifts uncovered digits clear of their holes', () => {
    HOLES.forEach((h, i) => {
      const hover = padWorld(i, reach(0.54, false)).distanceTo(PAD_TARGETS[i]);
      expect(hover, h.id).toBeGreaterThan(Math.max(0.04, HOLE_RADII[i]));
      expect(padWorld(i, 0).distanceTo(PAD_TARGETS[i]), h.id).toBeGreaterThan(0.12);
    });
  });

  it.each(['left', 'right'] as Side[])('never pushes the %s hand into the clay (open, hovering or covering)', (side) => {
    for (const t of [() => 0, () => reach(0.5, false), () => 1]) {
      const inside = handPoints(side, t).filter(insideScene);
      expect(inside.length).toBe(0);
    }
  });

  it('writes the shape in place for the stage', () => {
    const out: RobotPose = { dof: [0, 0, 0, 0, 0, 0], position: new THREE.Vector3(), rotation: new THREE.Quaternion() };
    const dof: Dof6 = [0.2, 0.9, 0.9, 0.9, 0.9, 0.9];
    const holes = HOLES.map(() => true);
    holdPose('right', dof, holes, out);
    const shape = out.shape;
    expect(shape).toBeDefined();
    holdPose('right', dof, holes, out);
    expect(out.shape).toBe(shape);
  });
});
