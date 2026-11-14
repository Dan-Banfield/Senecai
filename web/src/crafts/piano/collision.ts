// Fingers against keys. A key goes down only when a fingertip pushes its top
// down, as far as the fingertip has gone below where the top was; at the bottom
// of its travel it stops, and so does the finger: the hand is lifted so that no
// fingertip sinks through a key (or the wood around the keys). Notes sound when
// a key gets near the bottom of its travel, like a real piano's escapement.

import type * as THREE from 'three';
import { KEYS, keyAt, TRAVEL, WHITE_L } from './keys';

/** Radius of a fingertip pad (scene units: 0.6 cm). */
export const PAD = 0.06;
/** A key sounds once it is this far down, and resets when it comes back up past RESET. */
export const STRIKE = 0.65 * TRAVEL;
export const RESET = 0.35 * TRAVEL;

export interface Contact {
  /** How far each key is pushed down (0..TRAVEL), by index into KEYS. */
  depress: Float32Array;
  /** How far the hand must rise so no fingertip goes through a key or the case. */
  lift: number;
  /** Key under each fingertip (-1 if none), for highlighting. */
  under: number[];
}

/** Height of the solid surface under (x, z) when nothing is pressed: key tops, or the case outside the keys. */
const KEY_SLIP = 0.03;

export function pressKeys(tips: THREE.Vector3[], pad = PAD): Contact {
  const depress = new Float32Array(KEYS.length);
  let lift = 0;
  const under: number[] = [];
  for (const p of tips) {
    const bottom = p.y - pad;
    const i = keyAt(p.x, p.z);
    under.push(i);
    if (i < 0) {
      // Over the wooden key slip in front of the keys, or the case behind them.
      if (Math.abs(p.z) < WHITE_L / 2 + 0.35) lift = Math.max(lift, KEY_SLIP - bottom);
      continue;
    }
    const top = KEYS[i].top;
    if (bottom >= top) continue;
    depress[i] = Math.max(depress[i], Math.min(TRAVEL, top - bottom));
    // The key bottoms out: the finger can't go further.
    lift = Math.max(lift, top - TRAVEL - bottom);
  }
  return { depress, lift: Math.max(0, lift), under };
}

export interface KeyEvent {
  midi: number;
  on: boolean;
  /** 0..1, from how fast the key was going down. */
  velocity: number;
}

/**
 * Advance the keys from their pushed depths: they follow a finger down at once,
 * spring back up at a key's own speed, and report notes starting and stopping.
 */
export function stepKeys(state: { depth: Float32Array; down: Uint8Array }, pushed: Float32Array, dt: number): KeyEvent[] {
  const events: KeyEvent[] = [];
  for (let i = 0; i < KEYS.length; i++) {
    const was = state.depth[i];
    const want = pushed[i];
    const now = want >= was ? want : Math.max(want, was - dt * 1.6); // the spring returns a key in about 60 ms
    state.depth[i] = now;
    if (!state.down[i] && now >= STRIKE) {
      state.down[i] = 1;
      const speed = dt > 0 ? (now - was) / dt : 1;
      events.push({ midi: KEYS[i].midi, on: true, velocity: Math.max(0.15, Math.min(1, speed / 1.6)) });
    } else if (state.down[i] && now < RESET) {
      state.down[i] = 0;
      events.push({ midi: KEYS[i].midi, on: false, velocity: 0 });
    }
  }
  return events;
}
