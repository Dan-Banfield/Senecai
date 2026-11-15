// Fixed camera views for the ocarina stage, plus the pure rules for switching
// between them (cycle order, arrow-key handling, FOV fit, easing).
//
// Scene frame: +X to the player's right, +Y up, +Z towards the player; the
// ocarina is centred at the origin. Fog starts 5 units from the camera, so every
// preset stays within 4.5 of the target.

import * as THREE from 'three';
import type { SourceKind } from '../../input/types';

export type CameraViewId = 'front' | 'top' | 'side';

/** Cycle order for the arrow keys. */
export const VIEW_ORDER: readonly CameraViewId[] = ['front', 'top', 'side'];

/** First visit, or an invalid stored value. */
export const DEFAULT_VIEW: CameraViewId = 'top';

export const VIEW_LABEL: Record<CameraViewId, string> = { front: 'Front', top: 'Top', side: 'Side' };

/** Where the camera looks: the middle of the instrument, a touch towards the player. */
export const CAMERA_TARGET = new THREE.Vector3(0, -0.15, 0.05);

export interface CameraView {
  position: readonly [number, number, number];
  /** Turn of the picture about the line of sight, in radians (0 = floor at the bottom). */
  roll: number;
}

export const CAMERA_VIEWS: Record<CameraViewId, CameraView> = {
  // Across the instrument facing the player, ~21 deg above the table, ~4.1 away: looks straight at the holes.
  front: { position: [0, 1.35, -3.75], roll: 0 },
  // High and in front, ~60 deg up, looking down at the tilted hole face at an angle. Rolled
  // half a turn so the mouthpiece points down the screen, towards the viewer; no horizon
  // is in frame this steep, so the turn doesn't read as upside down.
  top: { position: [0.2, 3.4, -2.0], roll: Math.PI },
  // From the player's right, ~30 deg up, swung round towards the front so the holes stay in sight.
  side: { position: [3.0, 1.85, -1.67], roll: 0 },
};

/**
 * How far the instrument and hands are tipped about X so the finger holes (which
 * point up, +Y, in the model frame) face the front camera head-on.
 */
export const INSTRUMENT_TILT = Math.atan2(CAMERA_VIEWS.front.position[2] - CAMERA_TARGET.z, CAMERA_VIEWS.front.position[1] - CAMERA_TARGET.y);

/** Duration of the glide between views. */
export const GLIDE_SECONDS = 0.6;

/** Next (dir 1) or previous (dir -1) view in VIEW_ORDER, wrapping both ways. */
export function cycleView(id: CameraViewId, dir: 1 | -1): CameraViewId {
  const n = VIEW_ORDER.length;
  const i = Math.max(0, VIEW_ORDER.indexOf(id));
  return VIEW_ORDER[(((i + dir) % n) + n) % n];
}

/** A valid view id, or DEFAULT_VIEW for anything else (e.g. a stale stored value). */
export function parseView(v: unknown): CameraViewId {
  return typeof v === 'string' && (VIEW_ORDER as readonly string[]).includes(v) ? (v as CameraViewId) : DEFAULT_VIEW;
}

/** Vertical FOV (deg) that keeps both hands (~2.4 units across) in frame on narrow screens; never below 38. */
export function fitFov(distance: number, aspect: number): number {
  return Math.max(38, THREE.MathUtils.radToDeg(2 * Math.atan(1.25 / distance / aspect)));
}

/** Smoothstep ease-in-out on t clamped to [0, 1]. */
export const easeInOut = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export interface CameraKeyEvent {
  key: string;
  shiftKey: boolean;
  repeat: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  target: EventTarget | null | { closest?: (sel: string) => unknown; isContentEditable?: boolean };
}

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function inEditable(target: CameraKeyEvent['target']): boolean {
  if (!target || typeof target !== 'object') return false;
  const t = target as { closest?: unknown; isContentEditable?: unknown };
  if (t.isContentEditable === true) return true;
  return typeof t.closest === 'function' && !!(t.closest as (sel: string) => unknown).call(target, EDITABLE);
}

/**
 * Camera step for a keydown, or null if the key isn't a camera key. Left/Right
 * only; ignored on repeat, with Alt/Ctrl/Meta, and inside editable fields. With
 * the keyboard source, plain arrows turn the wrist, so Shift is required.
 */
export function cameraKeyStep(e: CameraKeyEvent, sourceKind: SourceKind | null): 1 | -1 | null {
  const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : null;
  if (dir === null) return null;
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return null;
  if (sourceKind === 'keyboard' && !e.shiftKey) return null;
  if (inEditable(e.target)) return null;
  return dir;
}
