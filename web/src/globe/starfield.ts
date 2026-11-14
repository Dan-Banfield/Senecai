// A procedural night sky: twinkling stars with a faint Milky Way band and a few
// nebula glows. It lives in the 3D scene, so it moves with the camera as you
// spin the globe, unlike a flat background image.

import * as THREE from 'three';

const STAR_COLORS = ['#cfe0ff', '#e8efff', '#ffffff', '#fff4e0', '#ffe2bd', '#ffc9a8'].map((c) => new THREE.Color(c));

function gaussian() {
  let u = 0;
  let v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function randomOnSphere(out: THREE.Vector3) {
  const z = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(t), r * Math.sin(t), z);
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStarfield({ count = 9000, radius = 30000 } = {}) {
  const group = new THREE.Group();
  // The galactic plane, tilted so the band sweeps diagonally across the sky.
  const bandNormal = new THREE.Vector3(0.35, 0.85, 0.4).normalize();
  const bandU = new THREE.Vector3(1, 0, 0).cross(bandNormal).normalize();
  const bandV = new THREE.Vector3().crossVectors(bandNormal, bandU);

  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    if (i < count * 0.38) {
      // Milky Way: points near the band's great circle.
      const a = Math.random() * Math.PI * 2;
      p.copy(bandU).multiplyScalar(Math.cos(a)).addScaledVector(bandV, Math.sin(a)).addScaledVector(bandNormal, gaussian() * 0.09).normalize();
    } else randomOnSphere(p);
    p.multiplyScalar(radius * (0.85 + Math.random() * 0.15));
    pos.set([p.x, p.y, p.z], i * 3);
    const c = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
    const dim = i < count * 0.38 ? 0.6 + Math.random() * 0.4 : 0.75 + Math.random() * 0.25;
    col.set([c.r * dim, c.g * dim, c.b * dim], i * 3);
    // Mostly faint pinpricks, a few bright stars.
    const r = Math.random();
    size[i] = r > 0.995 ? 5.2 : r > 0.97 ? 3.6 : r > 0.82 ? 2.5 : 1.7;
    phase[i] = Math.random();
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('starColor', new THREE.BufferAttribute(col, 3));
  geom.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geom.setAttribute('phase', new THREE.BufferAttribute(phase, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) } },
    vertexShader: /* glsl */ `
      attribute vec3 starColor;
      attribute float size;
      attribute float phase;
      uniform float uTime;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        float speed = 0.4 + fract(phase * 7.31) * 1.8;
        vAlpha = 0.72 + 0.28 * sin(uTime * speed + phase * 6.2831);
        vColor = starColor;
        gl_PointSize = size * uPixelRatio;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = pow(smoothstep(0.5, 0.0, d), 1.5);
        gl_FragColor = vec4(vColor, a * vAlpha);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(geom, mat);
  stars.frustumCulled = false;
  group.add(stars);

  // Nebula glows along the band.
  const tex = glowTexture();
  const tints = ['#3e7c8c', '#5d4a86', '#2f6b3a', '#2f5f7a', '#7a5a9a', '#3e7c8c'];
  tints.forEach((tint, i) => {
    const a = (i / tints.length) * Math.PI * 2 + Math.random() * 0.6;
    const dir = bandU.clone().multiplyScalar(Math.cos(a)).addScaledVector(bandV, Math.sin(a)).addScaledVector(bandNormal, gaussian() * 0.05).normalize();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: tint, transparent: true, opacity: 0.12 + Math.random() * 0.08, depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.position.copy(dir.multiplyScalar(radius * 0.9));
    sprite.scale.setScalar(radius * (0.35 + Math.random() * 0.3));
    group.add(sprite);
  });

  return {
    object: group,
    update(timeSeconds: number) {
      mat.uniforms.uTime.value = timeSeconds;
    },
    dispose() {
      geom.dispose();
      mat.dispose();
      tex.dispose();
      group.traverse((o) => {
        if (o instanceof THREE.Sprite) o.material.dispose();
      });
    },
  };
}
