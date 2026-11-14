// The craft workbench: a table with tools, stations and workpieces.
//
// Everything that changes the bench is an Op: a small JSON object applied the
// same way live and in replay. A recording is the robot's hand poses plus the
// ops applied in each frame, so replaying it rebuilds the workpiece mesh frame
// by frame, exactly as it was made.

import type { Side } from '../rokoko/types';

export type V3 = [number, number, number];

export type BenchCraftId = 'puukko';

/** One change to the bench. `w` is the workpiece id, or '$' for the bench itself. */
export interface Op {
  w: string;
  k: string;
  [field: string]: unknown;
}

export type MaterialKind = 'voxel' | 'forge';

/** A physical object being worked. Its whole state must be reproducible from ops. */
export interface Workpiece {
  readonly id: string;
  readonly kind: MaterialKind;
  /** Bumped on every change so renderers know to rebuild the mesh. */
  version: number;
  apply(op: Op): void;
  snapshot(): unknown;
  restore(s: unknown): void;
}

export type ToolModel = 'knife' | 'hammer' | 'tongs' | 'whetstone';

export interface ToolDef {
  id: string;
  name: string;
  model: ToolModel;
  /** Resting spot on the table (world). */
  home: V3;
  homeYaw?: number;
  /** Grip to working tip, in hand units (the robot hand is about 1.8 long). */
  len: number;
  /** Tilt of the tool in the fist, radians. 0 = straight down. */
  pitch?: number;
  /** How far the tip lifts off the work when you're not squeezing. */
  lift?: number;
  /** Workpieces this tool can pick up and carry between stations. */
  carries?: string[];
  /** What squeezing does with it, shown while held. */
  use: string;
  color?: string;
}

export type StationModel = 'forge' | 'anvil' | 'bucket' | 'block';

export interface StationDef {
  id: string;
  name: string;
  model: StationModel;
  pos: V3;
  /** Horizontal radius for "is the hand over this station". */
  radius: number;
  /** Workpieces can be set down here, resting at this height. */
  rest?: number;
  color?: string;
  hint?: string;
}

/** A workpiece the off hand can pick up and hold, to work on it in the hand. */
export interface HoldDef {
  /** Point of the piece (in its local frame) that sits in the fist. */
  grip: V3;
  /** Where the fist holds it in the world, with the hand at rest. */
  at: V3;
  /** Station it goes back to when you let go. */
  home: string;
  /** Close-up camera view while holding it. */
  view?: string | ((b: Bench) => string);
}

export interface BenchStateData {
  /** Workpiece id -> station id, 'carried:<side>', 'held:<side>' or 'attached'. */
  place: Record<string, string>;
  /** Workpiece rotation about the vertical axis. */
  yaw: Record<string, number>;
  /** Workpiece rotation about its long axis (bar on edge, egg tilt). */
  roll: Record<string, number>;
  /** Workpiece -> the workpiece it has been fitted into. */
  attached: Record<string, string>;
  stage: number;
  /** Per-tool state. */
  tool: Record<string, Record<string, number | number[]>>;
  /** Craft counters. */
  flags: Record<string, number>;
}

export interface BenchSnapshot {
  state: BenchStateData;
  wps: [string, unknown][];
}

export interface StageDef {
  id: string;
  title: string;
  text: string;
  view?: string;
  /** Tools and stations to highlight during this stage. */
  tools?: string[];
  stations?: string[];
  /** 0..1. The stage completes when it reaches `doneAt` (default 1). */
  progress(b: Bench): number;
  doneAt?: number;
}

export interface Meter {
  label: string;
  value: number;
  warn?: boolean;
}

export interface CameraView {
  pos: V3;
  look: V3;
}

/** The hand's aim: what is under it, and where. */
export interface Aim {
  /** World point under the hand (on whatever was hit, or the table). */
  point: import('three').Vector3;
  normal: import('three').Vector3;
  ray: import('three').Ray;
  hit:
    | { type: 'workpiece'; id: string; local: import('three').Vector3; dir: import('three').Vector3; part?: string }
    | { type: 'station'; id: string }
    | { type: 'table' };
  /** Station whose footprint the aim point is over, if any. */
  station: string | null;
  /** Resting tool the hand is close to, if any. */
  tool: string | null;
}

export interface InteractCtx {
  b: Bench;
  side: Side;
  tool: ToolDef | null;
  aim: Aim;
  grip: number;
  /** Squeezing now (grip closed, with hysteresis). */
  squeeze: boolean;
  /** Squeeze started / ended this frame. */
  pressed: boolean;
  released: boolean;
  dt: number;
  /** Free mode: no lesson, no guide; crafts shouldn't insist on a sequence. */
  free: boolean;
  /** Interaction memory that survives between frames (stroke start points etc). */
  mem: Record<string, unknown>;
  emit(op: Op): void;
  say(text: string, kind?: 'warn' | 'good' | 'info'): void;
  /** World matrix of a workpiece's frame (where it sits right now). */
  frame(wp: string): import('three').Matrix4;
}

export interface CraftBench {
  id: BenchCraftId;
  title: string;
  subtitle: string;
  intro: string;
  views: Record<string, CameraView>;
  tools: ToolDef[];
  stations: StationDef[];
  workpieces(): Workpiece[];
  start: { place: Record<string, string>; yaw?: Record<string, number>; roll?: Record<string, number>; tool?: Record<string, Record<string, number | number[]>> };
  stages: StageDef[];
  /** The off hand turns this workpiece (or calls `turn`). */
  turnTarget?: (b: Bench) => string | null;
  turn?: (ctx: InteractCtx, delta: number) => void;
  /** Workpieces the off hand can pick up with a fist and hold while the working hand works on them. */
  hold?: Record<string, HoldDef>;
  /** May the off hand pick this up right now? (Its fist may mean something else, like turning the bar.) */
  canHold?: (b: Bench, wp: string) => boolean;
  /** Can this tool be picked up right now? Return a reason to refuse. */
  canGrab?: (b: Bench, toolId: string) => string | null;
  /** Craft rules for the working hand, after generic tool handling. */
  interact(ctx: InteractCtx): void;
  /** Keyboard shortcuts beyond the built-in ones (Q/E turn, X put the tool back). */
  onKey?(ctx: InteractCtx, key: string): void;
  /** Where a fitted workpiece sits in its parent's frame (blade in handle). */
  attachPose?(b: Bench, wp: string, parent: string): { pos: V3; yaw?: number; roll?: number };
  /** Time-based physics (heating, cooling); live only, emits absolute-value ops. */
  simulate?(ctx: InteractCtx): void;
  meters?(b: Bench): Meter[];
  score(b: Bench): number;
  /** Has a guide overlay that can be toggled. */
  guide?: boolean;
  /** Short label for what the hand is over, for the hover readout. */
  describe?(b: Bench, aim: Aim): string | null;
}

/** Live state of one craft bench: its workpieces plus where everything is. */
export class Bench {
  readonly workpieces = new Map<string, Workpiece>();
  state!: BenchStateData;
  version = 0;

  constructor(readonly def: CraftBench) {
    this.reset();
  }

  reset() {
    this.workpieces.clear();
    for (const w of this.def.workpieces()) this.workpieces.set(w.id, w);
    const s = this.def.start;
    this.state = {
      place: { ...s.place },
      yaw: { ...(s.yaw ?? {}) },
      roll: { ...(s.roll ?? {}) },
      attached: {},
      stage: 0,
      tool: structuredClone(s.tool ?? {}),
      flags: {},
    };
    this.version++;
  }

  wp<T extends Workpiece>(id: string): T {
    const w = this.workpieces.get(id);
    if (!w) throw new Error(`no workpiece ${id}`);
    return w as T;
  }

  station(id: string) {
    return this.def.stations.find((s) => s.id === id);
  }

  tool(id: string) {
    return this.def.tools.find((t) => t.id === id);
  }

  /** Where a workpiece is, if it is set down at a station. */
  placedAt(wp: string): string | null {
    const p = this.state.place[wp];
    return p && !p.startsWith('carried') && !p.startsWith('held') && p !== 'attached' ? p : null;
  }

  carriedBy(side: Side): string | null {
    for (const [wp, p] of Object.entries(this.state.place)) if (p === `carried:${side}`) return wp;
    return null;
  }

  /** The workpiece held in this hand, if any. */
  heldBy(side: Side): string | null {
    for (const [wp, p] of Object.entries(this.state.place)) if (p === `held:${side}`) return wp;
    return null;
  }

  isHeld(wp: string) {
    return !!this.state.place[wp]?.startsWith('held');
  }

  flag(f: string) {
    return this.state.flags[f] ?? 0;
  }

  apply(op: Op) {
    this.version++;
    if (op.w !== '$') {
      this.workpieces.get(op.w)?.apply(op);
      return;
    }
    const s = this.state;
    switch (op.k) {
      case 'place':
        s.place[op.wp as string] = op.at as string;
        break;
      case 'yaw':
        s.yaw[op.wp as string] = op.v as number;
        break;
      case 'roll':
        s.roll[op.wp as string] = op.v as number;
        break;
      case 'attach':
        s.attached[op.wp as string] = op.to as string;
        s.place[op.wp as string] = 'attached';
        break;
      case 'stage':
        s.stage = op.i as number;
        break;
      case 'tool':
        s.tool[op.t as string] = { ...s.tool[op.t as string], ...(op.s as Record<string, number | number[]>) };
        break;
      case 'flag':
        s.flags[op.f as string] = op.v as number;
        break;
    }
  }

  snapshot(): BenchSnapshot {
    return { state: structuredClone(this.state), wps: [...this.workpieces].map(([id, w]) => [id, w.snapshot()]) };
  }

  restore(snap: BenchSnapshot) {
    this.state = structuredClone(snap.state);
    for (const [id, s] of snap.wps) this.workpieces.get(id)?.restore(s);
    this.version++;
  }
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** How deep a knife bites for a grip strength: 0 = a thin shaving (just squeezing), 1 = a full fist. */
export const biteOf = (grip: number) => clamp01((grip - 0.6) / 0.38);
