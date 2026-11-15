// The ocarina session: turns the Retargeter's per-finger flexion into covered
// holes, a pitch and a sound, runs lessons, and records / replays takes.
//
// Only finger flexion is read (live.commands[side].dof); wrist position and
// rotation are deliberately ignored, since the stage holds the wrists fixed.
// Live robot streaming is done by the pipeline itself (settings.mirrorRobot);
// during replay this session swaps in the recorded Inspire commands through
// setRobotOverride.
//
// Hot path: tick() runs every animation frame and fills one reused
// OcarinaView for the stage. Slow UI state goes to the useOcarinaUi store, only
// when something changed (note/holes at most ~15 times a second).

import { create } from 'zustand';
import { live, setRobotOverride, usePipeline } from '../../input/pipeline';
import { toInspireAngles, type Dof6 } from '../../robot/retarget';
import type { Side } from '../../rokoko/types';
import { createSynth } from './audio';
import { HoleTracker, midiToName, pitchOf } from './fingering';
import { thresholdsFrom, useHoleCalibration } from './holeCalibration';
import { Lesson, type NoteResult } from './lesson';
import { TakePlayer, TakeRecorder } from './recording';
import { SONGS } from './songs';
import { HOLES, type HoleStates, type OcarinaSynth, type OcarinaView, type Song, type Take, type TakeFrame } from './types';

export type OcarinaMode = 'free' | 'lesson';

export interface OcarinaLessonUi {
  songId: string;
  wait: boolean;
  state: 'countin' | 'playing' | 'done';
  /** Index of the note being played (events.length once done). */
  current: number;
  /** Beats left in the count-in (0 once playing). */
  countIn: number;
  results: NoteResult[];
  hitPercent: number;
  stars: 0 | 1 | 2 | 3;
}

export interface TakeMeta {
  id: string;
  name: string;
  durationMs: number;
}

export interface OcarinaUi {
  mode: OcarinaMode;
  /** Sounding note (live or replay), null when silent. */
  midi: number | null;
  noteName: string | null;
  holes: HoleStates;
  tracked: Record<Side, boolean>;
  lesson: OcarinaLessonUi | null;
  recording: boolean;
  takes: TakeMeta[];
  /** Id of the take (or market song) being replayed, if any. */
  replaying: string | null;
  /** Name of the take being replayed (shown on the stage), if any. */
  replayingName: string | null;
  /** Length of the replaying take in take time (ms), 0 when nothing replays. */
  replayDurationMs: number;
  /** Replay is frozen on its current frame (hands hold, sound off). */
  replayPaused: boolean;
  muted: boolean;
  /** Whether the browser has let audio start (it needs a click or key press first). */
  audioReady: boolean;
}

const initialUi = (): OcarinaUi => ({
  mode: 'free',
  midi: null,
  noteName: null,
  holes: HOLES.map(() => false),
  tracked: { left: false, right: false },
  lesson: null,
  recording: false,
  takes: [],
  replaying: null,
  replayingName: null,
  replayDurationMs: 0,
  replayPaused: false,
  muted: false,
  audioReady: false,
});

export const useOcarinaUi = create<OcarinaUi>(initialUi);

const SIDES: readonly Side[] = ['left', 'right'];
/** Longest step tick() will take (a backgrounded tab must not fast-forward a lesson). */
export const MAX_DT_MS = 100;
/** Minimum gap between note/hole UI updates (~15 Hz). */
const UI_INTERVAL_MS = 66;

const sameHoles = (a: HoleStates, b: HoleStates) => a.length === b.length && a.every((v, i) => v === b[i]);

export class OcarinaSession {
  private readonly tracker = new HoleTracker();
  private readonly recorder = new TakeRecorder();
  private synth: OcarinaSynth = createSynth();
  private synthDisposed = false;
  private muted = false;
  private player: TakePlayer | null = null;
  /** Id shown as useOcarinaUi.replaying (a take id or a market song id). */
  private replayId: string | null = null;
  /** Replay speed multiplier (take ms per real ms). */
  private rate = 1;
  private paused = false;
  /** The take frame currently shown during replay (what the robot is sent). */
  private replayFrame: TakeFrame | undefined;
  private lesson: Lesson | null = null;
  private mode: OcarinaMode = 'free';
  private takes: Take[] = [];
  /** Session clock (sum of clamped dt), used to stamp recorded frames. */
  private clock = 0;
  private lastUiAt = -Infinity;
  private raf = 0;
  private active = false;
  private unsubs: (() => void)[] = [];
  private readonly view: OcarinaView = { dof: {}, holes: HOLES.map(() => false), midi: null };

  activate(): void {
    if (this.active) return;
    this.active = true;
    usePipeline.getState().setCalibrationContext('ocarina');
    this.applyHoleCalibration();
    this.unsubs = [
      useHoleCalibration.subscribe(() => this.applyHoleCalibration()),
      usePipeline.subscribe((s, prev) => {
        if (s.kind !== prev.kind) this.applyHoleCalibration();
        // The hole calibration is measured in the hand calibration's units: redoing that invalidates it.
        if (s.calibratedAt !== prev.calibratedAt && s.calibratedAt?.context === 'ocarina' && s.kind) {
          useHoleCalibration.getState().clear(s.kind);
        }
      }),
    ];
    if (this.synthDisposed) {
      // StrictMode (and route re-entry) can dispose and re-activate the same session.
      this.synth = createSynth();
      this.synthDisposed = false;
    }
    this.synth.setMuted(this.muted);
    window.addEventListener('pointerdown', this.unlock, true);
    window.addEventListener('keydown', this.unlock, true);
    // Start audio now: arriving from the globe, the click that got us here already counts as a
    // gesture, so this usually runs at once. Otherwise it stays suspended until the next click/key.
    this.synth.unlock();
    let last = performance.now();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.tick(t - last);
      last = t;
    };
    this.raf = requestAnimationFrame(loop);
    if (import.meta.env.DEV) Object.assign(window, { senecaiOcarina: this });
    this.publishAll();
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.raf);
    for (const u of this.unsubs) u();
    this.unsubs = [];
    window.removeEventListener('pointerdown', this.unlock, true);
    window.removeEventListener('keydown', this.unlock, true);
    if (this.recorder.recording) this.stopRecording();
    this.endReplay();
    this.synth.dispose();
    this.synthDisposed = true;
    usePipeline.getState().setCalibrationContext('default');
  }

  private readonly unlock = (): void => this.synth.unlock();

  /** Use the saved hole calibration for the current input source (defaults when there is none). */
  private applyHoleCalibration(): void {
    const kind = usePipeline.getState().kind;
    const t = thresholdsFrom(kind ? useHoleCalibration.getState().bySource[kind] : undefined);
    this.tracker.setThresholds(t);
    this.view.coverOn = t.map((x) => x.on);
  }

  /** Start audio from a user gesture (e.g. an "Enable sound" button). */
  enableAudio(): void {
    this.synth.unlock();
  }

  /** The stage's per-frame view (one reused object). Bound, so it can be passed as a callback. */
  readonly getView = (): OcarinaView => this.view;

  /** During replay: the recorded flexion of the dominant (else the other) hand, for the pipeline strip. */
  readonly replayDof = (): Dof6 | undefined => {
    const f = this.replayFrame;
    if (!this.player || !f) return undefined;
    const dom = usePipeline.getState().settings.dominant;
    return f.dof[dom] ?? f.dof[dom === 'right' ? 'left' : 'right'];
  };

  get replaying(): boolean {
    return this.player !== null;
  }

  /** Advance one frame. dtMs is clamped to 0..MAX_DT_MS. */
  tick(dtMs: number): void {
    const dt = Math.min(MAX_DT_MS, Math.max(0, Number.isFinite(dtMs) ? dtMs : 0));
    this.clock += dt;
    const view = this.view;

    if (this.player) {
      const frame = this.paused ? this.player.seek(this.player.time) : this.player.tick(dt * this.rate);
      if (this.player.done) {
        this.endReplay();
      } else {
        this.replayFrame = frame;
        for (const side of SIDES) {
          const d = frame?.dof[side];
          if (d) view.dof[side] = d;
          else delete view.dof[side];
        }
        view.holes = frame ? frame.holes : HOLES.map(() => false);
        view.midi = frame && !this.paused ? frame.midi : null;
        this.synth.setNote(view.midi);
        this.publishFrame();
        return;
      }
    }

    let tracked = false;
    for (const side of SIDES) {
      const d = live.commands[side]?.dof;
      if (d) {
        view.dof[side] = d;
        tracked = true;
      } else delete view.dof[side];
    }
    view.holes = this.tracker.update(view.dof);
    view.midi = tracked ? pitchOf(view.holes) : null;
    this.synth.setNote(view.midi);

    if (this.lesson) this.lesson.tick(dt, view.midi);
    if (this.recorder.recording) {
      const inspire: Partial<Record<Side, number[]>> = {};
      for (const side of SIDES) {
        const d = view.dof[side];
        if (d) inspire[side] = toInspireAngles(d);
      }
      this.recorder.frame(this.clock, { dof: view.dof, holes: view.holes, midi: view.midi, inspire });
    }
    this.publishFrame();
  }

  setMode(mode: OcarinaMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'free') this.lesson = null;
    useOcarinaUi.setState({ mode, lesson: this.lessonUi() });
  }

  /**
   * Starts a lesson on a built-in song id or any Song (e.g. one derived from a
   * downloaded market take). `speed` scales the tempo (count-in included).
   */
  startLesson(songOrId: string | Song, wait: boolean, speed = 1): void {
    if (this.player) return;
    const song = typeof songOrId === 'string' ? SONGS.find((s) => s.id === songOrId) : songOrId;
    if (!song) throw new Error(`Unknown song: ${String(songOrId)}`);
    if (!song.notes.length) throw new Error(`Song has no notes: ${song.id}`);
    this.mode = 'lesson';
    this.lesson = new Lesson(speed === 1 ? song : { ...song, bpm: song.bpm * speed }, { wait });
    useOcarinaUi.setState({ mode: 'lesson', lesson: this.lessonUi() });
  }

  stopLesson(): void {
    this.lesson = null;
    useOcarinaUi.setState({ lesson: null });
  }

  /** The note the running lesson asks for (the first note during the count-in), or null. */
  get targetMidi(): number | null {
    const l = this.lesson;
    if (!l || l.state === 'done') return null;
    return l.events[l.current]?.midi ?? null;
  }

  startRecording(): void {
    if (this.player || this.recorder.recording) return;
    this.recorder.start(this.clock);
    useOcarinaUi.setState({ recording: true });
  }

  /** Ends recording; returns the new take (null when nothing was captured). */
  stopRecording(): Take | null {
    const take = this.recorder.stop(this.clock);
    if (take) this.takes = [...this.takes, take];
    useOcarinaUi.setState({ recording: false, takes: this.takeMetas() });
    return take;
  }

  /** Replays one of this session's takes. Refused while recording. */
  replay(takeId: string): void {
    const take = this.takes.find((t) => t.id === takeId);
    if (take) this.replayTake(take, take.id);
  }

  /**
   * Replays any take (e.g. a market song) through the same path as session takes;
   * `id` is what useOcarinaUi.replaying shows. Refused while recording; ends any
   * replay already running.
   */
  replayTake(take: Take, id: string): void {
    if (this.recorder.recording) return;
    this.endReplay();
    if (this.lesson) this.stopLesson();
    this.player = new TakePlayer(take);
    this.replayId = id;
    this.paused = false;
    this.replayFrame = undefined;
    setRobotOverride(() => this.replayFrame?.inspire);
    useOcarinaUi.setState({ replaying: id, replayingName: take.name, replayDurationMs: take.durationMs, replayPaused: false });
  }

  /** Position of the running replay in take time (ms), 0 when idle. */
  get replayTime(): number {
    return this.player?.time ?? 0;
  }

  /** Replay speed for every replay (takes, market songs, demos); clamped to 0.25..2. */
  setPlaybackRate(rate: number): void {
    this.rate = Number.isFinite(rate) ? Math.min(2, Math.max(0.25, rate)) : 1;
  }

  setReplayPaused(paused: boolean): void {
    if (!this.player || this.paused === paused) return;
    this.paused = paused;
    useOcarinaUi.setState({ replayPaused: paused });
  }

  /** Jumps the running replay to `ms` of take time. */
  seekReplay(ms: number): void {
    this.player?.seek(ms);
  }

  stopReplay(): void {
    this.endReplay();
  }

  deleteTake(id: string): void {
    if (this.replayId === id) this.endReplay();
    this.takes = this.takes.filter((t) => t.id !== id);
    useOcarinaUi.setState({ takes: this.takeMetas() });
  }

  getTakes(): readonly Take[] {
    return this.takes;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.synth.setMuted(muted);
    useOcarinaUi.setState({ muted });
  }

  private endReplay(): void {
    if (!this.player) return;
    this.player = null;
    this.replayId = null;
    this.paused = false;
    this.replayFrame = undefined;
    setRobotOverride(null);
    this.synth.setNote(null);
    this.view.midi = null;
    useOcarinaUi.setState({ replaying: null, replayingName: null, replayDurationMs: 0, replayPaused: false });
  }

  private takeMetas(): TakeMeta[] {
    return this.takes.map((t) => ({ id: t.id, name: t.name, durationMs: t.durationMs }));
  }

  private lessonUi(): OcarinaLessonUi | null {
    const l = this.lesson;
    if (!l) return null;
    const beatMs = 60000 / l.song.bpm;
    return {
      songId: l.song.id,
      wait: l.wait,
      state: l.state,
      current: l.current,
      countIn: l.state === 'countin' ? Math.ceil(-l.songTime / beatMs - 1e-6) : 0,
      results: l.results,
      hitPercent: l.hitPercent,
      stars: l.stars,
    };
  }

  /** Push whatever slow UI state changed this frame. */
  private publishFrame(): void {
    const ui = useOcarinaUi.getState();
    const patch: Partial<OcarinaUi> = {};
    const v = this.view;
    const tracked = this.player
      ? { left: !!v.dof.left, right: !!v.dof.right }
      : { left: !!live.commands.left, right: !!live.commands.right };
    if (tracked.left !== ui.tracked.left || tracked.right !== ui.tracked.right) patch.tracked = tracked;
    if (this.synth.ready !== ui.audioReady) patch.audioReady = this.synth.ready;
    if ((v.midi !== ui.midi || !sameHoles(v.holes, ui.holes)) && this.clock - this.lastUiAt >= UI_INTERVAL_MS) {
      this.lastUiAt = this.clock;
      patch.midi = v.midi;
      patch.noteName = v.midi === null ? null : midiToName(v.midi);
      patch.holes = [...v.holes];
    }
    const l = this.lesson;
    if (l) {
      const next = this.lessonUi()!;
      const prev = ui.lesson;
      if (!prev || prev.state !== next.state || prev.current !== next.current || prev.countIn !== next.countIn || prev.songId !== next.songId) patch.lesson = next;
    }
    if (Object.keys(patch).length) useOcarinaUi.setState(patch);
  }

  private publishAll(): void {
    const v = this.view;
    useOcarinaUi.setState({
      mode: this.mode,
      midi: v.midi,
      noteName: v.midi === null ? null : midiToName(v.midi),
      holes: [...v.holes],
      tracked: { left: !!v.dof.left, right: !!v.dof.right },
      lesson: this.lessonUi(),
      recording: this.recorder.recording,
      takes: this.takeMetas(),
      replaying: this.replayId,
      replayingName: this.player?.take.name ?? null,
      replayDurationMs: this.player?.take.durationMs ?? 0,
      replayPaused: this.paused,
      muted: this.muted,
    });
  }
}
