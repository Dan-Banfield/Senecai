// Kuksa carving logic. The robot hand holds a puukko (Finnish knife). How hard
// the human grips sets how hard the robot presses: a light grip shaves, a full
// fist takes big chips. The other hand turns the workpiece.

import * as THREE from 'three';
import { create } from 'zustand';
import { primaryCommand, secondaryCommand, usePipeline } from '../../input/pipeline';
import { eventsBetween, Recorder, samplePose, type Recording } from '../../recording/recording';
import type { RobotPose } from '../../robot/RobotHand';
import type { Dof6 } from '../../robot/retarget';
import type { Side } from '../../rokoko/types';
import { scrape, unlockAudio } from '../kantele/audio';
import { analyseTarget, carveSphere, cellToLocal, coords, localToVoxel, makeTarget, measureProgress, raycast, VoxelGrid, VOXEL, type Analysis, type Progress } from './voxels';

export type KuksaMode =
  | { kind: 'free' }
  | { kind: 'lesson'; target?: VoxelGrid; fromCreation?: { id: string; title: string; author: string; recording: Recording } }
  | { kind: 'replay'; recording: Recording };

export type StepId = 'grip' | 'turn' | 'outside' | 'hollow' | 'finish';
export const STEPS: { id: StepId; title: string; text: string; view: 'side' | 'top' }[] = [
  { id: 'grip', title: 'Hold the puukko', text: 'The robot hand is holding a puukko. Close your hand to press the blade into the wood, and open it to lift. A light grip shaves; a full fist takes big chips.', view: 'side' },
  { id: 'turn', title: 'Turn the workpiece', text: 'Make a fist with your other hand and move it sideways to turn the burl, as if holding it in your lap. Q / E also work.', view: 'side' },
  { id: 'outside', title: 'Rough out the outside', text: 'Carve away the darker, marked wood around the cup. Turn the block to reach every side. Careful near the pale wood: that is the kuksa.', view: 'side' },
  { id: 'hollow', title: 'Hollow the bowl', text: 'Looking from above now. Carve out the marked wood in the middle to make the bowl. Work in light passes.', view: 'top' },
  { id: 'finish', title: 'Refine and finish', text: 'Clean up any marked wood that is left, then press Finish to see your score and share your kuksa.', view: 'side' },
];

interface KuksaUi {
  step: number;
  progress: Progress | null;
  phase: 'carving' | 'finished' | 'replaying' | 'replayDone';
  feedback: { text: string; kind: 'warn' | 'good' | 'info'; at: number } | null;
  view: 'side' | 'top';
  guide: boolean;
  cutCount: number;
  engaged: boolean;
  lastRecording: Recording | null;
}

export const useKuksaUi = create<KuksaUi>(() => ({
  step: 0,
  progress: null,
  phase: 'carving',
  feedback: null,
  view: 'side',
  guide: true,
  cutCount: 0,
  engaged: false,
  lastRecording: null,
}));

/** Knife tip in the robot palm frame (right hand), at hand scale 1. */
export const KNIFE_TIP = new THREE.Vector3(-1.3, -0.33, -0.6);
export const HAND_SCALE = 0.8;

export function baseHandRotation(side: Side) {
  // Palm down, knife pointing into the screen and slightly down.
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), side === 'right' ? -Math.PI / 2 : Math.PI / 2);
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.45);
  return tilt.multiply(yaw);
}

/** Robot wrist pose that puts the knife tip at `tip` (world). */
export function wristForTip(tip: THREE.Vector3, side: Side, extra = new THREE.Quaternion()): { position: THREE.Vector3; rotation: THREE.Quaternion } {
  const rotation = extra.clone().multiply(baseHandRotation(side));
  const local = KNIFE_TIP.clone().multiplyScalar(HAND_SCALE);
  if (side === 'left') local.x *= -1;
  return { position: tip.clone().sub(local.applyQuaternion(rotation)), rotation };
}

export interface Chip {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
}

const keys = new Set<string>();
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
}

export class KuksaSession {
  grid = new VoxelGrid();
  target: VoxelGrid | null;
  analysis: Analysis | null;
  yaw = 0.35;
  livePose?: RobotPose;
  ghostPose?: RobotPose;
  side: Side = 'right';
  tip = new THREE.Vector3();
  tipOnWood = false;
  chips: Chip[] = [];
  replayTime = 0;
  replaySpeed = 1;
  /** Ghost-hand playback position for lessons learned from a creation. */
  ghostTime = 0;

  private recorder: Recorder;
  private lastCut: [number, number, number] | null = null;
  private gripTime = 0;
  private yawTravel = 0;
  private lastLeftX: number | null = null;
  private lastYawEvent = 0;
  private progressDirty = true;
  private progressTimer = 0;
  private overcutWarnAt = 0;
  private raycaster = new THREE.Raycaster();
  private blockMatrix = new THREE.Matrix4();

  constructor(public mode: KuksaMode) {
    this.target = mode.kind === 'lesson' ? (mode.target ?? makeTarget()) : null;
    this.analysis = this.target ? analyseTarget(this.target) : null;
    this.recorder = new Recorder('kuksa', usePipeline.getState().kind ?? 'none');
    if (mode.kind === 'replay') this.replaySpeed = mode.recording.source === 'seed' ? 1 : 2;
  }

  /** Reset the UI store for this session. Call from an effect, not during render. */
  activate() {
    const mode = this.mode;
    if (mode.kind !== 'replay' && !this.recorder.active) this.recorder.start();
    useKuksaUi.setState({
      step: 0,
      progress: this.target ? measureProgress(this.grid, this.target, this.analysis!) : null,
      phase: mode.kind === 'replay' ? 'replaying' : 'carving',
      feedback: null,
      view: 'side',
      guide: true,
      cutCount: 0,
      engaged: false,
      lastRecording: null,
    });
  }

  get stepId(): StepId | null {
    return this.mode.kind === 'lesson' ? STEPS[useKuksaUi.getState().step]?.id ?? null : null;
  }

  turn(delta: number) {
    this.yaw += delta;
    this.yawTravel += Math.abs(delta);
    if (Math.abs(this.yaw - this.lastYawEvent) > 0.03) {
      this.recorder.event({ type: 'yaw', value: Math.round(this.yaw * 1000) / 1000 });
      this.lastYawEvent = this.yaw;
    }
  }

  tick(dtMs: number, camera: THREE.Camera) {
    const dt = dtMs / 1000;
    this.updateChips(dt);
    if (this.mode.kind === 'replay') return this.tickReplay(dtMs);
    if (useKuksaUi.getState().phase !== 'carving') return;

    if (this.mode.kind === 'lesson' && this.mode.fromCreation) {
      // Loop the creator's real hand movements as a ghost demonstrator.
      const rec = this.mode.fromCreation.recording;
      this.ghostTime = (this.ghostTime + dtMs) % Math.max(1, rec.durationMs);
      this.ghostPose = samplePose(rec, this.ghostTime);
    }

    // Turning the workpiece: keys, or the off-hand gripping and sliding sideways.
    if (keys.has('q')) this.turn(-1.6 * dt);
    if (keys.has('e')) this.turn(1.6 * dt);
    const off = secondaryCommand();
    if (off && off.grip > 0.6) {
      if (this.lastLeftX !== null) this.turn((off.position.x - this.lastLeftX) * 2.2);
      this.lastLeftX = off.position.x;
    } else this.lastLeftX = null;

    const cmd = primaryCommand();
    if (!cmd) {
      this.livePose = undefined;
      this.tipOnWood = false;
      return;
    }
    this.side = cmd.side;

    // Aim: hand position -> a ray from the camera -> first wood voxel it meets.
    const ndc = new THREE.Vector2(THREE.MathUtils.clamp(cmd.position.x * 0.8, -0.95, 0.95), THREE.MathUtils.clamp(cmd.position.y * 0.8 - 0.05, -0.95, 0.95));
    this.raycaster.setFromCamera(ndc, camera);
    const inv = this.blockMatrix.makeRotationY(this.yaw).invert();
    const o = this.raycaster.ray.origin.clone().applyMatrix4(inv);
    const d = this.raycaster.ray.direction.clone().transformDirection(inv);
    const ov = localToVoxel(o.x, o.y, o.z);
    const hit = raycast(this.grid, ov, [d.x, d.y, d.z]);
    let hitVoxel: [number, number, number] | null = null;
    if (hit) {
      hitVoxel = [ov[0] + d.x * hit.t, ov[1] + d.y * hit.t, ov[2] + d.z * hit.t];
      this.tip.copy(this.raycaster.ray.at(hit.t * VOXEL, new THREE.Vector3()));
      this.tipOnWood = true;
    } else {
      // Hover in a plane through the block centre, facing the camera.
      const dist = camera.position.length();
      this.tip.copy(this.raycaster.ray.at(dist * 0.85, new THREE.Vector3()));
      this.tipOnWood = false;
    }

    const grip = cmd.grip;
    const engaged = grip > 0.5;
    if (engaged !== useKuksaUi.getState().engaged) useKuksaUi.setState({ engaged });
    // The robot always holds the knife; the human's grip only adds pressure.
    const holdDof = cmd.dof.map((v, i) => (i < 2 ? Math.max(0.45, v) : 0.55 + 0.45 * v)) as Dof6;
    const extra = new THREE.Quaternion().slerp(cmd.rotation, 0.25);
    const pressDepth = engaged ? 0 : 0.18; // lift the blade off the wood when not cutting
    const tipShown = this.tip.clone().addScaledVector(this.raycaster.ray.direction, -pressDepth);
    const w = wristForTip(tipShown, cmd.side, extra);
    this.livePose = { dof: holdDof, position: w.position, rotation: w.rotation };
    this.recorder.frame([{ side: cmd.side, pose: this.livePose }]);

    if (engaged && hitVoxel) {
      const moved = !this.lastCut || Math.hypot(hitVoxel[0] - this.lastCut[0], hitVoxel[1] - this.lastCut[1], hitVoxel[2] - this.lastCut[2]) > 0.6;
      if (moved) {
        const r = grip > 0.85 ? 1.7 : 1.05;
        const c: [number, number, number] = [hitVoxel[0] + d.x * r * 0.5, hitVoxel[1] + d.y * r * 0.5, hitVoxel[2] + d.z * r * 0.5];
        this.cut(carveSphere(this.grid, c[0], c[1], c[2], r), grip);
        this.lastCut = hitVoxel;
      }
    }
    if (!engaged) this.lastCut = null;

    this.updateTutorial(dt, grip);
    this.progressTimer -= dtMs;
    if (this.progressDirty && this.progressTimer <= 0 && this.target && this.analysis) {
      useKuksaUi.setState({ progress: measureProgress(this.grid, this.target, this.analysis) });
      this.progressDirty = false;
      this.progressTimer = 150;
    }

  }

  private cut(cells: number[], grip: number) {
    if (!cells.length) return;
    this.recorder.event({ type: 'cut', cells });
    useKuksaUi.setState({ cutCount: useKuksaUi.getState().cutCount + 1 });
    this.progressDirty = true;
    unlockAudio();
    scrape(Math.min(1, cells.length / 20));
    this.spawnChips(cells, grip);
    if (this.target && cells.some((c) => this.target!.data[c]) && performance.now() - this.overcutWarnAt > 1500) {
      this.overcutWarnAt = performance.now();
      useKuksaUi.setState({ feedback: { text: 'Too deep! That was part of the cup. Lighten your grip near the pale wood.', kind: 'warn', at: performance.now() } });
    }
  }

  private spawnChips(cells: number[], grip: number) {
    const n = Math.min(10, 2 + Math.floor(cells.length / 3));
    const rot = new THREE.Matrix4().makeRotationY(this.yaw);
    for (let k = 0; k < n; k++) {
      const [x, y, z] = coords(cells[Math.floor(Math.random() * cells.length)]);
      const p = new THREE.Vector3(...cellToLocal(x, y, z)).applyMatrix4(rot);
      const v = new THREE.Vector3((Math.random() - 0.5) * 2.5, 1.5 + Math.random() * 2 * grip, (Math.random() - 0.2) * 2.5);
      this.chips.push({ p, v, life: 1.2 });
    }
    if (this.chips.length > 120) this.chips.splice(0, this.chips.length - 120);
  }

  private updateChips(dt: number) {
    for (const c of this.chips) {
      c.v.y -= 9 * dt;
      c.p.addScaledVector(c.v, dt);
      c.life -= dt;
      if (c.p.y < -1.2) {
        c.p.y = -1.2;
        c.v.multiplyScalar(0.3);
      }
    }
    this.chips = this.chips.filter((c) => c.life > 0);
  }

  private updateTutorial(dt: number, grip: number) {
    const ui = useKuksaUi.getState();
    const id = this.stepId;
    if (!id) return;
    const p = ui.progress;
    let done = false;
    if (id === 'grip') {
      if (grip > 0.5) this.gripTime += dt;
      done = this.gripTime > 0.8;
    } else if (id === 'turn') done = this.yawTravel > 1.2;
    else if (id === 'outside') done = !!p && p.outside > 0.6;
    else if (id === 'hollow') done = !!p && p.cavity > 0.6;
    if (done) this.advanceStep();
  }

  advanceStep() {
    const ui = useKuksaUi.getState();
    const next = Math.min(STEPS.length - 1, ui.step + 1);
    if (next === ui.step) return;
    if (STEPS[ui.step].id === 'turn') this.yawTravel = 0;
    useKuksaUi.setState({ step: next, view: STEPS[next].view, feedback: { text: `Step done: ${STEPS[ui.step].title}`, kind: 'good', at: performance.now() } });
  }

  finish() {
    const rec = this.recorder.stop();
    const progress = this.target && this.analysis ? measureProgress(this.grid, this.target, this.analysis) : null;
    useKuksaUi.setState({ phase: 'finished', lastRecording: rec, progress });
  }

  private tickReplay(dtMs: number) {
    if (this.mode.kind !== 'replay' || useKuksaUi.getState().phase !== 'replaying') return;
    const rec = this.mode.recording;
    const prev = this.replayTime;
    this.replayTime += dtMs * this.replaySpeed;
    for (const e of eventsBetween(rec, prev, this.replayTime)) {
      if (e.type === 'cut') {
        this.grid.removeCells(e.cells);
        if (Math.random() < 0.5) this.spawnChips(e.cells, 0.6);
        if (Math.random() < 0.3) scrape(0.3);
      } else if (e.type === 'yaw') this.yaw = e.value;
    }
    this.livePose = samplePose(rec, this.replayTime);
    if (this.replayTime > rec.durationMs + 300) useKuksaUi.setState({ phase: 'replayDone' });
  }

  restartReplay() {
    unlockAudio();
    this.grid = new VoxelGrid();
    this.grid.version = Math.random() * 1e6;
    this.replayTime = 0;
    this.yaw = 0.35;
    useKuksaUi.setState({ phase: 'replaying' });
  }

  dispose() {
    if (this.recorder.active) this.recorder.stop();
  }
}
