// The live input pipeline:
//
//   source (webcam | gloves | keyboard) -> RokokoFrame -> parseFrame -> HumanHands
//     -> Retargeter -> RobotHandCommand (left/right) -> scenes, recorder, robot link
//
// Hot-path data lives in the mutable `live` object (read every frame by the 3D
// scenes, no React re-renders). The zustand store only holds slow UI state.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { parseFrame, type HumanHands } from '../rokoko/parse';
import type { RokokoFrame, Side } from '../rokoko/types';
import { captureFist, captureOpen, defaultCalibration, Retargeter, toInspireAngles, type Calibration, type RobotHandCommand } from '../robot/retarget';
import { DEFAULT_BRIDGE_URL, GlovesSource } from './glovesSource';
import { KeyboardSource } from './keyboardSource';
import type { HandSource, SourceKind, SourceStatus } from './types';
import { WebcamSource } from './webcamSource';

export const live = {
  frame: null as RokokoFrame | null,
  hands: { actorName: '', timestamp: 0 } as HumanHands,
  commands: {} as Partial<Record<Side, RobotHandCommand>>,
  frameCount: 0,
  lastFrameAt: 0,
  source: null as HandSource | null,
};

export interface Settings {
  dominant: Side;
  swapHands: boolean;
  bridgeUrl: string;
  mirrorRobot: boolean;
}

interface PipelineStore {
  kind: SourceKind | null;
  status: SourceStatus;
  fps: number;
  present: { left: boolean; right: boolean };
  settings: Settings;
  calibrations: Partial<Record<SourceKind, Calibration>>;
  /** Last source the user picked, restarted automatically on reload. */
  lastKind: SourceKind | null;
  panelOpen: boolean;
  setPanelOpen(open: boolean): void;
  start(kind: SourceKind): Promise<void>;
  stop(): void;
  updateSettings(s: Partial<Settings>): void;
  calibrate(step: 'open' | 'fist'): Side | null;
  resetCalibration(): void;
}

const retargeter = new Retargeter(defaultCalibration());

function calibrationFor(kind: SourceKind, stored?: Calibration): Calibration {
  const cal = stored ? structuredClone(stored) : defaultCalibration();
  if (!stored && kind === 'webcam') {
    cal.positionScale = 0.2;
  }
  // Glove yaw has an arbitrary zero (magnetic north), so start from wherever the hand is.
  if (kind === 'gloves') cal.autoNeutral = true;
  return cal;
}

export const usePipeline = create<PipelineStore>()(
  persist(
    (set, get) => ({
      kind: null,
      status: { state: 'idle', message: 'No input selected' },
      fps: 0,
      present: { left: false, right: false },
      settings: { dominant: 'right', swapHands: false, bridgeUrl: DEFAULT_BRIDGE_URL, mirrorRobot: false },
      calibrations: {},
      lastKind: null,
      panelOpen: false,
      setPanelOpen: (panelOpen) => set({ panelOpen }),

      async start(kind) {
        get().stop();
        const { settings, calibrations } = get();
        retargeter.calibration = calibrationFor(kind, calibrations[kind]);
        // The webcam is noisier than the gloves, so smooth it more.
        retargeter.dofTau = kind === 'webcam' ? 0.07 : 0.03;
        retargeter.posTau = kind === 'webcam' ? 0.09 : 0.04;

        const source: HandSource =
          kind === 'webcam' ? Object.assign(new WebcamSource(), { swapHands: settings.swapHands }) : kind === 'gloves' ? new GlovesSource(settings.bridgeUrl) : new KeyboardSource();
        live.source = source;
        set({ kind, lastKind: kind, status: { state: 'starting', message: 'Starting…' } });
        try {
          await source.start(onFrame, (status) => live.source === source && set({ status }));
        } catch (e) {
          if (live.source !== source) return;
          const msg = e instanceof Error ? e.message : String(e);
          set({ status: { state: 'error', message: msg } });
        }
      },

      stop() {
        live.source?.stop();
        live.source = null;
        live.commands = {};
        live.frame = null;
        set({ kind: null, status: { state: 'idle', message: 'No input selected' }, present: { left: false, right: false }, fps: 0 });
      },

      updateSettings(s) {
        set({ settings: { ...get().settings, ...s } });
        if (live.source instanceof WebcamSource && s.swapHands !== undefined) live.source.swapHands = s.swapHands;
        if (s.bridgeUrl !== undefined && get().kind === 'gloves') void get().start('gloves');
      },

      calibrate(step) {
        const kind = get().kind;
        const side = live.hands[get().settings.dominant] ? get().settings.dominant : live.hands.right ? 'right' : live.hands.left ? 'left' : null;
        if (!kind || !side) return null;
        const hand = live.hands[side]!;
        if (step === 'open') captureOpen(retargeter.calibration, hand);
        else captureFist(retargeter.calibration, hand);
        // Apply the same calibration to the other hand if it is visible.
        const other = side === 'left' ? live.hands.right : live.hands.left;
        if (other) step === 'open' ? captureOpen(retargeter.calibration, other) : captureFist(retargeter.calibration, other);
        set({ calibrations: { ...get().calibrations, [kind]: structuredClone(retargeter.calibration) } });
        return side;
      },

      resetCalibration() {
        const kind = get().kind;
        if (!kind) return;
        const calibrations = { ...get().calibrations };
        delete calibrations[kind];
        retargeter.calibration = calibrationFor(kind);
        set({ calibrations });
      },
    }),
    {
      name: 'senecai.input.v1',
      partialize: (s) => ({ settings: s.settings, calibrations: s.calibrations, lastKind: s.lastKind }),
    },
  ),
);

function onFrame(frame: RokokoFrame) {
  live.frame = frame;
  live.hands = parseFrame(frame);
  live.commands = retargeter.update(live.hands);
  live.frameCount++;
  live.lastFrameAt = performance.now();
}

/** The hand that drives the craft: the dominant hand if visible, else whichever is. */
export function primaryCommand(): RobotHandCommand | undefined {
  const dom = usePipeline.getState().settings.dominant;
  return live.commands[dom] ?? live.commands[dom === 'right' ? 'left' : 'right'];
}

export function secondaryCommand(): RobotHandCommand | undefined {
  const dom = usePipeline.getState().settings.dominant;
  const primary = live.commands[dom] ? dom : dom === 'right' ? 'left' : 'right';
  return live.commands[primary === 'right' ? 'left' : 'right'];
}

// Slow UI refresh: fps + which hands are present.
let lastCount = 0;
setInterval(() => {
  const s = usePipeline.getState();
  const fps = (live.frameCount - lastCount) * 2;
  lastCount = live.frameCount;
  const stale = performance.now() - live.lastFrameAt > 500;
  if (stale) live.commands = {};
  const present = { left: !stale && !!live.commands.left, right: !stale && !!live.commands.right };
  if (fps !== s.fps || present.left !== s.present.left || present.right !== s.present.right) usePipeline.setState({ fps, present });
}, 500);

// Optional: mirror retargeted commands to a physical robot hand via the bridge.
let robotWs: WebSocket | null = null;
setInterval(() => {
  const { settings } = usePipeline.getState();
  if (!settings.mirrorRobot) {
    robotWs?.close();
    robotWs = null;
    return;
  }
  if (!robotWs || robotWs.readyState === WebSocket.CLOSED) {
    robotWs = new WebSocket(settings.bridgeUrl);
    return;
  }
  if (robotWs.readyState !== WebSocket.OPEN) return;
  for (const side of ['left', 'right'] as Side[]) {
    const c = live.commands[side];
    if (c) robotWs.send(JSON.stringify({ type: 'robot', side, inspire: toInspireAngles(c.dof) }));
  }
}, 33);
