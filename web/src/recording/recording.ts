// A recording is a teleoperation demonstration: the robot's joint-space
// trajectory (what the robot did) plus task events (what happened in the craft).
// The same object powers community replays, "learn from this creation"
// tutorials, and the exportable training dataset.

import * as THREE from 'three';
import type { BenchCraftId } from '../bench/core';
import type { RobotPose } from '../robot/RobotHand';
import type { Dof6 } from '../robot/retarget';
import type { Side } from '../rokoko/types';

/** Every craft with a playable page. Kantele records v1 recordings; the rest are workbench (v2) crafts. */
export type CraftId = 'kantele' | BenchCraftId;
/** Crafts that used the original (v1) recording format. */
export type LegacyCraftId = 'kantele';

export interface RecHand {
  side: Side;
  dof: number[];
  p: number[];
  q: number[];
}
export interface RecFrame {
  t: number;
  hands: RecHand[];
}
export type RecEvent =
  | { t: number; type: 'pluck'; string: number; velocity: number }
  | { t: number; type: 'cut'; cells: number[] }
  | { t: number; type: 'yaw'; value: number };

export interface Recording {
  version: 1;
  craft: LegacyCraftId;
  source: string;
  durationMs: number;
  frames: RecFrame[];
  events: RecEvent[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export class Recorder {
  private frames: RecFrame[] = [];
  private events: RecEvent[] = [];
  private t0 = 0;
  private lastFrameT = -1;
  active = false;

  constructor(
    private craft: LegacyCraftId,
    private source: string,
    private sampleHz = 30,
  ) {}

  start() {
    this.frames = [];
    this.events = [];
    this.t0 = performance.now();
    this.lastFrameT = -1;
    this.active = true;
  }

  now() {
    return performance.now() - this.t0;
  }

  frame(poses: { side: Side; pose: RobotPose }[]) {
    if (!this.active) return;
    const t = this.now();
    if (this.lastFrameT >= 0 && t - this.lastFrameT < 1000 / this.sampleHz) return;
    this.lastFrameT = t;
    this.frames.push({
      t: Math.round(t),
      hands: poses.map(({ side, pose }) => ({
        side,
        dof: pose.dof.map(r3),
        p: pose.position.toArray().map(r3),
        q: pose.rotation.toArray().map(r3),
      })),
    });
  }

  event(e: Omit<Extract<RecEvent, { type: 'pluck' }>, 't'> | Omit<Extract<RecEvent, { type: 'cut' }>, 't'> | Omit<Extract<RecEvent, { type: 'yaw' }>, 't'>) {
    if (!this.active) return;
    this.events.push({ ...e, t: Math.round(this.now()) } as RecEvent);
  }

  get eventCount() {
    return this.events.length;
  }

  stop(): Recording {
    this.active = false;
    return { version: 1, craft: this.craft, source: this.source, durationMs: Math.round(this.now()), frames: this.frames, events: this.events };
  }
}

/** Interpolated robot pose for one hand at time t (ms). */
export function samplePose(rec: Recording, t: number, side?: Side): RobotPose | undefined {
  const f = rec.frames;
  if (!f.length) return undefined;
  let lo = 0;
  let hi = f.length - 1;
  if (t <= f[0].t) hi = 0;
  else if (t >= f[hi].t) lo = hi;
  else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (f[mid].t <= t) lo = mid;
      else hi = mid;
    }
  }
  const pick = (fr: RecFrame) => (side ? fr.hands.find((h) => h.side === side) : fr.hands[0]);
  const a = pick(f[lo]);
  const b = pick(f[hi]);
  if (!a) return undefined;
  const span = f[hi].t - f[lo].t;
  const k = !b || span <= 0 ? 0 : (t - f[lo].t) / span;
  const B = b ?? a;
  const dof = a.dof.map((v, i) => v + (B.dof[i] - v) * k) as Dof6;
  const position = new THREE.Vector3().fromArray(a.p).lerp(new THREE.Vector3().fromArray(B.p), k);
  const rotation = new THREE.Quaternion().fromArray(a.q).slerp(new THREE.Quaternion().fromArray(B.q), k);
  return { dof, position, rotation };
}

export function eventsBetween(rec: Recording, t0: number, t1: number): RecEvent[] {
  return rec.events.filter((e) => e.t > t0 && e.t <= t1);
}

/** Download a recording as a demonstration dataset file. */
export function downloadDemonstration(rec: Recording, title: string) {
  const dataset = {
    format: 'senecai-demonstration/v1',
    description:
      'Human teleoperation demonstration captured via Rokoko-format hand tracking and retargeted to a 6-DoF Inspire-style robot hand. ' +
      'frames[].hands[].dof = [thumbRotate, thumbBend, index, middle, ring, little] in 0 (open)..1 (closed); p/q = wrist pose in scene coordinates.',
    title,
    ...rec,
  };
  const blob = new Blob([JSON.stringify(dataset)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'demonstration'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
