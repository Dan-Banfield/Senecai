// On-demand render loop for the globe page. Replaces globe.gl's continuous rAF cycle
// (globe.gl _animationCycle -> three-render-objects tick, plus three-globe's own tween cycle)
// once the page has called `g.pauseAnimation()`.

import type { GlobeInstance } from 'globe.gl';
import { Matrix4, Timer, Vector2, Vector3, type Object3D } from 'three';
import { createPerfHud } from './perfHud';

export interface Pov {
  lat: number;
  lng: number;
  altitude: number;
}

export interface FrameInfo {
  /** performance.now() at the start of the frame. */
  now: number;
  /** Camera pose or projection (view offset, aspect) changed since the last rendered frame. */
  cameraMoved: boolean;
  /** Canvas CSS size changed since the last rendered frame. */
  sizeChanged: boolean;
  /** The ThreeGlobe object's transform changed this frame (intro scale/spin). */
  globeMoved: boolean;
}

export interface RenderLoop {
  /** Request one frame. */
  invalidate(): void;
  /** Called every rendered frame BEFORE render; return true to request another frame. */
  addTicker(fn: (f: FrameInfo) => boolean | void): () => void;
  /** Animated camera move, same easing/longitude handling/duration semantics as globe.gl pointOfView(pov, ms). ms=0 jumps. */
  flyTo(pov: Partial<Pov>, ms: number): void;
  /** Play three-globe's animate-in (scale + spin) exactly as TG does when animateIn=true. */
  playIntro(): void;
  dispose(): void;
}

export interface RenderLoopOptions {
  /** Pixel ratio cap while the camera is moving. Default 1.25. */
  lowDpr?: number;
  /** How long motion must have stopped before full sharpness returns (ms). Default 150. */
  settleMs?: number;
}

/* ------------------------------------------------------------------ */
/* Pure helpers (unit tested)                                          */
/* ------------------------------------------------------------------ */

/** @tweenjs/tween.js 23 Easing.Cubic.InOut. */
export function easeCubicInOut(amount: number): number {
  if ((amount *= 2) < 1) return 0.5 * amount * amount * amount;
  return 0.5 * ((amount -= 2) * amount * amount + 2);
}

/** @tweenjs/tween.js 23 Easing.Quadratic.Out. */
export function easeQuadraticOut(amount: number): number {
  return amount * (2 - amount);
}

/** @tweenjs/tween.js 23 Easing.Quintic.Out. */
export function easeQuinticOut(amount: number): number {
  return --amount * amount * amount * amount * amount + 1;
}

/** tween.js elapsed portion for a single (non-repeating, no delay) tween. */
export function tweenPortion(elapsedMs: number, durationMs: number): number {
  if (durationMs === 0) return 1;
  return Math.min(Math.max(elapsedMs, 0) / durationMs, 1);
}

/**
 * globe.gl pointOfView: "Avoid rotating more than 180deg longitude". Returns the start longitude
 * shifted by whole turns so the tween goes the short way round.
 */
export function unwrapStartLng(curLng: number, finalLng: number): number {
  let lng = curLng;
  while (lng - finalLng > 180) lng -= 360;
  while (lng - finalLng < -180) lng += 360;
  return lng;
}

/** Linear interpolation of each coordinate, as tween.js `_updateProperties` does. */
export function lerpPov(from: Pov, to: Pov, value: number): Pov {
  return {
    lat: from.lat + (to.lat - from.lat) * value,
    lng: from.lng + (to.lng - from.lng) * value,
    altitude: from.altitude + (to.altitude - from.altitude) * value,
  };
}

/** Camera pov `elapsedMs` into a globe.gl pointOfView tween (Cubic.InOut). */
export function flyPovAt(from: Pov, to: Pov, elapsedMs: number, durationMs: number): Pov {
  return lerpPov(from, to, easeCubicInOut(tweenPortion(elapsedMs, durationMs)));
}

export const INTRO_SCALE_MS = 600;
export const INTRO_SPIN_MS = 1200;

/**
 * three-globe animate-in: scale 1e-6 -> 1 over 600ms (Quadratic.Out) and rotation about +Y
 * 2PI -> 0 over 1200ms (Quintic.Out), both started together.
 */
export function introStateAt(elapsedMs: number): { scale: number; rotation: number; done: boolean } {
  const k0 = 1e-6;
  const scale = k0 + (1 - k0) * easeQuadraticOut(tweenPortion(elapsedMs, INTRO_SCALE_MS));
  const rot0 = Math.PI * 2;
  const rotation = rot0 + (0 - rot0) * easeQuinticOut(tweenPortion(elapsedMs, INTRO_SPIN_MS));
  return { scale, rotation, done: elapsedMs >= INTRO_SPIN_MS };
}

export interface PixelRatioInput {
  /** Pixel ratio currently set on the renderer. */
  current: number;
  /** Full-sharpness ratio, min(2, devicePixelRatio). */
  base: number;
  /** Cap during motion. */
  low: number;
  /** Camera/globe in motion this frame. */
  moving: boolean;
  now: number;
  /** Time of the last frame that had motion. */
  lastMotionAt: number;
  settleMs: number;
}

export interface PixelRatioDecision {
  ratio: number;
  /** Milliseconds until a settle frame should render at full sharpness; null if none is pending. */
  settleIn: number | null;
}

/** Adaptive DPR: drop while moving, hold until motion has stopped for settleMs, then restore. */
export function decidePixelRatio(i: PixelRatioInput): PixelRatioDecision {
  if (i.moving) return { ratio: Math.min(i.base, i.low), settleIn: null };
  if (i.current === i.base) return { ratio: i.base, settleIn: null };
  const left = i.lastMotionAt + i.settleMs - i.now;
  if (left > 0) return { ratio: i.current, settleIn: left };
  return { ratio: i.base, settleIn: null };
}

/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */

/** The ThreeGlobe object (child of g.scene() carrying `__kapsuleInstance`). */
export function findGlobeObject(g: GlobeInstance): Object3D {
  const obj = tryFindGlobeObject(g);
  if (!obj) throw new Error('ThreeGlobe object not found in globe.gl scene');
  return obj;
}

/**
 * The ThreeGlobe object, or undefined if globe.gl hasn't added it to the scene yet (it does so in a
 * debounced update ~1ms after construction, so it is never there synchronously after `new Globe()`).
 */
export function tryFindGlobeObject(g: GlobeInstance): Object3D | undefined {
  return g.scene().children.find((c) => Object.prototype.hasOwnProperty.call(c, '__kapsuleInstance'));
}

const basePixelRatio = () => Math.min(2, window.devicePixelRatio || 1);
const Y_AXIS = new Vector3(0, 1, 0);

export function createRenderLoop(g: GlobeInstance, opts: RenderLoopOptions = {}): RenderLoop {
  const lowDpr = opts.lowDpr ?? 1.25;
  const settleMs = opts.settleMs ?? 150;

  const renderer = g.renderer();
  const composer = g.postProcessingComposer();
  const controls = g.controls();
  const camera = g.camera();
  const canvas = renderer.domElement;
  const globeObj = findGlobeObject(g);
  const hud = createPerfHud(renderer);

  // Same timer/delta semantics as three-render-objects' tick: seconds, capped at 1.
  const timer = new Timer();
  const tickers = new Set<(f: FrameInfo) => boolean | void>();

  let rafId = 0;
  let settleTimer = 0;
  let idle = true;
  let inFrame = false;
  let requestedInFrame = false;
  let first = true;
  let disposed = false;
  let lastMotionAt = -Infinity;

  camera.updateMatrixWorld();
  const lastPose = camera.matrixWorld.clone();
  const lastProj = camera.projectionMatrix.clone();
  const size = new Vector2();
  renderer.getSize(size);
  let lastW = size.x;
  let lastH = size.y;

  let fly: { from: Pov; to: Pov; start: number; ms: number } | null = null;
  let intro: { start: number } | null = null;

  const matrixChanged = (m: Matrix4, last: Matrix4) => {
    const a = m.elements;
    const b = last.elements;
    for (let i = 0; i < 16; i++) {
      if (a[i] !== b[i]) {
        last.copy(m);
        return true;
      }
    }
    return false;
  };

  const schedule = () => {
    if (disposed || rafId) return;
    if (idle) {
      // Measure the first delta from the wake-up, not from the last frame before going idle.
      timer.reset();
      idle = false;
    }
    rafId = requestAnimationFrame(frame);
  };

  const invalidate = () => {
    if (inFrame) requestedInFrame = true;
    else schedule();
  };

  const stepFly = (now: number): boolean => {
    if (!fly) return false;
    const elapsed = now - fly.start;
    if (elapsed < 0) return true;
    g.pointOfView(flyPovAt(fly.from, fly.to, elapsed, fly.ms), 0);
    if (elapsed >= fly.ms) fly = null;
    return true;
  };

  const stepIntro = (now: number): boolean => {
    if (!intro) return false;
    const elapsed = now - intro.start;
    if (elapsed < 0) return true;
    const s = introStateAt(elapsed);
    globeObj.scale.set(s.scale, s.scale, s.scale);
    globeObj.setRotationFromAxisAngle(Y_AXIS, s.rotation);
    if (s.done) intro = null;
    return true;
  };

  function frame() {
    rafId = 0;
    if (disposed) return;
    const now = performance.now();
    inFrame = true;
    requestedInFrame = false;

    // Animations first so controls.update below sees the new camera position and fires 'change'
    // (globe.gl's listener then runs onZoom + setPointOfView) in this same frame.
    const flying = stepFly(now);
    const globeMoved = stepIntro(now);

    // three-render-objects tick: controls.enabled && controls.update(min(1, delta)).
    const delta = Math.min(1, timer.update().getDelta());
    const controlsMoved = controls.enabled ? controls.update(delta) : false;

    camera.updateMatrixWorld();
    const poseMoved = matrixChanged(camera.matrixWorld, lastPose);
    const projMoved = matrixChanged(camera.projectionMatrix, lastProj);
    renderer.getSize(size);
    const sizeChanged = first || size.x !== lastW || size.y !== lastH;
    lastW = size.x;
    lastH = size.y;

    // Adaptive pixel ratio. Projection-only changes (resize, globeOffset) don't count as motion.
    const moving = !first && (poseMoved || flying || globeMoved);
    if (moving) lastMotionAt = now;
    const current = renderer.getPixelRatio();
    const dpr = decidePixelRatio({ current, base: basePixelRatio(), low: lowDpr, moving, now, lastMotionAt, settleMs });
    if (dpr.ratio !== current) {
      renderer.setPixelRatio(dpr.ratio);
      composer.setPixelRatio(dpr.ratio);
    }

    const info: FrameInfo = { now, cameraMoved: first || poseMoved || projMoved || sizeChanged, sizeChanged, globeMoved };
    first = false;
    let more = false;
    for (const fn of [...tickers]) {
      try {
        if (fn(info) === true) more = true;
      } catch (err) {
        // A failing ticker must not wedge the loop (inFrame would stay set and swallow invalidate()).
        console.error(err);
      }
    }

    // three-render-objects renders through its EffectComposer (single RenderPass to screen).
    composer.render();
    hud?.frame(performance.now() - now);
    inFrame = false;

    clearTimeout(settleTimer);
    settleTimer = 0;
    if (more || flying || globeMoved || controlsMoved || poseMoved || requestedInFrame || fly || intro) {
      schedule();
    } else {
      idle = true;
      if (dpr.settleIn !== null) settleTimer = window.setTimeout(invalidate, Math.ceil(dpr.settleIn));
    }
  }

  // Resizes: kapsule applies g.width()/height() in a debounced digest, which clears the canvas.
  // Render synchronously from the ResizeObserver (before paint) so no blank frame is shown.
  const ro = new ResizeObserver(() => {
    if (disposed || inFrame) return;
    renderer.getSize(size);
    if (size.x === lastW && size.y === lastH) return;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (idle) {
      timer.reset();
      idle = false;
    }
    frame();
  });
  ro.observe(canvas);

  const wake = () => invalidate();
  controls.addEventListener('start', wake);
  controls.addEventListener('change', wake);
  controls.addEventListener('end', wake);
  canvas.addEventListener('pointerdown', wake, { passive: true });
  canvas.addEventListener('pointerup', wake, { passive: true });
  canvas.addEventListener('wheel', wake, { passive: true });
  canvas.addEventListener('webglcontextrestored', wake);
  window.addEventListener('resize', wake);
  const onVisibility = () => {
    if (!document.hidden) invalidate();
  };
  document.addEventListener('visibilitychange', onVisibility);

  invalidate();

  return {
    invalidate,
    addTicker(fn) {
      tickers.add(fn);
      invalidate();
      return () => {
        tickers.delete(fn);
      };
    },
    flyTo(pov, ms) {
      // Mirrors globe.gl pointOfView(pov, ms): merge onto current coords, coerce to numbers, cancel any
      // ongoing fly, then jump or tween with Cubic.InOut the short way round in longitude.
      const cur = g.pointOfView();
      const merged = Object.assign({}, cur, pov);
      const to: Pov = { lat: +merged.lat, lng: +merged.lng, altitude: +merged.altitude };
      fly = null;
      if (!ms) {
        g.pointOfView(to, 0);
      } else {
        const from: Pov = { lat: cur.lat, lng: unwrapStartLng(cur.lng, to.lng), altitude: cur.altitude };
        fly = { from, to, start: performance.now(), ms };
      }
      invalidate();
    },
    playIntro() {
      globeObj.scale.set(1e-6, 1e-6, 1e-6);
      intro = { start: performance.now() };
      invalidate();
    },
    dispose() {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      clearTimeout(settleTimer);
      ro.disconnect();
      controls.removeEventListener('start', wake);
      controls.removeEventListener('change', wake);
      controls.removeEventListener('end', wake);
      canvas.removeEventListener('pointerdown', wake);
      canvas.removeEventListener('pointerup', wake);
      canvas.removeEventListener('wheel', wake);
      canvas.removeEventListener('webglcontextrestored', wake);
      window.removeEventListener('resize', wake);
      document.removeEventListener('visibilitychange', onVisibility);
      tickers.clear();
      hud?.dispose();
    },
  };
}
