// Kantele game logic, independent of rendering. The 3D stage calls tick() every
// frame and draws whatever state is here. The React UI reads the small zustand
// store, which only changes on events.

import * as THREE from 'three';
import { create } from 'zustand';
import { primaryCommand, usePipeline } from '../../input/pipeline';
import { eventsBetween, Recorder, samplePose, type Recording } from '../../recording/recording';
import type { RobotPose } from '../../robot/RobotHand';
import type { Dof6 } from '../../robot/retarget';
import { pluckString, unlockAudio } from './audio';
import { PluckDetector, STRING_DOF, type Lesson } from './music';

export type KanteleMode = { kind: 'free' } | { kind: 'lesson'; lesson: Lesson } | { kind: 'replay'; recording: Recording };
export type Judgement = 'perfect' | 'good' | 'miss';

interface KanteleUi {
  phase: 'ready' | 'countdown' | 'playing' | 'finished';
  countdown: number;
  counts: Record<Judgement, number>;
  total: number;
  done: number;
  feedback: { text: string; kind: Judgement | 'info'; at: number } | null;
  recording: boolean;
  recordedPlucks: number;
  lastRecording: Recording | null;
}

export const useKanteleUi = create<KanteleUi>(() => ({
  phase: 'ready',
  countdown: 0,
  counts: { perfect: 0, good: 0, miss: 0 },
  total: 0,
  done: 0,
  feedback: null,
  recording: false,
  recordedPlucks: 0,
  lastRecording: null,
}));

/** Robot wrist rest position above the strings (world units). */
export const HAND_BASE = new THREE.Vector3(0, 0.95, 0.9);
/** String x offsets for a right hand (thumb, index, middle, ring, little), matching the robot's fingertips. */
const STRING_X_RIGHT = [-1.0, -0.3, -0.1, 0.1, 0.3];
/** Where each fingertip meets its string (z), i.e. the hit zone. */
const HIT_Z_RIGHT = [0.74, -0.1, -0.13, -0.1, -0.02];
export const STRING_Y = HAND_BASE.y - 0.62;
export const NOTE_SPEED = 2.2; // world units per second along the string

const PERFECT_MS = 90;
const GOOD_MS = 200;
const LEAD_IN_MS = 2400;

export interface NoteState {
  t: number;
  string: number;
  result?: Judgement;
}

export class KanteleSession {
  songTime = 0;
  strings = Array.from({ length: 5 }, () => ({ amp: 0, glow: 0 }));
  notes: NoteState[] = [];
  livePose?: RobotPose;
  ghostPose?: RobotPose;
  stringX: number[] = STRING_X_RIGHT;
  hitZ: number[] = HIT_Z_RIGHT;
  side: 'left' | 'right' = 'right';
  private detector = new PluckDetector();
  private recorder: Recorder;
  private waitingIndex = 0;

  constructor(public mode: KanteleMode) {
    const kind = usePipeline.getState().kind ?? 'none';
    this.recorder = new Recorder('kantele', kind);
    if (mode.kind === 'lesson') this.notes = mode.lesson.notes.map((n) => ({ ...n }));
  }

  /** Reset the UI store for this session. Call from an effect, not during render. */
  activate() {
    useKanteleUi.setState({
      phase: 'ready',
      countdown: 0,
      counts: { perfect: 0, good: 0, miss: 0 },
      total: this.notes.length,
      done: 0,
      feedback: null,
      recording: false,
      recordedPlucks: 0,
    });
  }

  setSide(side: 'left' | 'right') {
    this.side = side;
    const m = side === 'left' ? -1 : 1;
    this.stringX = STRING_X_RIGHT.map((x) => x * m);
    this.hitZ = HIT_Z_RIGHT;
  }

  start() {
    unlockAudio();
    this.songTime = this.mode.kind === 'lesson' ? -LEAD_IN_MS : 0;
    this.waitingIndex = 0;
    if (this.mode.kind === 'lesson') this.notes = this.mode.lesson.notes.map((n) => ({ ...n }));
    useKanteleUi.setState({ phase: this.mode.kind === 'lesson' ? 'countdown' : 'playing', counts: { perfect: 0, good: 0, miss: 0 }, done: 0, feedback: null });
  }

  toggleRecording() {
    unlockAudio();
    if (this.recorder.active) {
      const rec = this.recorder.stop();
      useKanteleUi.setState({ recording: false, lastRecording: rec.events.length ? rec : null });
    } else {
      this.recorder.start();
      useKanteleUi.setState({ recording: true, recordedPlucks: 0, lastRecording: null });
    }
  }

  /** Called every frame by the stage. */
  tick(dtMs: number) {
    if (import.meta.env.DEV) (window as unknown as { senecaiKantele: KanteleSession }).senecaiKantele = this;
    const ui = useKanteleUi.getState();
    for (const s of this.strings) {
      s.amp *= Math.pow(0.02, dtMs / 1000);
      s.glow *= Math.pow(0.05, dtMs / 1000);
    }

    if (this.mode.kind === 'replay') return this.tickReplay(dtMs, ui.phase);

    // Live robot hand from the human's hand.
    const cmd = primaryCommand();
    if (cmd) {
      this.setSide(cmd.side);
      const pos = HAND_BASE.clone().add(cmd.position.clone().multiplyScalar(0.12));
      const rot = new THREE.Quaternion().slerp(cmd.rotation, 0.3);
      this.livePose = { dof: cmd.dof, position: pos, rotation: rot };
      for (const p of this.detector.update(cmd.dof, dtMs)) this.onPluck(p.string, p.velocity);
      this.recorder.frame([{ side: cmd.side, pose: this.livePose }]);
    } else {
      this.livePose = undefined;
    }

    if (this.mode.kind === 'lesson' && (ui.phase === 'countdown' || ui.phase === 'playing')) this.tickLesson(dtMs, this.mode.lesson, ui.phase);
  }

  private tickLesson(dtMs: number, lesson: Lesson, phase: KanteleUi['phase']) {
    if (lesson.wait) {
      const next = this.notes[this.waitingIndex];
      // Advance time, but freeze on the next note until it's played.
      if (next && this.songTime + dtMs >= next.t) this.songTime = next.t;
      else this.songTime += dtMs;
    } else {
      this.songTime += dtMs;
      for (const n of this.notes) {
        if (!n.result && this.songTime - n.t > GOOD_MS) {
          n.result = 'miss';
          this.judge('miss');
        }
      }
    }
    if (phase === 'countdown') {
      const c = Math.ceil(-this.songTime / 800);
      if (this.songTime >= 0) useKanteleUi.setState({ phase: 'playing', countdown: 0 });
      else if (c !== useKanteleUi.getState().countdown) useKanteleUi.setState({ countdown: c });
    }
    const last = this.notes[this.notes.length - 1];
    if (this.notes.every((n) => n.result) || (last && this.songTime > last.t + 1500 && !lesson.wait)) {
      if (useKanteleUi.getState().phase !== 'finished') useKanteleUi.setState({ phase: 'finished' });
    }
    this.ghostPose = this.computeGhost(lesson);
  }

  private computeGhost(lesson: Lesson): RobotPose | undefined {
    const base = this.livePose ?? { dof: [0, 0, 0, 0, 0, 0] as Dof6, position: HAND_BASE.clone(), rotation: new THREE.Quaternion() };
    if (lesson.fromCreation) {
      // The creator's real recorded hand, time-aligned to the lesson.
      const plucks = lesson.fromCreation.recording.events.filter((e) => e.type === 'pluck');
      const offset = plucks[0]?.t ?? 0;
      const p = samplePose(lesson.fromCreation.recording, this.songTime + offset);
      if (p) return { ...p, position: HAND_BASE.clone(), rotation: new THREE.Quaternion() };
    }
    // Synthetic demonstrator: each finger dips just as its note arrives.
    const dof: Dof6 = [0.05, 0.1, 0.1, 0.1, 0.1, 0.1];
    for (const n of this.notes) {
      const d = (n.t - this.songTime) / 260;
      if (Math.abs(d) < 1) dof[STRING_DOF[n.string]] = Math.max(dof[STRING_DOF[n.string]], 0.1 + 0.6 * Math.cos((d * Math.PI) / 2) ** 2);
    }
    if (lesson.wait) {
      const next = this.notes[this.waitingIndex];
      if (next && this.songTime >= next.t) dof[STRING_DOF[next.string]] = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(performance.now() / 120));
    }
    return { dof, position: base.position.clone(), rotation: base.rotation.clone() };
  }

  private tickReplay(dtMs: number, phase: KanteleUi['phase']) {
    if (this.mode.kind !== 'replay' || phase !== 'playing') return;
    const rec = this.mode.recording;
    const prev = this.songTime;
    this.songTime += dtMs;
    this.livePose = samplePose(rec, this.songTime);
    for (const e of eventsBetween(rec, prev, this.songTime)) {
      if (e.type === 'pluck') this.sound(e.string, e.velocity);
    }
    if (this.songTime > rec.durationMs + 500) useKanteleUi.setState({ phase: 'finished' });
  }

  private sound(string: number, velocity: number) {
    pluckString(string, velocity);
    this.strings[string].amp = 0.6 + velocity * 0.4;
    this.strings[string].glow = 1;
  }

  private onPluck(string: number, velocity: number) {
    this.sound(string, velocity);
    if (this.recorder.active) {
      this.recorder.event({ type: 'pluck', string, velocity: Math.round(velocity * 100) / 100 });
      useKanteleUi.setState({ recordedPlucks: this.recorder.eventCount });
    }
    if (this.mode.kind !== 'lesson' || useKanteleUi.getState().phase !== 'playing') return;

    if (this.mode.lesson.wait) {
      const next = this.notes[this.waitingIndex];
      if (next && next.string === string) {
        // At your own pace: the right string is always accepted, early or not.
        this.songTime = Math.max(this.songTime, next.t);
        next.result = 'perfect';
        this.waitingIndex++;
        this.judge('perfect');
      }
      return;
    }
    let best: NoteState | undefined;
    for (const n of this.notes) {
      if (n.result || n.string !== string) continue;
      const d = Math.abs(n.t - this.songTime);
      if (d <= GOOD_MS && (!best || d < Math.abs(best.t - this.songTime))) best = n;
    }
    if (best) {
      const j: Judgement = Math.abs(best.t - this.songTime) <= PERFECT_MS ? 'perfect' : 'good';
      best.result = j;
      this.judge(j);
    }
  }

  private judge(j: Judgement) {
    const ui = useKanteleUi.getState();
    const text = j === 'perfect' ? 'Kaunis! (Beautiful)' : j === 'good' ? 'Hyvä! (Good)' : 'Missed';
    useKanteleUi.setState({ counts: { ...ui.counts, [j]: ui.counts[j] + 1 }, done: ui.done + 1, feedback: { text, kind: j, at: performance.now() } });
  }

  replay() {
    unlockAudio();
    this.songTime = 0;
    useKanteleUi.setState({ phase: 'playing' });
  }

  dispose() {
    if (this.recorder.active) this.recorder.stop();
  }
}
