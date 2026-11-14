// Wood that looks like wood: growth rings and flecks drawn per pixel in the
// workpiece's own frame, so the grain stays put on the piece as it turns and
// carved surfaces reveal rings the way real end grain does. Also a canvas
// wood texture for tool handles.

import * as THREE from 'three';

export interface GrainSpec {
  /** Direction the grain runs (the tree's axis), in the piece's local frame. */
  axis: [number, number, number];
  /** A point on the tree's axis (pith). */
  centre: [number, number, number];
  /** Rings per world unit. */
  freq: number;
  /** How much the rings wander (burls swirl a lot). */
  swirl?: number;
  /** Ring contrast, 0..1. */
  contrast?: number;
}

const NOISE = /* glsl */ `
float wHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float wNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wHash(i + vec3(0, 0, 0)), wHash(i + vec3(1, 0, 0)), f.x), mix(wHash(i + vec3(0, 1, 0)), wHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(wHash(i + vec3(0, 0, 1)), wHash(i + vec3(1, 0, 1)), f.x), mix(wHash(i + vec3(0, 1, 1)), wHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

/**
 * A MeshStandardMaterial with vertex colours, modulated by procedural grain.
 * Geometry needs a `grain` attribute (1 = bare wood, 0 = painted over).
 */
export function woodMaterial(g: GrainSpec) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
  const uniforms = {
    uAxis: { value: new THREE.Vector3(...g.axis).normalize() },
    uCentre: { value: new THREE.Vector3(...g.centre) },
    uFreq: { value: g.freq },
    uSwirl: { value: g.swirl ?? 0.6 },
    uContrast: { value: g.contrast ?? 0.22 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float grain;\nvarying float vGrain;\nvarying vec3 vWoodPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrain = grain;\nvWoodPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uAxis; uniform vec3 uCentre; uniform float uFreq; uniform float uSwirl; uniform float uContrast;
varying float vGrain; varying vec3 vWoodPos;
${NOISE}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 q = vWoodPos - uCentre;
  float along = dot(q, uAxis);
  vec3 radial = q - along * uAxis;
  float wob = wNoise(vWoodPos * 2.3) * 2.0 - 1.0;
  float r = length(radial) * uFreq + wob * uSwirl * 2.2 + wNoise(vWoodPos * 9.0) * 0.18;
  float ring = abs(fract(r) - 0.5) * 2.0;
  float late = smoothstep(0.55, 1.0, ring);
  float fleck = smoothstep(0.78, 0.95, wNoise(vec3(along * 3.0, radial.y * 38.0, radial.x * 38.0 + radial.z * 38.0)));
  float shade = 1.0 - uContrast * late - 0.06 * fleck + 0.04 * (wNoise(vWoodPos * 30.0) - 0.5);
  diffuseColor.rgb *= mix(1.0, shade, vGrain);
}`,
      );
  };
  mat.customProgramCacheKey = () => `wood-${g.freq}-${g.swirl ?? 0.6}-${g.contrast ?? 0.22}`;
  return mat;
}

const textures = new Map<string, THREE.Texture>();

/** Long-grain wood texture for tool handles (grain runs along V). */
export function woodTexture(base: string, dark: string, seed = 1): THREE.Texture {
  const key = `${base}${dark}${seed}`;
  const hit = textures.get(key);
  if (hit) return hit;
  const w = 64;
  const h = 256;
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c) return new THREE.Texture();
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  ctx.strokeStyle = dark;
  for (let i = 0; i < 26; i++) {
    const x0 = rnd() * w;
    ctx.globalAlpha = 0.08 + rnd() * 0.18;
    ctx.lineWidth = 0.6 + rnd() * 1.8;
    ctx.beginPath();
    for (let y = 0; y <= h; y += 8) {
      const x = x0 + Math.sin(y * 0.03 + i) * 2.5 + Math.sin(y * 0.011 + i * 3) * 4;
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(key, t);
  return t;
}

/** End-grain rings for the top of a stump or chopping block. */
export function endGrainTexture(base: string, dark: string): THREE.Texture {
  const key = `end${base}${dark}`;
  const hit = textures.get(key);
  if (hit) return hit;
  const n = 256;
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c) return new THREE.Texture();
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, n, n);
  ctx.strokeStyle = dark;
  for (let r = 4; r < n * 0.72; r += 5 + Math.random() * 6) {
    ctx.globalAlpha = 0.18 + Math.random() * 0.25;
    ctx.lineWidth = 0.8 + Math.random() * 1.6;
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.08) {
      const rr = r * (1 + 0.025 * Math.sin(a * 3 + r) + 0.015 * Math.sin(a * 7));
      const x = n / 2 + Math.cos(a) * rr + 6;
      const y = n / 2 + Math.sin(a) * rr - 4;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Radial checks.
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(n / 2 + 6 + Math.cos(a) * n * 0.2, n / 2 - 4 + Math.sin(a) * n * 0.2);
    ctx.lineTo(n / 2 + 6 + Math.cos(a) * n * 0.48, n / 2 - 4 + Math.sin(a) * n * 0.48);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, t);
  return t;
}
