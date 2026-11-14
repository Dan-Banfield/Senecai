// The piano: both robot hands over a keyboard, driven by your hands. Nothing
// is triggered by finger angles; every note comes from a robot fingertip
// physically pushing a key down (see collision.ts).
//
// The robot hands show your hands one to one: every finger bone as measured,
// with no remapping. The only thing calibration changes is where the hands sit:
// calibrating on this page (context "piano") takes your resting hand as it is
// and places it on the keys, its lowest fingertip just above them and the index
// finger over D (right hand) or F (left hand).

import * as THREE from 'three';
import { create } from 'zustand';
import { live, positionScale, usePipeline } from '../../input/pipeline';
import { fingertips } from '../../robot/fingertips';
import type { RobotPose } from '../../robot/RobotHand';
import type { Dof6, RobotHandCommand } from '../../robot/retarget';
import type { Side } from '../../rokoko/types';
import { noteOff, noteOn, unlockPiano } from './audio';
import { PAD, pressKeys, stepKeys, type KeyEvent } from './collision';
import { KEYBOARD_WIDTH, KEYS, keyIndex, noteName, SONG, SONG_BPM, TRAVEL } from './keys';

export type PianoMode = 'learn' | 'free';

export interface PianoUi {
  phase: 'ready' | 'playing' | 'listening' | 'finished';
  /** The next note of the song to play. */
  step: number;
  hits: number;
  misses: number;
  feedback: { text: string; kind: 'good' | 'warn' | 'info'; at: number } | null;
  /** Recently played notes, newest last (free play). */
  played: string[];
}

export const usePianoUi = create<PianoUi>(() => ({ phase: 'ready', step: 0, hits: 0, misses: 0, feedback: null, played: [] }));

/** Until you calibrate, the hands are placed as if resting like this: fingers gently curved. */
const DEFAULT_REST: Dof6 = [0.4, 0.2, 0.25, 0.22, 0.25, 0.3];

/** Fingertips land on the front half of the white keys, clear of the black ones. */
export const FINGER_Z = 0.26;
/** Gap between resting fingertips and the key tops. */
const CLEARANCE = 0.025;

/**
 * Where to put a hand so that, resting as `pose` (position ignored), its lowest
 * fingertip is just above the keys, its index finger is over D4 (right hand) or
 * F3 (left hand), and its fingertips are on the front half of the white keys.
 */
export function restHome(side: Side, pose: Omit<RobotPose, 'position'>) {
  const tips = fingertips({ ...pose, position: new THREE.Vector3() }, side);
  const index = KEYS[keyIndex(side === 'right' ? 62 : 53)];
  const fingersZ = (tips[1].z + tips[2].z + tips[3].z) / 3;
  const lowest = Math.min(...tips.map((p) => p.y));
  return new THREE.Vector3(index.x - tips[1].x, -lowest + PAD + CLEARANCE, FINGER_Z - fingersZ);
}

export const homePosition = (side: Side) => restHome(side, { dof: DEFAULT_REST, rotation: new THREE.Quaternion() });

const HOME_KEY = 'senecai.piano.home.v1';
function loadHomes(kind: string): Record<Side, THREE.Vector3> | null {
  try {
    const all = JSON.parse(localStorage.getItem(HOME_KEY) ?? '{}');
    const h = all[kind];
    return h ? { left: new THREE.Vector3().fromArray(h.left), right: new THREE.Vector3().fromArray(h.right) } : null;
  } catch {
    return null;
  }
}
function saveHomes(kind: string, homes: Record<Side, THREE.Vector3>) {
  try {
    const all = JSON.parse(localStorage.getItem(HOME_KEY) ?? '{}');
    all[kind] = { left: homes.left.toArray(), right: homes.right.toArray() };
    localStorage.setItem(HOME_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked: the placement still holds for this visit.
  }
}

/** Inputs whose hand positions are real (the webcam sees the hands, or the mouse moves one). */
const TRACKED = new Set(['webcam', 'fused', 'keyboard']);
const SIDES: Side[] = ['left', 'right'];
const BEAT = 60 / SONG_BPM;

export class PianoSession {
  readonly hands: Record<Side, { pose?: RobotPose }> = { left: {}, right: {} };
  /** How far each key is down right now (index into KEYS). */
  readonly keys = { depth: new Float32Array(KEYS.length), down: new Uint8Array(KEYS.length) };
  /** "Listen" playback: when it started (wall clock, so the tempo doesn't depend on frame rate). */
  private demo: { start: number } | null = null;
  /** Where each hand sits at rest on the keys, for the current input. */
  private home: Record<Side, THREE.Vector3> = { left: homePosition('left'), right: homePosition('right') };
  private homeKind: string | null = null;
  private seenCalibration = usePipeline.getState().calibratedAt?.at ?? 0;

  constructor(readonly mode: PianoMode) {}

  activate() {
    usePipeline.getState().setCalibrationContext('piano');
    usePianoUi.setState({ phase: 'ready', step: 0, hits: 0, misses: 0, feedback: null, played: [] });
  }

  dispose() {
    usePipeline.getState().setCalibrationContext('default');
    for (const k of KEYS) noteOff(k.midi);
  }

  /** The note the learner should play next, if any. */
  get target(): number | null {
    const ui = usePianoUi.getState();
    if (this.mode !== 'learn' || (ui.phase !== 'playing' && ui.phase !== 'ready')) return null;
    return SONG[ui.step]?.[0] ?? null;
  }

  start() {
    unlockPiano();
    this.demo = null;
    usePianoUi.setState({ phase: 'playing', step: 0, hits: 0, misses: 0, feedback: { text: 'Play the glowing key', kind: 'info', at: performance.now() } });
  }

  listen() {
    unlockPiano();
    this.demo = { start: performance.now() + 400 };
    usePianoUi.setState({ phase: 'listening', feedback: null });
  }

  private say(text: string, kind: 'good' | 'warn' | 'info') {
    usePianoUi.setState({ feedback: { text, kind, at: performance.now() } });
  }

  private rotationFor(cmd: RobotHandCommand) {
    return cmd.absolute ? cmd.rotation.clone() : new THREE.Quaternion().slerp(cmd.rotation, 0.35);
  }

  /** Placement only: calibrating here puts your resting hands, exactly as they are, on the keys. */
  private updateHomes() {
    const pipe = usePipeline.getState();
    const kind = pipe.kind ?? '';
    if (kind !== this.homeKind) {
      this.homeKind = kind;
      this.home = loadHomes(kind) ?? { left: homePosition('left'), right: homePosition('right') };
    }
    const cal = pipe.calibratedAt;
    if (!cal || cal.at === this.seenCalibration) return;
    this.seenCalibration = cal.at;
    if (cal.step !== 'open' || cal.context !== 'piano') return;
    for (const side of SIDES) {
      const cmd = live.commands[side];
      if (cmd) this.home[side] = restHome(side, { dof: cmd.dof, rotation: this.rotationFor(cmd), shape: cmd.shape });
    }
    saveHomes(kind, this.home);
  }

  /** A robot hand's pose from your hand: your hand exactly, placed on the keys. */
  private poseFor(side: Side, cmd: RobotHandCommand): RobotPose {
    const position = this.home[side].clone();
    const kind = usePipeline.getState().kind ?? '';
    // The keyboard emulator's mouse only moves the right hand; its left stays home.
    if (TRACKED.has(kind) && !(kind === 'keyboard' && side === 'left')) {
      // Real scale: your hand moving 2.2 cm moves the robot's one key along.
      const k = positionScale() * 10;
      const limit = KEYBOARD_WIDTH / 2;
      position.x = THREE.MathUtils.clamp(position.x + cmd.position.x * k, -limit, limit);
      position.y = THREE.MathUtils.clamp(position.y + cmd.position.y * k, position.y - 0.4, position.y + 1.6);
      position.z = THREE.MathUtils.clamp(position.z + cmd.position.z * k, position.z - 0.7, position.z + 0.6);
    }
    return { dof: cmd.dof, position, rotation: this.rotationFor(cmd), shape: cmd.shape };
  }

  tick(dtMs: number) {
    const dt = Math.min(0.05, dtMs / 1000);
    this.updateHomes();
    const pushed = new Float32Array(KEYS.length);
    for (const side of SIDES) {
      const cmd = live.commands[side];
      if (!cmd) {
        this.hands[side].pose = undefined;
        continue;
      }
      const pose = this.poseFor(side, cmd);
      // Fingers can't pass through the keys: if one bottoms out, the hand rides up on it.
      const first = pressKeys(fingertips(pose, side));
      if (first.lift > 0) pose.position.y += first.lift;
      const contact = first.lift > 0 ? pressKeys(fingertips(pose, side)) : first;
      for (let i = 0; i < KEYS.length; i++) pushed[i] = Math.max(pushed[i], contact.depress[i]);
      this.hands[side].pose = pose;
    }

    // "Listen": the piano plays the song by itself.
    if (this.demo) {
      const t = (performance.now() - this.demo.start) / 1000;
      let start = 0;
      for (const [midi, beats] of SONG) {
        const end = start + beats * BEAT;
        if (t >= start && t < start + (end - start) * 0.85) pushed[keyIndex(midi)] = TRAVEL;
        start = end;
      }
      if (t > start + 0.6) {
        this.demo = null;
        usePianoUi.setState({ phase: 'ready' });
      }
    }

    for (const e of stepKeys(this.keys, pushed, dt)) this.onKey(e);
  }

  private onKey(e: KeyEvent) {
    if (!e.on) return noteOff(e.midi);
    noteOn(e.midi, e.velocity);
    const ui = usePianoUi.getState();
    if (ui.phase === 'listening') return;
    if (this.mode === 'free') {
      usePianoUi.setState({ played: [...ui.played.slice(-11), noteName(e.midi)] });
      return;
    }
    if (ui.phase !== 'playing') return;
    const [want, , lyric] = SONG[ui.step];
    if (e.midi === want) {
      const step = ui.step + 1;
      if (step >= SONG.length) {
        usePianoUi.setState({ step, hits: ui.hits + 1, phase: 'finished' });
        this.say('Mary had a little lamb!', 'good');
      } else {
        usePianoUi.setState({ step, hits: ui.hits + 1 });
        this.say(lyric, 'good');
      }
    } else {
      usePianoUi.setState({ misses: ui.misses + 1 });
      this.say(`That was ${noteName(e.midi)}; the glowing key is ${noteName(want)}`, 'warn');
    }
  }
}
