import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OcarinaSynth, Take, TakeFrame } from '../types';
import { HOLES } from '../types';
import { createPreviewPlayer, usePreview } from './preview';
import { PREVIEW_MS } from './types';

// The real synth needs WebAudio: the lazily created one is a recording fake.
const mocks = vi.hoisted(() => ({ created: [] as { notes: (number | null)[]; muted: boolean[]; unlocks: number }[] }));

vi.mock('../audio', () => ({
  createSynth: () => {
    const rec = { notes: [] as (number | null)[], muted: [] as boolean[], unlocks: 0 };
    mocks.created.push(rec);
    return {
      unlock: () => void rec.unlocks++,
      setNote: (m: number | null) => void rec.notes.push(m),
      setMuted: (m: boolean) => void rec.muted.push(m),
      muted: false,
      ready: true,
      dispose: () => {},
    };
  },
}));

function fakeSynth() {
  const notes: (number | null)[] = [];
  const synth: OcarinaSynth & { notes: typeof notes; unlocks: number; mutedCalls: boolean[] } = {
    notes,
    unlocks: 0,
    mutedCalls: [],
    unlock() {
      this.unlocks++;
    },
    setNote: (m) => void notes.push(m),
    setMuted(m) {
      this.mutedCalls.push(m);
    },
    muted: false,
    ready: true,
    dispose: () => {},
  };
  return synth;
}

/** A manual clock + frame scheduler: step(ms) advances time and runs the pending frame. */
function fakeLoop() {
  let t = 1000;
  let pending: (() => void) | null = null;
  let nextHandle = 0;
  let pendingHandle = -1;
  const cancelled: unknown[] = [];
  return {
    now: () => t,
    schedule: (cb: () => void) => {
      pending = cb;
      pendingHandle = ++nextHandle;
      return pendingHandle;
    },
    cancel: (h: unknown) => {
      cancelled.push(h);
      if (h === pendingHandle) pending = null;
    },
    step(ms: number) {
      t += ms;
      const cb = pending;
      pending = null;
      cb?.();
    },
    get pending() {
      return pending !== null;
    },
    cancelled,
  };
}

/** A take that holds each midi for 1 s, starting at t = 0. */
function take(id: string, midis: (number | null)[], durationMs = midis.length * 1000): Take {
  const frames: TakeFrame[] = midis.map((midi, i) => ({
    t: i * 1000,
    dof: {},
    holes: HOLES.map(() => true),
    midi,
    inspire: {},
  }));
  return { id, name: id, createdAt: 0, durationMs, frames };
}

beforeEach(() => {
  mocks.created.length = 0;
  usePreview.setState({ previewingId: null });
});

describe('createPreviewPlayer', () => {
  it('plays notes sampled from the take and unlocks audio on play', () => {
    const synth = fakeSynth();
    const loop = fakeLoop();
    const p = createPreviewPlayer({ synth, ...loop });
    p.play('a', take('a', [72, 74, null, 76]));
    expect(synth.unlocks).toBe(1);
    expect(usePreview.getState().previewingId).toBe('a');
    expect(synth.notes).toEqual([72]);
    loop.step(500);
    loop.step(600); // 1.1 s
    loop.step(1000); // 2.1 s
    loop.step(1000); // 3.1 s
    expect(synth.notes).toEqual([72, 72, 74, null, 76]);
  });

  it(`stops by itself at PREVIEW_MS (${PREVIEW_MS} ms)`, () => {
    const synth = fakeSynth();
    const loop = fakeLoop();
    const p = createPreviewPlayer({ synth, ...loop });
    p.play('long', take('long', Array.from({ length: 20 }, () => 79)));
    loop.step(PREVIEW_MS - 1);
    expect(usePreview.getState().previewingId).toBe('long');
    expect(synth.notes.at(-1)).toBe(79);
    loop.step(1);
    expect(usePreview.getState().previewingId).toBeNull();
    expect(synth.notes.at(-1)).toBeNull();
    expect(loop.pending).toBe(false);
  });

  it('stops at the take duration when it is shorter than PREVIEW_MS', () => {
    const synth = fakeSynth();
    const loop = fakeLoop();
    const p = createPreviewPlayer({ synth, ...loop });
    p.play('short', take('short', [72, 74], 2000));
    loop.step(1999);
    expect(usePreview.getState().previewingId).toBe('short');
    loop.step(1);
    expect(usePreview.getState().previewingId).toBeNull();
    expect(synth.notes.at(-1)).toBeNull();
  });

  it('playing another song stops the first', () => {
    const synth = fakeSynth();
    const loop = fakeLoop();
    const p = createPreviewPlayer({ synth, ...loop });
    p.play('a', take('a', [72, 72]));
    loop.step(100);
    p.play('b', take('b', [88, 88]));
    expect(loop.cancelled).toHaveLength(1);
    expect(usePreview.getState().previewingId).toBe('b');
    expect(synth.notes).toEqual([72, 72, null, 88]);
    loop.step(100);
    expect(synth.notes.at(-1)).toBe(88);
  });

  it('stop() silences and is idempotent', () => {
    const synth = fakeSynth();
    const loop = fakeLoop();
    const p = createPreviewPlayer({ synth, ...loop });
    p.stop(); // idle: no-op
    expect(synth.notes).toEqual([]);
    p.play('a', take('a', [72]));
    p.stop();
    p.stop();
    expect(synth.notes).toEqual([72, null]);
    expect(usePreview.getState().previewingId).toBeNull();
    expect(loop.pending).toBe(false);
  });

  it('creates its synth lazily, applying an earlier setMuted', () => {
    const loop = fakeLoop();
    const p = createPreviewPlayer(loop);
    p.setMuted(true);
    expect(mocks.created).toHaveLength(0);
    p.play('a', take('a', [72]));
    expect(mocks.created).toHaveLength(1);
    const rec = mocks.created[0];
    expect(rec.muted).toEqual([true]);
    expect(rec.unlocks).toBe(1);
    expect(rec.notes).toEqual([72]);
    p.setMuted(false);
    expect(rec.muted).toEqual([true, false]);
  });

  it('dispose() stops and a later play() makes a fresh synth', () => {
    const loop = fakeLoop();
    const p = createPreviewPlayer(loop);
    p.play('a', take('a', [72]));
    p.dispose();
    expect(usePreview.getState().previewingId).toBeNull();
    expect(mocks.created[0].notes).toEqual([72, null]);
    p.play('a', take('a', [74]));
    expect(mocks.created).toHaveLength(2);
    expect(mocks.created[1].notes).toEqual([74]);
  });
});
