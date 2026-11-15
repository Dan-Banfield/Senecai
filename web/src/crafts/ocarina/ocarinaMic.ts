// Microphone input for the real ocarina (the only way notes sound live): getUserMedia -> AnalyserNode,
// read once per animation frame into a ToneDetector. Own AudioContext, kept
// apart from the synth's so stopping the mic never touches playback.
//
// Browser processing is turned off: echo cancellation and noise suppression
// treat a steady tone as something to remove, and auto gain would move the
// level the noise floor was learned at.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_MIN_DB, ToneDetector, toneFeatures, type ToneReading } from './tone';

export type MicStatus = 'off' | 'starting' | 'on' | 'denied' | 'error';

/** Persisted listening settings (slow UI state). */
export interface ListenPrefs {
  /** 0..1, see ToneDetector.sensitivity. */
  sensitivity: number;
  /** Hard minimum level in dBFS (MIN_DB_RANGE), see ToneDetector.minDb. */
  minDb: number;
  setSensitivity(v: number): void;
  setMinDb(v: number): void;
}

/** Range of the minimum-level slider (dBFS). */
export const MIN_DB_RANGE = { min: -100, max: -20 } as const;
const clampMinDb = (v: number) => (Number.isFinite(v) ? Math.min(MIN_DB_RANGE.max, Math.max(MIN_DB_RANGE.min, v)) : DEFAULT_MIN_DB);

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);

export const useListenPrefs = create<ListenPrefs>()(
  persist(
    (set) => ({
      sensitivity: 0.5,
      minDb: DEFAULT_MIN_DB,
      setSensitivity: (v) => set({ sensitivity: clamp01(v) }),
      setMinDb: (v) => set({ minDb: clampMinDb(v) }),
    }),
    {
      name: 'senecai.ocarina.listen.v1',
      partialize: (s) => ({ sensitivity: s.sensitivity, minDb: s.minDb }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { sensitivity?: unknown; minDb?: unknown };
        return {
          ...current,
          sensitivity: typeof p.sensitivity === 'number' ? clamp01(p.sensitivity) : 0.5,
          minDb: typeof p.minDb === 'number' ? clampMinDb(p.minDb) : DEFAULT_MIN_DB,
        };
      },
    },
  ),
);

const FFT_SIZE = 2048;

export class OcarinaMic {
  readonly detector = new ToneDetector();
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  /** Bumped by every start/stop so a late getUserMedia answer can tell it is stale. */
  private gen = 0;
  private _status: MicStatus = 'off';
  /** Last reading, for meters. */
  last: ToneReading | null = null;
  onStatus: (s: MicStatus) => void = () => {};

  get status(): MicStatus {
    return this._status;
  }

  private setStatus(s: MicStatus): void {
    if (s === this._status) return;
    this._status = s;
    this.onStatus(s);
  }

  async start(): Promise<void> {
    if (this._status === 'on' || this._status === 'starting') return;
    const gen = ++this.gen;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      this.setStatus('error');
      return;
    }
    this.setStatus('starting');
    // Create the context now: when start() runs from a click this counts as the user gesture.
    const ctx = new AudioContext();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (gen !== this.gen) {
        for (const t of stream.getTracks()) t.stop();
        ctx.close().catch(() => {});
        return;
      }
      const analyser = new AnalyserNode(ctx, { fftSize: FFT_SIZE, smoothingTimeConstant: 0.3 });
      ctx.createMediaStreamSource(stream).connect(analyser);
      this.ctx = ctx;
      this.stream = stream;
      this.analyser = analyser;
      this.buf = new Float32Array(analyser.frequencyBinCount);
      this.detector.reset();
      this.resume();
      this.setStatus('on');
    } catch (e) {
      ctx.close().catch(() => {});
      if (gen !== this.gen) return;
      const name = e instanceof DOMException ? e.name : '';
      this.setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
    }
  }

  stop(): void {
    this.gen++;
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.buf = null;
    this.last = null;
    this.setStatus('off');
  }

  /** Resume a context the browser kept suspended (call from a user gesture). */
  resume(): void {
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  /** One detector step; null while the mic is not delivering audio. */
  read(dtMs: number): ToneReading | null {
    const { analyser, buf, ctx } = this;
    if (!analyser || !buf || !ctx || ctx.state !== 'running') return (this.last = null);
    analyser.getFloatFrequencyData(buf);
    this.last = this.detector.update(toneFeatures(buf, ctx.sampleRate / FFT_SIZE), dtMs);
    return this.last;
  }
}
