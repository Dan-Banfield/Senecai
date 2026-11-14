// Runs a craft bench: turns hand commands into robot poses, tool pick-ups and
// workpiece ops, records everything, and replays recordings.
//
// The working hand aims like a laser pointer: its position picks a point in
// the camera view, and whatever is under that point (a tool, a station, the
// workpiece) is what it acts on. Squeezing (closing the hand) grabs tools and
// uses them. The other hand steadies and turns the workpiece, or, for pieces
// worked in the hand (a knife handle, a cup), picks it up with a fist and holds
// it: the piece then follows that hand in 3D, turning as the wrist turns.

import * as THREE from 'three';
import { create } from 'zustand';
import { primaryCommand, secondaryCommand, usePipeline } from '../input/pipeline';
import type { RobotPose } from '../robot/RobotHand';
import type { Dof6, RobotHandCommand } from '../robot/retarget';
import type { Side } from '../rokoko/types';
import { Bench, biteOf, r3, type Aim, type CraftBench, type InteractCtx, type Meter, type Op, type ToolDef } from './core';
import { carvingRotation, GRIP, HAND_SCALE, handRotation, tipForWrist, wristForHover, wristForSteady, wristForTool } from './pose';
import { BenchPlayer, BenchRecorder, sampleHand, type BenchRecording } from './recording';

export type BenchMode =
  | { kind: 'learn'; from?: { id: string; title: string; author: string; recording: BenchRecording } }
  | { kind: 'free' }
  | { kind: 'replay'; recording: BenchRecording };

export interface BenchUi {
  stage: number;
  stageProgress: number;
  phase: 'working' | 'finished' | 'replaying' | 'replayDone';
  feedback: { text: string; kind: 'warn' | 'good' | 'info'; at: number } | null;
  guide: boolean;
  view: string;
  held: string | null;
  carrying: string | null;
  hover: string | null;
  meters: Meter[];
  opCount: number;
  squeezing: boolean;
  /** How hard a held knife would bite (0 thin shaving .. 1 deep), or null with no knife. */
  bite: number | null;
  /** Workpiece held in the other hand. */
  holding: string | null;
  lastRecording: BenchRecording | null;
  score: number | null;
  replayTime: number;
  duration: number;
}

export const useBenchUi = create<BenchUi>(() => ({
  stage: 0,
  stageProgress: 0,
  phase: 'working',
  feedback: null,
  guide: true,
  view: 'main',
  held: null,
  carrying: null,
  hover: null,
  meters: [],
  opCount: 0,
  squeezing: false,
  bite: null,
  holding: null,
  lastRecording: null,
  score: null,
  replayTime: 0,
  duration: 0,
}));

const CARVING_TOOLS = new Set(['knife']);
/** Smallest yaw / roll change (radians) worth an op while turning. */
const TURN_STEP = 0.01;

export interface HandView {
  side: Side;
  pose?: RobotPose;
  tool: string | null;
}

export interface Particle {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
  color: THREE.Color;
  size: number;
  gravity: number;
}

const keys = new Set<string>();
const keyPresses: string[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (!keys.has(k)) keyPresses.push(k);
    keys.add(k);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
}

const UP = new THREE.Vector3(0, 1, 0);
const TABLE = new THREE.Plane(UP, 0);
const otherSide = (s: Side): Side => (s === 'right' ? 'left' : 'right');
/** Aim for when the working hand is out of view: nothing under it but the table. */
const tableAim = (): Aim => ({ point: new THREE.Vector3(), normal: UP.clone(), ray: new THREE.Ray(), hit: { type: 'table' }, station: null, tool: null });

export class BenchSession {
  bench: Bench;
  hands: Record<Side, HandView> = { left: { side: 'left', tool: null }, right: { side: 'right', tool: null } };
  ghosts: Record<Side, HandView> = { left: { side: 'left', tool: null }, right: { side: 'right', tool: null } };
  /** World position of each hand's tool tip (or fingertips), for carried workpieces and effects. */
  tips: Record<Side, THREE.Vector3> = { left: new THREE.Vector3(), right: new THREE.Vector3() };
  primary: Side = 'right';
  aim: Aim | null = null;
  readonly pickables = new Set<THREE.Object3D>();
  readonly mem: Record<string, unknown> = {};
  particles: Particle[] = [];
  replaySpeed = 1;
  player?: BenchPlayer;
  /** The 3D canvas, for snapshot thumbnails. */
  canvas: HTMLCanvasElement | null = null;

  private recorder: BenchRecorder;
  private pending: Op[] = [];
  private squeezing = false;
  /** False after the working hand changes sides, until the new hand opens: no squeeze carried over. */
  private squeezeArmed = true;
  private offClosed = false;
  /** A turn was applied recently and its remainder has not been flushed yet. */
  private turnPending = false;
  private lastOffX: number | null = null;
  /**
   * Turning not yet sent, per axis and workpiece. The yaw / roll only ever change
   * through ops (so live never shows an angle replay doesn't have); `acc` is where
   * the turn has got to, `sent` the value last emitted.
   */
  private turnAcc = new Map<string, { k: 'yaw' | 'roll'; wp: string; sent: number; acc: number }>();
  /** Off-hand pose when it picked the piece up: the piece follows the hand relative to this. */
  private holdAnchor: { p: THREE.Vector3; q: THREE.Quaternion } | null = null;
  private offLostAt: number | null = null;
  /** 0..1 blend of the working hand into its side-on carving pose. */
  private carveMix: Record<Side, number> = { left: 0, right: 0 };
  private smoothTip: Record<Side, THREE.Vector3 | null> = { left: null, right: null };
  private raycaster = new THREE.Raycaster();
  private uiTimer = 0;
  private stageTimer = 0;
  private ghostTime = 0;
  private hoverText: string | null = null;

  constructor(
    readonly def: CraftBench,
    readonly mode: BenchMode,
  ) {
    this.bench = new Bench(def);
    this.recorder = new BenchRecorder(def.id, usePipeline.getState().kind ?? 'none');
    if (mode.kind === 'replay') {
      this.player = new BenchPlayer(mode.recording, this.bench);
      this.replaySpeed = mode.recording.source === 'seed' ? 1 : 1.5;
    }
  }

  /** Reset the UI store for this session. Call from an effect, not during render. */
  activate() {
    const replay = this.mode.kind === 'replay';
    if (!replay && !this.recorder.active) this.recorder.start();
    useBenchUi.setState({
      stage: 0,
      stageProgress: 0,
      phase: replay ? 'replaying' : 'working',
      feedback: null,
      guide: this.mode.kind === 'learn',
      view: this.def.stages[0]?.view ?? 'main',
      held: null,
      carrying: null,
      hover: null,
      meters: this.def.meters?.(this.bench) ?? [],
      opCount: 0,
      squeezing: false,
      bite: null,
      holding: null,
      lastRecording: null,
      score: null,
      replayTime: 0,
      duration: replay ? (this.mode as { recording: BenchRecording }).recording.durationMs : 0,
    });
    keyPresses.length = 0;
  }

  dispose() {
    if (this.recorder.active) this.recorder.stop();
  }

  get stage() {
    return this.def.stages[this.bench.state.stage];
  }

  toolOf(side: Side): ToolDef | null {
    const id = this.hands[side].tool;
    return id ? (this.bench.tool(id) ?? null) : null;
  }

  /** Tools resting on the table (not in either hand). */
  isResting(toolId: string) {
    return this.hands.left.tool !== toolId && this.hands.right.tool !== toolId;
  }

  register(obj: THREE.Object3D, pick: { type: 'workpiece' | 'station'; id: string; part?: string }, frame?: THREE.Object3D) {
    obj.userData.pick = pick;
    if (frame) obj.userData.frame = frame;
    this.pickables.add(obj);
    return () => void this.pickables.delete(obj);
  }

  say(text: string, kind: 'warn' | 'good' | 'info' = 'info') {
    const f = useBenchUi.getState().feedback;
    if (f && f.text === text && performance.now() - f.at < 1500) return;
    useBenchUi.setState({ feedback: { text, kind, at: performance.now() } });
  }

  emit = (op: Op) => {
    this.bench.apply(op);
    this.pending.push(op);
    this.effectFor(op);
  };

  // ---------------------------------------------------------------- world frames

  /** World transform of a workpiece's outer frame. */
  wpTransform(id: string, pos: THREE.Vector3, quat: THREE.Quaternion): boolean {
    const s = this.bench.state;
    const place = s.place[id];
    if (!place) return false;
    const yaw = new THREE.Quaternion().setFromAxisAngle(UP, s.yaw[id] ?? 0);
    const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), s.roll[id] ?? 0);
    if (place.startsWith('carried:')) {
      const side = place.slice(8) as Side;
      pos.copy(this.tips[side]);
      quat.copy(yaw).multiply(roll);
      return true;
    }
    if (place.startsWith('held:')) {
      // In the fist: the piece turns with the hand, rolls about its own long axis
      // (Q / E), and yaw a half turn means the other end is in the hand.
      const side = place.slice(5) as Side;
      const pose = this.hands[side].pose;
      const hd = this.def.hold?.[id];
      if (!pose || !hd) return false;
      const flip = Math.cos(s.yaw[id] ?? 0) < 0;
      quat.copy(pose.rotation).multiply(roll);
      if (flip) quat.multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI));
      const g = new THREE.Vector3(...hd.grip);
      if (flip) g.set(-g.x, g.y, -g.z);
      const fist = GRIP.clone().multiplyScalar(HAND_SCALE).applyQuaternion(pose.rotation).add(pose.position);
      pos.copy(fist).sub(g.applyQuaternion(quat));
      return true;
    }
    if (place === 'attached') {
      const parent = s.attached[id];
      if (!this.wpTransform(parent, pos, quat)) return false;
      const a = this.def.attachPose?.(this.bench, id, parent) ?? { pos: [0, 0, 0] };
      pos.add(new THREE.Vector3(...a.pos).applyQuaternion(quat));
      quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(a.roll ?? 0, a.yaw ?? 0, 0, 'YXZ')));
      return true;
    }
    const st = this.bench.station(place);
    if (!st) return false;
    pos.set(st.pos[0], st.pos[1] + (st.rest ?? 0), st.pos[2]);
    quat.copy(yaw).multiply(roll);
    return true;
  }

  /** Which workpiece (if any) is set down at a station. */
  wpAt(station: string) {
    for (const [wp, p] of Object.entries(this.bench.state.place)) if (p === station) return wp;
    return null;
  }

  // ---------------------------------------------------------------- live input

  private computeAim(cmd: RobotHandCommand, camera: THREE.Camera): Aim {
    const ndc = new THREE.Vector2(THREE.MathUtils.clamp(cmd.position.x * 0.85, -0.97, 0.97), THREE.MathUtils.clamp(cmd.position.y * 0.85 - 0.05, -0.97, 0.97));
    this.raycaster.setFromCamera(ndc, camera);
    const ray = this.raycaster.ray.clone();
    let hit: Aim['hit'] = { type: 'table' };
    const point = new THREE.Vector3();
    const normal = UP.clone();
    let found = false;
    for (const h of this.raycaster.intersectObjects([...this.pickables], false)) {
      const pick = h.object.userData.pick as { type: 'workpiece' | 'station'; id: string; part?: string } | undefined;
      if (!pick || !h.object.visible) continue;
      // A workpiece in your tongs is not something you can point at.
      if (pick.type === 'workpiece' && this.bench.state.place[pick.id]?.startsWith('carried')) continue;
      point.copy(h.point);
      if (h.face) normal.copy(h.face.normal).transformDirection(h.object.matrixWorld);
      if (pick.type === 'workpiece') {
        const frame = (h.object.userData.frame as THREE.Object3D | undefined) ?? h.object.parent ?? h.object;
        const local = frame.worldToLocal(h.point.clone());
        const dir = frame.worldToLocal(h.point.clone().add(ray.direction)).sub(local).normalize();
        hit = { type: 'workpiece', id: pick.id, local, dir, part: pick.part };
      } else hit = { type: 'station', id: pick.id };
      found = true;
      break;
    }
    if (!found && !ray.intersectPlane(TABLE, point)) point.copy(ray.at(14, new THREE.Vector3()));
    let station: string | null = hit.type === 'station' ? hit.id : null;
    if (!station) {
      // Over a station if the aim ray passes near its upright axis (base up to its working
      // height), so small things like a candle or a paint pot are easy to point at.
      let best = Infinity;
      for (const st of this.def.stations) {
        const base = new THREE.Vector3(...st.pos);
        const top = base.clone().add(new THREE.Vector3(0, (st.rest ?? 0.6) + 0.35, 0));
        const d = Math.sqrt(ray.distanceSqToSegment(base, top));
        if (d < st.radius && d < best) {
          best = d;
          station = st.id;
        }
      }
    }
    let tool: string | null = null;
    let best = 0.5;
    for (const t of this.def.tools) {
      if (!this.isResting(t.id)) continue;
      const d = ray.distanceToPoint(new THREE.Vector3(t.home[0], t.home[1] + 0.12, t.home[2]));
      if (d < best) {
        best = d;
        tool = t.id;
      }
    }
    return { point, normal, ray, hit, station, tool };
  }

  private grab(toolId: string, side: Side) {
    const refuse = this.def.canGrab?.(this.bench, toolId);
    if (refuse) {
      this.say(refuse, 'warn');
      return;
    }
    this.hands[side].tool = toolId;
    this.smoothTip[side] = null;
  }

  private putBack(side: Side) {
    const carrying = this.bench.carriedBy(side);
    if (carrying) {
      this.say('Set it down on a station first.', 'warn');
      return;
    }
    this.hands[side].tool = null;
    this.smoothTip[side] = null;
  }

  /** Built-in squeeze behaviour: tools and carrying. Returns true if it handled the squeeze. */
  private genericPress(ctx: InteractCtx): boolean {
    const { aim, tool, side } = ctx;
    if (!tool) {
      if (aim.tool && aim.hit.type !== 'workpiece') {
        this.grab(aim.tool, side);
        return true;
      }
      return false;
    }
    const carrying = this.bench.carriedBy(side);
    if (carrying) {
      const st = aim.station ? this.bench.station(aim.station) : null;
      if (st && st.rest !== undefined && !this.wpAt(st.id)) {
        this.emit({ w: '$', k: 'place', wp: carrying, at: st.id });
        return true;
      }
      return false;
    }
    if (tool.carries?.length) {
      const wp = aim.hit.type === 'workpiece' ? aim.hit.id : aim.station ? this.wpAt(aim.station) : null;
      if (wp && tool.carries.includes(wp) && this.bench.placedAt(wp)) {
        this.emit({ w: '$', k: 'place', wp, at: `carried:${side}` });
        return true;
      }
    }
    if (aim.tool && aim.tool !== tool.id && aim.hit.type !== 'workpiece') {
      this.putBack(side);
      this.grab(aim.tool, side);
      return true;
    }
    if (aim.ray.distanceToPoint(new THREE.Vector3(...tool.home)) < 0.45) {
      this.putBack(side);
      return true;
    }
    return false;
  }

  private turn(ctx: InteractCtx, delta: number) {
    const held = this.bench.heldBy(otherSide(this.primary));
    if (held) return this.rollHeld(held, delta);
    if (this.def.turn) return this.def.turn(ctx, delta);
    const wp = this.def.turnTarget?.(this.bench) ?? [...this.bench.workpieces.keys()][0];
    if (!wp) return;
    this.turnAxis('yaw', wp, delta);
  }

  /** Roll a held piece about its long axis, as if turning it in the fingers. */
  private rollHeld(wp: string, delta: number) {
    this.turnAxis('roll', wp, delta);
  }

  /**
   * Turn a workpiece's yaw or roll by `delta`, only ever through ops: small turns
   * build up until the rounded angle has moved by more than TURN_STEP, and a turn
   * of 0 (sent when turning stops) flushes whatever is left.
   */
  private turnAxis(k: 'yaw' | 'roll', wp: string, delta: number) {
    const cur = this.bench.state[k][wp] ?? 0;
    const key = `${k}:${wp}`;
    let m = this.turnAcc.get(key);
    // Re-sync if another op set the angle since (V swaps ends, setting the piece down).
    if (!m || m.sent !== cur) this.turnAcc.set(key, (m = { k, wp, sent: cur, acc: cur }));
    m.acc += delta;
    const v = r3(m.acc);
    if (v !== cur && (delta === 0 || Math.abs(v - cur) > TURN_STEP)) {
      m.sent = v;
      this.emit({ w: '$', k, wp, v });
    }
  }

  /**
   * Turning stopped: send what is left of it, so the recorded ops end on the
   * exact angle the turn reached and replay doesn't drift from the cuts.
   */
  private settleTurn(ctx: InteractCtx) {
    for (const m of [...this.turnAcc.values()]) this.turnAxis(m.k, m.wp, 0);
    // A craft's own turn flushes its remainder on a turn of 0.
    this.def.turn?.(ctx, 0);
  }

  /** Flush a turn still in progress (live sessions only; replay never emits). */
  private flushTurn() {
    if (this.mode.kind === 'replay' || !this.turnPending) return;
    this.turnPending = false;
    const offSide = otherSide(this.primary);
    this.settleTurn(this.ctx(offSide, this.aim ?? tableAim(), secondaryCommand(), 0));
  }

  /** The working hand moved to the other side: carry the tool across and forget the old hand's state. */
  private switchPrimary(side: Side) {
    this.hands[side].tool = this.hands[this.primary].tool;
    this.hands[this.primary].tool = null;
    this.primary = side;
    // The new working hand's grip must open before it counts as a squeeze (no phantom press),
    // and the new off hand's fist must open before it picks anything up.
    this.squeezing = false;
    this.squeezeArmed = false;
    this.offClosed = true;
    this.lastOffX = null;
    this.offLostAt = null;
    this.holdAnchor = null;
    this.smoothTip = { left: null, right: null };
    this.carveMix = { left: 0, right: 0 };
  }

  /** A held-able piece the off hand could pick up now, if any. */
  private holdCandidate(): string | null {
    for (const wp of Object.keys(this.def.hold ?? {})) {
      if (!this.bench.placedAt(wp)) continue;
      if (this.def.canHold && !this.def.canHold(this.bench, wp)) continue;
      return wp;
    }
    return null;
  }

  private holdView(wp: string) {
    const v = this.def.hold?.[wp]?.view;
    const name = typeof v === 'function' ? v(this.bench) : v;
    return name && this.def.views[name] ? name : null;
  }

  private startHold(wp: string, side: Side, off: RobotHandCommand) {
    this.holdAnchor = { p: off.position.clone(), q: off.rotation.clone() };
    this.emit({ w: '$', k: 'place', wp, at: `held:${side}` });
    this.say('Got it. Move and turn your hand to bring the wood to the knife. Q / E roll it, V swaps ends, open your hand to set it down.', 'info');
  }

  private endHold(wp: string) {
    const hd = this.def.hold![wp];
    if (this.bench.state.roll[wp]) this.emit({ w: '$', k: 'roll', wp, v: 0 });
    this.emit({ w: '$', k: 'place', wp, at: hd.home });
    this.holdAnchor = null;
    this.offLostAt = null;
    useBenchUi.setState({ view: this.stage?.view ?? 'main' });
  }

  /** Where the off hand is while holding: relative to where it was when it picked the piece up. */
  private holdPose(wp: string, side: Side, off: RobotHandCommand): RobotPose {
    const hd = this.def.hold![wp];
    const a = (this.holdAnchor ??= { p: off.position.clone(), q: off.rotation.clone() });
    const d = off.position.clone().sub(a.p);
    const c = THREE.MathUtils.clamp;
    const fist = new THREE.Vector3(...hd.at).add(new THREE.Vector3(c(d.x * 0.55, -1.1, 1.1), c(d.y * 0.5, -0.8, 1.0), c(d.z * 0.45, -0.8, 0.8)));
    const rotation = off.rotation.clone().multiply(a.q.clone().invert()).multiply(handRotation(side));
    const position = fist.sub(GRIP.clone().multiplyScalar(HAND_SCALE).applyQuaternion(rotation));
    const dof = off.dof.map((v, i) => (i < 2 ? Math.max(0.55, v) : Math.max(0.82, v))) as Dof6;
    return { dof, position, rotation };
  }

  private ctx(side: Side, aim: Aim, cmd: RobotHandCommand | undefined, dt: number, pressed = false, released = false): InteractCtx {
    return {
      b: this.bench,
      side,
      tool: this.toolOf(side),
      aim,
      grip: cmd?.grip ?? 0,
      squeeze: this.squeezing,
      pressed,
      released,
      dt,
      mem: this.mem,
      free: this.mode.kind === 'free',
      emit: this.emit,
      say: (t, k) => this.say(t, k),
      frame: (wp) => {
        const pos = new THREE.Vector3();
        const q = new THREE.Quaternion();
        this.wpTransform(wp, pos, q);
        return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
      },
    };
  }

  tick(dtMs: number, camera: THREE.Camera) {
    const dt = Math.min(0.1, dtMs / 1000);
    this.updateParticles(dt);
    if (this.mode.kind === 'replay') return this.tickReplay(dtMs);
    const ui = useBenchUi.getState();
    if (ui.phase !== 'working') return;

    if (this.mode.kind === 'learn' && this.mode.from) {
      const rec = this.mode.from.recording;
      this.ghostTime = (this.ghostTime + dtMs) % Math.max(1, rec.durationMs);
      for (const side of ['left', 'right'] as Side[]) {
        const h = sampleHand(rec, this.ghostTime, side);
        this.ghosts[side] = { side, pose: h?.pose, tool: h?.tool ?? null };
      }
    }

    let cmd = primaryCommand();
    let off = secondaryCommand();
    if (cmd && cmd.side !== this.primary) {
      if (this.bench.carriedBy(this.primary) || this.bench.heldBy(otherSide(this.primary))) {
        // Something is in the tongs or in the other fist: keep each hand's role rather than
        // swap mid-task. The working hand counts as missing; a hand on the other side is the off hand.
        [cmd, off] = [off, cmd];
      } else this.switchPrimary(cmd.side);
    }

    if (cmd) {
      const side = cmd.side;
      const aim = this.computeAim(cmd, camera);
      this.aim = aim;
      const was = this.squeezing;
      if (cmd.grip <= 0.5) this.squeezeArmed = true;
      this.squeezing = this.squeezeArmed && (was ? cmd.grip > 0.5 : cmd.grip > 0.7);
      const pressed = this.squeezing && !was;
      const released = !this.squeezing && was;
      const ctx = this.ctx(side, aim, cmd, dt, pressed, released);
      let handled = pressed && this.genericPress(ctx);
      for (const k of keyPresses.splice(0)) {
        const heldWp = this.bench.heldBy(otherSide(side));
        if (k === 'x') {
          this.putBack(side);
          handled = true;
        } else if (k === 'v' && heldWp) {
          // Swap ends: carve the other half of the piece.
          this.emit({ w: '$', k: 'yaw', wp: heldWp, v: r3((this.bench.state.yaw[heldWp] ?? 0) + Math.PI) });
          this.say('Swapped ends.', 'info');
        } else this.def.onKey?.(this.ctx(side, aim, cmd, dt), k);
      }
      if (!handled) this.def.interact(this.ctx(side, aim, cmd, dt, pressed, released));
      this.hands[side].pose = this.posePrimary(side, cmd, aim, dt);
      this.hoverText = this.describe(aim, side);
    } else {
      this.hands[this.primary].pose = undefined;
      this.aim = null;
      this.squeezing = false;
      this.hoverText = null;
      keyPresses.length = 0;
    }
    // Heating and cooling run on whether or not a hand is in view.
    this.def.simulate?.(this.ctx(this.primary, this.aim ?? tableAim(), cmd, dt));

    // The other hand: hold the work in the fist, or steady and turn it.
    const offSide = otherSide(this.primary);
    const turnCtx = this.aim ? this.ctx(offSide, this.aim, off, dt) : null;
    let turned = false;
    if (turnCtx) {
      if (keys.has('q')) this.turn(turnCtx, -1.6 * dt);
      if (keys.has('e')) this.turn(turnCtx, 1.6 * dt);
      turned = keys.has('q') || keys.has('e');
    }
    let held = this.bench.heldBy(offSide);
    if (off) {
      this.offLostAt = null;
      const closed = this.offClosed ? off.grip > 0.45 : off.grip > 0.62;
      const candidate = !held && closed && !this.offClosed ? this.holdCandidate() : null;
      if (candidate) {
        this.startHold(candidate, offSide, off);
        held = candidate;
      }
      if (held) {
        // Let go by opening the hand.
        if (off.grip < 0.3) {
          this.endHold(held);
          held = null;
        } else this.hands[offSide].pose = this.holdPose(held, offSide, off);
      }
      if (!held) {
        if (closed && turnCtx) {
          if (this.lastOffX !== null) {
            this.turn(turnCtx, (off.position.x - this.lastOffX) * 2.2);
            turned = true;
          }
          this.lastOffX = off.position.x;
        } else this.lastOffX = null;
        const wp = this.def.turnTarget?.(this.bench) ?? [...this.bench.workpieces.keys()][0];
        const target = new THREE.Vector3();
        if (!wp || !this.wpTransform(wp, target, new THREE.Quaternion())) target.set(0, 0.8, 0);
        const w = wristForSteady(target.add(new THREE.Vector3(0, 0.6, 0)), offSide, new THREE.Vector3(off.position.x * 0.3, off.position.y * 0.25, 0));
        this.hands[offSide].pose = { dof: off.dof, position: w.position, rotation: w.rotation };
      }
      this.offClosed = closed;
    } else if (held) {
      // Hand lost from view: keep holding for a moment, then set the piece down.
      this.offLostAt ??= performance.now();
      if (performance.now() - this.offLostAt > 700) {
        this.endHold(held);
        held = null;
        this.hands[offSide].pose = undefined;
      }
    } else {
      this.hands[offSide].pose = undefined;
      this.lastOffX = null;
    }
    if (turned) this.turnPending = true;
    else if (this.turnPending) {
      this.turnPending = false;
      this.settleTurn(this.ctx(offSide, this.aim ?? tableAim(), off, dt));
    }
    // Close in on the hands while holding something.
    const hv = held ? this.holdView(held) : null;
    if (hv && ui.view !== hv) useBenchUi.setState({ view: hv });

    // Stage progress.
    this.stageTimer -= dtMs;
    if (this.stageTimer <= 0) {
      this.stageTimer = 150;
      const st = this.stage;
      const p = st ? st.progress(this.bench) : 0;
      if (st && p >= (st.doneAt ?? 1) && this.bench.state.stage < this.def.stages.length - 1) this.advanceStage();
      else if (Math.abs(p - ui.stageProgress) > 0.005) useBenchUi.setState({ stageProgress: p });
    }

    this.recorder.frame(this.handsNow(), this.pending);
    this.pending = [];

    this.uiTimer -= dtMs;
    if (this.uiTimer <= 0) {
      this.uiTimer = 120;
      const tool = this.toolOf(this.primary);
      const carrying = this.bench.carriedBy(this.primary);
      useBenchUi.setState({
        held: tool?.name ?? null,
        carrying,
        hover: this.hoverText,
        meters: this.def.meters?.(this.bench) ?? [],
        opCount: this.recorder.opCount,
        squeezing: this.squeezing,
        bite: tool && cmd && CARVING_TOOLS.has(tool.model) ? biteOf(cmd.grip) : null,
        holding: held,
      });
    }
  }

  private handsNow() {
    return (['left', 'right'] as Side[]).flatMap((s) => (this.hands[s].pose ? [{ side: s, pose: this.hands[s].pose!, tool: this.hands[s].tool }] : []));
  }

  private posePrimary(side: Side, cmd: RobotHandCommand, aim: Aim, dt: number): RobotPose {
    const tool = this.toolOf(side);
    const extra = new THREE.Quaternion().slerp(cmd.rotation, 0.2);
    const k = 1 - Math.exp(-dt * 22);
    if (tool) {
      const onWork = aim.hit.type !== 'table';
      // Working on a piece held in the other hand: the blade rides just off the surface,
      // and the hand swings round to come in from its own side so it doesn't cover the work.
      const onHeld = aim.hit.type === 'workpiece' && this.bench.isHeld(aim.hit.id);
      this.carveMix[side] += ((onHeld ? 1 : 0) - this.carveMix[side]) * (1 - Math.exp(-dt * 8));
      const target = onHeld
        ? aim.point.clone().addScaledVector(aim.normal, this.squeezing ? 0.004 : 0.07)
        : aim.point.clone().addScaledVector(UP, this.squeezing && onWork ? 0.02 : Math.max(0.15, tool.lift ?? 0.28));
      const tip = (this.smoothTip[side] ??= target.clone()).lerp(target, k);
      this.tips[side].copy(tip);
      let ex = extra;
      if (this.carveMix[side] > 0.001) {
        // Blend from the usual pose to the carving pose, keeping a little of the hand's own twist.
        const base = handRotation(side, extra);
        const carve = carvingRotation(side, tool).multiply(new THREE.Quaternion().slerp(cmd.rotation, 0.12));
        const blend = base.clone().slerp(carve, this.carveMix[side]);
        ex = blend.multiply(handRotation(side).invert());
      }
      const w = wristForTool(tip, side, tool, ex);
      const hold = cmd.dof.map((v, i) => (i < 2 ? Math.max(0.5, v) : 0.62 + 0.38 * v)) as Dof6;
      return { dof: hold, position: w.position, rotation: w.rotation };
    }
    const target = aim.point.clone();
    const tip = (this.smoothTip[side] ??= target.clone()).lerp(target, k);
    this.tips[side].copy(tip);
    const w = wristForHover(tip, side, this.squeezing ? 1 : 0, extra);
    return { dof: cmd.dof, position: w.position, rotation: w.rotation };
  }

  private describe(aim: Aim, side: Side): string | null {
    const held = this.toolOf(side);
    const custom = this.def.describe?.(this.bench, aim);
    const inHand = this.bench.heldBy(otherSide(side));
    if (inHand && aim.hit.type === 'workpiece' && aim.hit.id === inHand) {
      if (!held) return 'In your other hand · Q / E roll it · V swap ends · open that hand to set it down';
      if (CARVING_TOOLS.has(held.model)) return custom ?? 'Squeeze and draw the knife across the wood: a light grip skims, a full fist bites deep';
    }
    if (aim.tool && aim.hit.type !== 'workpiece') {
      const t = this.bench.tool(aim.tool)!;
      return held ? `${t.name}: squeeze to swap` : `${t.name}: squeeze to pick up`;
    }
    if (held && !this.bench.carriedBy(side) && aim.ray.distanceToPoint(new THREE.Vector3(...held.home)) < 0.45) return `Squeeze to put the ${held.name.toLowerCase()} back`;
    if (custom) return custom;
    if (aim.station) {
      const st = this.bench.station(aim.station)!;
      return st.hint ? `${st.name}: ${st.hint}` : st.name;
    }
    return held ? held.use : null;
  }

  advanceStage() {
    const i = this.bench.state.stage;
    if (i >= this.def.stages.length - 1) return;
    const done = this.def.stages[i];
    this.emit({ w: '$', k: 'stage', i: i + 1 });
    const next = this.def.stages[i + 1];
    useBenchUi.setState({ stage: i + 1, stageProgress: 0, view: next.view ?? useBenchUi.getState().view });
    this.say(`Done: ${done.title}`, 'good');
  }

  finish() {
    // Finishing mid-turn: record the rest of the turn so replay ends on the same angle.
    this.flushTurn();
    if (this.pending.length) {
      this.recorder.frame(this.handsNow(), this.pending);
      this.pending = [];
    }
    const rec = this.recorder.stop();
    // The input may have started after this session did; record what was actually used.
    rec.source = usePipeline.getState().kind ?? rec.source;
    useBenchUi.setState({ phase: 'finished', lastRecording: rec, score: Math.round(this.def.score(this.bench) * 100), meters: this.def.meters?.(this.bench) ?? [] });
  }

  // ---------------------------------------------------------------- replay

  private tickReplay(dtMs: number) {
    const player = this.player;
    if (!player || useBenchUi.getState().phase !== 'replaying') return;
    const t = player.time + dtMs * this.replaySpeed;
    for (const op of player.advance(t)) this.effectFor(op);
    this.syncReplayHands(t);
    const st = this.bench.state.stage;
    if (st !== useBenchUi.getState().stage) useBenchUi.setState({ stage: st });
    this.uiTimer -= dtMs;
    if (this.uiTimer <= 0) {
      this.uiTimer = 100;
      useBenchUi.setState({ replayTime: t, meters: this.def.meters?.(this.bench) ?? [] });
    }
    if (t > player.rec.durationMs + 300) useBenchUi.setState({ phase: 'replayDone', replayTime: player.rec.durationMs });
  }

  private syncReplayHands(t: number) {
    const rec = this.player!.rec;
    for (const side of ['left', 'right'] as Side[]) {
      const h = sampleHand(rec, t, side);
      this.hands[side] = { side, pose: h?.pose, tool: h?.tool ?? null };
      const tool = h?.tool ? this.bench.tool(h.tool) : null;
      if (h && tool) this.tips[side].copy(tipForWrist(h.pose.position, h.pose.rotation, side, tool));
      else if (h) this.tips[side].copy(h.pose.position).add(new THREE.Vector3(0, -0.45, -0.5));
    }
  }

  seek(t: number) {
    if (!this.player) return;
    this.player.seek(t);
    this.particles = [];
    this.syncReplayHands(t);
    useBenchUi.setState({ replayTime: t, stage: this.bench.state.stage, phase: 'replaying', meters: this.def.meters?.(this.bench) ?? [] });
  }

  restartReplay() {
    this.seek(0);
  }

  // ---------------------------------------------------------------- effects

  /** Little bits of life: wood shavings, sparks, steam. */
  private effectFor(op: Op) {
    const toolSide = this.hands[this.primary].tool ? this.primary : this.hands[otherSide(this.primary)].tool ? otherSide(this.primary) : this.primary;
    const at = this.tips[toolSide];
    const spawn = (n: number, color: string, speed: number, gravity: number, size: number, life = 1) => {
      for (let i = 0; i < n; i++)
        this.particles.push({
          p: at.clone(),
          v: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.9 + speed * 0.3, (Math.random() - 0.3) * speed),
          life: life * (0.6 + Math.random() * 0.6),
          max: life,
          color: new THREE.Color(color),
          size,
          gravity,
        });
    };
    if (op.k === 'carve') spawn(Math.min(8, 2 + ((op.cells as number[]).length >> 2)), '#e7cf9f', 2.4, 9, 0.06);
    else if (op.k === 'shave') spawn(Math.random() < 0.5 ? 1 : 2, Math.random() < 0.5 ? '#f1e2bd' : '#e2c995', 1.2, 7, 0.022 + (op.r as number) * 0.004, 1.2);
    else if (op.k === 'strike') spawn(10, '#ffb347', 4.5, 6, 0.035, 0.6);
    else if (op.k === 'quench') spawn(16, '#d8dde0', 1.4, -1.2, 0.18, 1.6);
    else if (op.k === 'grind') spawn(3, '#fff2c4', 2.2, 5, 0.025, 0.4);
    if (this.particles.length > 220) this.particles.splice(0, this.particles.length - 220);
  }

  private updateParticles(dt: number) {
    for (const p of this.particles) {
      p.v.y -= p.gravity * dt;
      p.p.addScaledVector(p.v, dt);
      p.life -= dt;
      if (p.p.y < 0.02 && p.gravity > 0) {
        p.p.y = 0.02;
        p.v.multiplyScalar(0.3);
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }
}
