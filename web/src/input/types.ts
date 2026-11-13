import type { RokokoFrame } from '../rokoko/types';

export type SourceKind = 'webcam' | 'gloves' | 'keyboard';

export interface SourceStatus {
  state: 'idle' | 'starting' | 'live' | 'waiting' | 'error';
  message: string;
}

/**
 * Anything that produces Rokoko JSON v3 frames. Every source emits the *same*
 * format the real gloves do, which is what makes the gloves plug-and-play.
 */
export interface HandSource {
  readonly kind: SourceKind;
  start(onFrame: (f: RokokoFrame) => void, onStatus: (s: SourceStatus) => void): Promise<void>;
  stop(): void;
}

export const SOURCE_LABELS: Record<SourceKind, string> = {
  webcam: 'Webcam (glove emulator)',
  gloves: 'Rokoko Smartgloves',
  keyboard: 'Keyboard + mouse',
};
