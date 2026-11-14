// Bench recordings: what both robot hands did, which tool each held, and the
// ops applied to the workpieces in every frame. Replaying the ops frame by
// frame rebuilds the object's mesh as it was made; keyframes (computed in
// memory, never stored) make seeking fast.

import * as THREE from 'three';
import type { RobotPose } from '../robot/RobotHand';
import type { Dof6 } from '../robot/retarget';
import type { Side } from '../rokoko/types';
import { Bench, r3, type BenchCraftId, type BenchSnapshot, type CraftBench, type Op } from './core';

export interface BenchHand {
  side: Side;
  dof: number[];
  p: number[];
  q: number[];
  /** Tool id held in this frame, or null. */
  tool: string | null;
}

export interface BenchFrame {
  t: number;
  hands: BenchHand[];
  /** Ops applied in this frame, in order. */
  ops?: Op[];
}

export interface BenchRecording {
  version: 2;
  craft: BenchCraftId;
  source: string;
  durationMs: number;
  frames: BenchFrame[];
}

export const isBenchRecording = (r: { version: number }): r is BenchRecording => r.version === 2;

export class BenchRecorder {
  private frames: BenchFrame[] = [];
  private t0 = 0;
  private lastT = -1;
  active = false;
  opCount = 0;

  constructor(
    private craft: BenchCraftId,
    private source: string,
    private sampleHz = 30,
  ) {}

  start() {
    this.frames = [];
    this.t0 = performance.now();
    this.lastT = -1;
    this.opCount = 0;
    this.active = true;
  }

  /** Record one frame. Frames with ops are always kept; others are sampled at `sampleHz`. */
  frame(hands: { side: Side; pose: RobotPose; tool: string | null }[], ops: Op[]) {
    if (!this.active) return;
    const t = performance.now() - this.t0;
    if (!ops.length && this.lastT >= 0 && t - this.lastT < 1000 / this.sampleHz) return;
    this.lastT = t;
    this.opCount += ops.length;
    const f: BenchFrame = {
      t: Math.round(t),
      hands: hands.map(({ side, pose, tool }) => ({
        side,
        dof: pose.dof.map(r3),
        p: pose.position.toArray().map(r3),
        q: pose.rotation.toArray().map(r3),
        tool,
      })),
    };
    if (ops.length) f.ops = ops;
    this.frames.push(f);
  }

  stop(): BenchRecording {
    this.active = false;
    const durationMs = Math.round(Math.max(this.frames.at(-1)?.t ?? 0, performance.now() - this.t0));
    return { version: 2, craft: this.craft, source: this.source, durationMs, frames: this.frames };
  }
}

/** Index of the last frame with t <= time, or -1. */
export function frameAt(rec: BenchRecording, time: number) {
  const f = rec.frames;
  let lo = 0;
  let hi = f.length - 1;
  if (!f.length || time < f[0].t) return -1;
  if (time >= f[hi].t) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (f[mid].t <= time) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Interpolated pose of one hand at `time`, plus the tool it holds. */
export function sampleHand(rec: BenchRecording, time: number, side: Side): { pose: RobotPose; tool: string | null } | undefined {
  const i = frameAt(rec, time);
  if (i < 0) return undefined;
  const a = rec.frames[i].hands.find((h) => h.side === side);
  if (!a) return undefined;
  const next = rec.frames[i + 1];
  const b = next?.hands.find((h) => h.side === side) ?? a;
  const span = next ? next.t - rec.frames[i].t : 0;
  const k = span > 0 ? Math.min(1, (time - rec.frames[i].t) / span) : 0;
  return {
    tool: a.tool,
    pose: {
      dof: a.dof.map((v, j) => v + (b.dof[j] - v) * k) as Dof6,
      position: new THREE.Vector3().fromArray(a.p).lerp(new THREE.Vector3().fromArray(b.p), k),
      rotation: new THREE.Quaternion().fromArray(a.q).slerp(new THREE.Quaternion().fromArray(b.q), k),
    },
  };
}

/** Replays a recording onto a bench, with seeking via in-memory keyframes. */
export class BenchPlayer {
  /** Index of the next frame whose ops have not been applied. */
  private next = 0;
  private keyframes: { i: number; snap: BenchSnapshot }[] = [];
  time = 0;

  constructor(
    readonly rec: BenchRecording,
    readonly bench: Bench,
    keyEveryMs = 2000,
  ) {
    // Fast-forward once on a scratch bench to build keyframes for seeking.
    const scratch = new Bench(bench.def);
    let lastKey = -Infinity;
    rec.frames.forEach((f, i) => {
      if (f.t - lastKey >= keyEveryMs) {
        this.keyframes.push({ i, snap: scratch.snapshot() });
        lastKey = f.t;
      }
      for (const op of f.ops ?? []) scratch.apply(op);
    });
  }

  /** Advance to `time`, applying every op on the way. Returns the ops applied. */
  advance(time: number): Op[] {
    if (time < this.time) {
      this.seek(time);
      return [];
    }
    const applied: Op[] = [];
    const f = this.rec.frames;
    while (this.next < f.length && f[this.next].t <= time) {
      for (const op of f[this.next].ops ?? []) {
        this.bench.apply(op);
        applied.push(op);
      }
      this.next++;
    }
    this.time = time;
    return applied;
  }

  seek(time: number) {
    const target = frameAt(this.rec, time) + 1; // frames [0, target) should be applied
    let key = this.keyframes[0];
    for (const k of this.keyframes) if (k.i <= target) key = k;
    if (key) {
      this.bench.restore(key.snap);
      this.next = key.i;
    } else {
      this.bench.reset();
      this.next = 0;
    }
    this.time = this.next ? this.rec.frames[this.next - 1].t : 0;
    this.advance(time);
  }
}

/** Download a recording as a demonstration dataset file. */
export function downloadBenchDemonstration(rec: BenchRecording, def: CraftBench, title: string) {
  const dataset = {
    format: 'senecai-bench-demonstration/v2',
    description:
      'Human teleoperation demonstration of a craft, captured with Rokoko-format hand tracking and retargeted to two 6-DoF Inspire-style robot hands. ' +
      'frames[].hands[].dof = [thumbRotate, thumbBend, index, middle, ring, little] in 0 (open)..1 (closed); p/q = wrist pose in bench coordinates; tool = held tool id. ' +
      'frames[].ops = changes to the workpieces applied in that frame (see "tools" and "workpieces"); replaying them in order reproduces the object exactly, frame by frame.',
    title,
    tools: def.tools.map((t) => ({ id: t.id, name: t.name, use: t.use })),
    stations: def.stations.map((s) => ({ id: s.id, name: s.name, position: s.pos })),
    workpieces: def.workpieces().map((w) => ({ id: w.id, material: w.kind })),
    ...rec,
  };
  const blob = new Blob([JSON.stringify(dataset)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'demonstration'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
