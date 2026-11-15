// Sound-only song previews: plays the first PREVIEW_MS of a take on its own
// synth (the session's synth is rewritten every tick, so it can't be shared).
// Never touches the stage view or the robot override. The synth (and its
// AudioContext) is only created on the first play().

import { create } from 'zustand';
import { createSynth } from '../audio';
import { sampleTake } from '../recording';
import type { OcarinaSynth, Take } from '../types';
import { PREVIEW_MS, type PreviewPlayer } from './types';

export const usePreview = create<{ previewingId: string | null }>(() => ({ previewingId: null }));

type Handle = unknown;

export interface PreviewDeps {
  now?: () => number;
  schedule?: (cb: () => void) => Handle;
  cancel?: (handle: Handle) => void;
  synth?: OcarinaSynth;
}

const defaultNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const defaultSchedule = (cb: () => void): Handle =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => cb()) : setTimeout(cb, 16);
const defaultCancel = (h: Handle): void => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(h as number);
  else clearTimeout(h as ReturnType<typeof setTimeout>);
};

export function createPreviewPlayer(deps: PreviewDeps = {}): PreviewPlayer {
  const now = deps.now ?? defaultNow;
  const schedule = deps.schedule ?? defaultSchedule;
  const cancel = deps.cancel ?? defaultCancel;
  let synth: OcarinaSynth | null = deps.synth ?? null;
  const ownsSynth = !deps.synth;
  let muted = false;
  let current: { id: string; take: Take; start: number; end: number } | null = null;
  let handle: Handle | null = null;

  const getSynth = (): OcarinaSynth => {
    if (!synth) {
      synth = createSynth();
      synth.setMuted(muted);
    }
    return synth;
  };

  const stop = (): void => {
    if (!current) return;
    current = null;
    if (handle !== null) cancel(handle);
    handle = null;
    synth?.setNote(null);
    usePreview.setState({ previewingId: null });
  };

  const frame = (): void => {
    handle = null;
    const c = current;
    if (!c) return;
    const elapsed = now() - c.start;
    if (elapsed >= c.end) {
      stop();
      return;
    }
    getSynth().setNote(sampleTake(c.take, elapsed)?.midi ?? null);
    handle = schedule(frame);
  };

  return {
    play(id, take) {
      stop();
      const s = getSynth();
      s.unlock(); // synchronous, so it counts as part of the user gesture
      current = { id, take, start: now(), end: Math.min(PREVIEW_MS, take.durationMs) };
      usePreview.setState({ previewingId: id });
      frame();
    },
    stop,
    setMuted(m) {
      muted = m;
      synth?.setMuted(m);
    },
    dispose() {
      stop();
      // Release the AudioContext; a later play() creates a fresh synth.
      if (synth && ownsSynth) {
        synth.dispose();
        synth = null;
      }
    },
  };
}

export const previewPlayer: PreviewPlayer = createPreviewPlayer();
