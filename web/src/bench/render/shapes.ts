// Geometry for the better-made tools and stations: knife blades cut from a
// real outline, lathe-turned handles, a forged anvil profile. Built once per
// size and shared.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry) {
  let g = cache.get(key);
  if (!g) cache.set(key, (g = make()));
  return g;
}

/**
 * A flat blade outline in the tool's YZ plane (y along the blade, from 0 at
 * the bolster down to -len at the tip; z across it), extruded to a thickness
 * along X and centred on it.
 */
function bladeFrom(shape: THREE.Shape, thick: number) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.35, bevelSize: 0.006, bevelSegments: 2, curveSegments: 12 });
  g.translate(0, 0, -thick / 2);
  // Shape x -> tool z, thickness -> tool x.
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** Puukko blade: straight spine that drops to the point, a gentle belly, a short ricasso. */
export function puukkoBlade(len: number) {
  return cached(`puukko${len}`, () => {
    const s = new THREE.Shape();
    s.moveTo(0.048, 0);
    s.lineTo(0.05, -len * 0.6);
    s.quadraticCurveTo(0.05, -len * 0.92, 0.004, -len);
    s.quadraticCurveTo(-0.07, -len * 0.82, -0.074, -len * 0.5);
    s.lineTo(-0.066, -0.05);
    s.lineTo(-0.05, 0);
    s.closePath();
    return bladeFrom(s, 0.016);
  });
}

/** A turned handle along Y, from `top` (butt) down to `bottom`, with an oval section. */
export function turnedHandle(key: string, profile: [number, number][], oval = 0.82) {
  return cached(`handle${key}`, () => {
    const g = new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r, y)),
      24,
    );
    g.scale(oval, 1, 1);
    g.computeVertexNormals();
    return g;
  });
}

/** Barrel-shaped puukko handle from y=0.33 (butt) to y=-0.27 (bolster). */
export const PUUKKO_HANDLE: [number, number][] = [
  [0, 0.335],
  [0.05, 0.335],
  [0.078, 0.318],
  [0.088, 0.26],
  [0.097, 0.12],
  [0.1, 0.0],
  [0.095, -0.13],
  [0.084, -0.23],
  [0.078, -0.27],
  [0, -0.27],
];

/** Cross-peen hammer head, long axis along Z, centred on the origin. */
export function hammerHead() {
  return cached('hammerHead', () => {
    const body = new THREE.BoxGeometry(0.17, 0.19, 0.24);
    const face = new THREE.CylinderGeometry(0.105, 0.11, 0.16, 20);
    face.rotateX(Math.PI / 2);
    face.translate(0, 0, -0.19);
    // Cross peen: a wedge narrowing to a rounded edge.
    const s = new THREE.Shape();
    s.moveTo(-0.095, 0);
    s.lineTo(0.095, 0);
    s.lineTo(0.02, 0.22);
    s.lineTo(-0.02, 0.22);
    s.closePath();
    const peen = new THREE.ExtrudeGeometry(s, { depth: 0.17, bevelEnabled: false });
    peen.translate(0, 0, -0.085);
    peen.rotateY(Math.PI / 2);
    peen.rotateX(Math.PI / 2);
    peen.translate(0, 0, 0.115);
    return mergeAll([body, face, peen]);
  });
}

/** One rein of a pair of tongs: from the handle end down through the pivot to a curved jaw. */
export function tongRein(len: number, side: 1 | -1) {
  return cached(`tong${len}${side}`, () => {
    const pivot = -len + 0.28;
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.07, 0.32, 0),
      new THREE.Vector3(side * 0.06, 0.0, 0),
      new THREE.Vector3(side * 0.035, pivot + 0.18, 0),
      new THREE.Vector3(0, pivot, 0),
      new THREE.Vector3(-side * 0.045, pivot - 0.12, 0),
      new THREE.Vector3(-side * 0.03, -len + 0.03, 0),
    ]);
    return new THREE.TubeGeometry(c, 40, 0.017, 8, false);
  });
}

export function roundedBox(w: number, h: number, d: number, r: number) {
  return cached(`rbox${w}${h}${d}${r}`, () => new RoundedBoxGeometry(w, h, d, 3, r));
}

/** London-pattern anvil body: side profile in XY, extruded along Z. Bottom at y0, face at y1. */
export function anvilBody(y0: number, y1: number) {
  return cached(`anvil${y0}${y1}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-0.66, y1);
    s.lineTo(0.74, y1);
    s.lineTo(0.74, y1 - 0.13);
    s.quadraticCurveTo(0.42, y1 - 0.16, 0.36, y1 - 0.3);
    s.lineTo(0.33, y0 + 0.12);
    s.quadraticCurveTo(0.42, y0 + 0.05, 0.62, y0);
    s.lineTo(-0.62, y0);
    s.quadraticCurveTo(-0.42, y0 + 0.05, -0.33, y0 + 0.12);
    s.lineTo(-0.36, y1 - 0.3);
    s.quadraticCurveTo(-0.46, y1 - 0.15, -0.66, y1 - 0.12);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, -0.25);
    g.computeVertexNormals();
    return g;
  });
}

/** A tree stump: slightly irregular cylinder (bark side), its top at y = h. */
export function stump(r: number, h: number) {
  return cached(`stump${r}${h}`, () => {
    const g = new THREE.CylinderGeometry(r, r * 1.08, h, 40, 4, true);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + 0.035 * Math.sin(a * 5 + 1) + 0.02 * Math.sin(a * 13) + 0.012 * Math.sin(a * 29 + p.getY(i) * 3);
      p.setX(i, x * k);
      p.setZ(i, z * k);
    }
    g.translate(0, h / 2, 0);
    g.computeVertexNormals();
    return g;
  });
}

/** Merge non-indexed copies of several geometries (positions + normals). */
export function mergeAll(parts: THREE.BufferGeometry[]) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of flat) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of flat) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
