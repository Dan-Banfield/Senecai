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
import { FusedSource } from './fusedSource';
import type { Rotation } from './gloveTracker';
import { DEFAULT_BRIDGE_URL, GlovesSource } from './glovesSource';
import { KeyboardSource } from './keyboardSource';
import type { HandSource, SourceKind, SourceStatus } from './types';
import { WebcamSource } from './webcamSource';

const NO_HANDS = (): HumanHands => ({ actorName: '', timestamp: 0 });
/** A source is considered gone once no frame has arrived for this long. */
const STALE_MS = 500;

export const live = {
  frame: null as RokokoFrame | null,
  hands: NO_HANDS(),
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
  /** The camera hand tracking uses (a MediaDeviceInfo.deviceId); empty or missing means the browser's default. */
  cameraId?: string;
  /** How far to turn the overhead camera's picture (clockwise) so you sit at its bottom edge. */
  cameraRotation?: Rotation;
}

interface PipelineStore {
  kind: SourceKind | null;
  status: SourceStatus;
  fps: number;
  present: { left: boolean; right: boolean };
  settings: Settings;
  /** Saved calibrations, by input (and context: "gloves:piano" is the gloves calibrated for the piano). */
  calibrations: Record<string, Calibration>;
  /**
   * What the calibration is for. A page can ask for its own (the piano wants your
   * playing position as the rest pose); everything else uses "default".
   */
  calibrationContext: string;
  setCalibrationContext(context: string): void;
  /** The last calibration step taken (pages that need to know your rest pose listen for it). */
  calibratedAt: { step: 'open' | 'fist'; context: string; at: number } | null;
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

/** Where a calibration is saved: per input, and per context other than the default. */
export const calibrationKey = (kind: SourceKind, context: string) => (context === 'default' ? kind : `${kind}:${context}`);

const retargeter = new Retargeter(defaultCalibration());

function calibrationFor(kind: SourceKind, stored?: Calibration): Calibration {
  const cal = stored ? structuredClone(stored) : defaultCalibration();
  // Hand positions come from the webcam for both of these.
  if (!stored && (kind === 'webcam' || kind === 'fused')) {
    cal.positionScale = 0.2;
  }
  // Glove yaw has an arbitrary zero (magnetic north), so start from wherever the hand is.
  if (kind === 'gloves' || kind === 'fused') cal.autoNeutral = true;
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
      calibrationContext: 'default',
      calibratedAt: null,
      lastKind: null,
      panelOpen: false,
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      setCalibrationContext(context) {
        if (context === get().calibrationContext) return;
        set({ calibrationContext: context });
        const kind = get().kind;
        if (kind) retargeter.calibration = calibrationFor(kind, get().calibrations[calibrationKey(kind, context)]);
      },

      async start(kind) {
        get().stop();
        const { settings, calibrations, calibrationContext } = get();
        retargeter.calibration = calibrationFor(kind, calibrations[calibrationKey(kind, calibrationContext)]);
        // The webcam is noisier than the gloves, so smooth what it measures more:
        // everything for the webcam alone, just positions with the gloves.
        retargeter.dofTau = kind === 'webcam' ? 0.07 : 0.03;
        retargeter.posTau = kind === 'webcam' || kind === 'fused' ? 0.09 : 0.04;

        const source: HandSource =
          kind === 'webcam'
            ? Object.assign(new WebcamSource(), { swapHands: settings.swapHands, cameraId: settings.cameraId ?? '' })
            : kind === 'gloves'
              ? new GlovesSource(settings.bridgeUrl)
              : kind === 'fused'
                ? new FusedSource(settings.bridgeUrl, settings.swapHands, settings.cameraId ?? '', settings.cameraRotation ?? 0)
                : new KeyboardSource();
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
        live.hands = NO_HANDS();
        live.frame = null;
        set({ kind: null, status: { state: 'idle', message: 'No input selected' }, present: { left: false, right: false }, fps: 0 });
      },

      updateSettings(s) {
        set({ settings: { ...get().settings, ...s } });
        if (live.source instanceof WebcamSource && s.swapHands !== undefined) live.source.swapHands = s.swapHands;
        if (live.source instanceof FusedSource && s.swapHands !== undefined) live.source.camera.swapHands = s.swapHands;
        const kind = get().kind;
        if (s.bridgeUrl !== undefined && (kind === 'gloves' || kind === 'fused')) void get().start(kind);
        else if (s.cameraId !== undefined && (kind === 'webcam' || kind === 'fused')) void get().start(kind);
        else if (s.cameraRotation !== undefined && kind === 'fused') void get().start(kind);
      },

      calibrate(step) {
        const kind = get().kind;
        if (performance.now() - live.lastFrameAt > STALE_MS) return null;
        const side = live.hands[get().settings.dominant] ? get().settings.dominant : live.hands.right ? 'right' : live.hands.left ? 'left' : null;
        if (!kind || !side) return null;
        const hand = live.hands[side]!;
        if (step === 'open') captureOpen(retargeter.calibration, hand);
        else captureFist(retargeter.calibration, hand);
        // Apply the same calibration to the other hand if it is visible.
        const other = side === 'left' ? live.hands.right : live.hands.left;
        if (other) step === 'open' ? captureOpen(retargeter.calibration, other) : captureFist(retargeter.calibration, other);
        set({
          calibrations: { ...get().calibrations, [calibrationKey(kind, get().calibrationContext)]: structuredClone(retargeter.calibration) },
          calibratedAt: { step, context: get().calibrationContext, at: performance.now() },
        });
        return side;
      },

      resetCalibration() {
        const kind = get().kind;
        if (!kind) return;
        const calibrations = { ...get().calibrations };
        delete calibrations[calibrationKey(kind, get().calibrationContext)];
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

/** Metres of real hand travel per unit of RobotHandCommand.position, for the current input. */
export const positionScale = () => retargeter.calibration.positionScale;

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
  const stale = performance.now() - live.lastFrameAt > STALE_MS;
  if (stale) {
    live.commands = {};
    live.hands = NO_HANDS();
  }
  const present = { left: !stale && !!live.commands.left, right: !stale && !!live.commands.right };
  if (fps !== s.fps || present.left !== s.present.left || present.right !== s.present.right) usePipeline.setState({ fps, present });
}, 500);

// Optional: mirror retargeted commands to a physical robot hand via the bridge.
// Reconnects with exponential backoff, and reopens when bridgeUrl changes.
const ROBOT_BACKOFF_MIN = 500;
const ROBOT_BACKOFF_MAX = 10_000;
/** A socket still CONNECTING after this long is abandoned and retried (some stalls never fire onerror/onclose). */
const ROBOT_CONNECT_TIMEOUT = 5_000;
let robotWs: WebSocket | null = null;
let robotUrl = '';
let robotBackoff = ROBOT_BACKOFF_MIN;
let robotRetryAt = 0;
let robotConnectStartedAt = 0;

function resetRobotLink() {
  robotWs?.close();
  robotWs = null;
  robotUrl = '';
  robotBackoff = ROBOT_BACKOFF_MIN;
  robotRetryAt = 0;
}

function connectRobot(url: string) {
  robotUrl = url;
  robotConnectStartedAt = performance.now();
  robotRetryAt = robotConnectStartedAt + robotBackoff;
  robotBackoff = Math.min(robotBackoff * 2, ROBOT_BACKOFF_MAX);
  try {
    const ws = new WebSocket(url);
    ws.onopen = () => {
      if (ws === robotWs) robotBackoff = ROBOT_BACKOFF_MIN;
    };
    robotWs = ws;
  } catch (e) {
    // Invalid URL (SyntaxError): keep backing off until the user fixes it.
    robotWs = null;
    console.warn('Robot mirror: cannot open', url, e);
  }
}

setInterval(() => {
  const { settings } = usePipeline.getState();
  if (!settings.mirrorRobot) {
    if (robotUrl) resetRobotLink();
    return;
  }
  if (robotUrl && settings.bridgeUrl !== robotUrl) resetRobotLink();
  const now = performance.now();
  if (robotWs?.readyState === WebSocket.CONNECTING && now - robotConnectStartedAt > ROBOT_CONNECT_TIMEOUT) {
    // Stuck handshake: drop it; the backoff already set by connectRobot schedules the retry.
    robotWs.close();
    robotWs = null;
  }
  if (!robotWs || robotWs.readyState === WebSocket.CLOSED) {
    if (now >= robotRetryAt) connectRobot(settings.bridgeUrl);
    return;
  }
  if (robotWs.readyState !== WebSocket.OPEN) return;
  for (const side of ['left', 'right'] as Side[]) {
    const c = live.commands[side];
    if (c) robotWs.send(JSON.stringify({ type: 'robot', side, inspire: toInspireAngles(c.dof) }));
  }
}, 33);
