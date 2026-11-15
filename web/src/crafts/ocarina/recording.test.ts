import { describe, expect, it } from 'vitest';
import type { Dof6 } from '../../robot/retarget';
import { toInspireAngles } from '../../robot/retarget';
import { HoleTracker, pitchOf } from './fingering';
import { cropTake, MIN_CROP_MS, sampleTake, TakePlayer, TakeRecorder } from './recording';
import type { Take, TakeFrame } from './types';

/** A wobbly synthetic performance: fingers sweep through the hysteresis band at different rates. */
const dofAt = (i: number, phase: number): Dof6 =>
  [0, 1, 2, 3, 4, 5].map((j) => 0.5 + 0.5 * Math.sin(i * 0.13 * (j + 1) + phase)) as Dof6;

const FRAME_MS = 12;
const T0 = 1000;

function recordSynthetic(n: number): { take: Take; frames: TakeFrame[] } {
  const rec = new TakeRecorder();
  const tracker = new HoleTracker();
  const frames: TakeFrame[] = [];
  rec.start(T0);
  for (let i = 0; i < n; i++) {
    const dof = i % 50 < 40 ? { left: dofAt(i, 0), right: dofAt(i, 1) } : { right: dofAt(i, 1) };
    const holes = tracker.update(dof);
    const data = {
      dof,
      holes,
      midi: pitchOf(holes),
      inspire: { left: dof.left && toInspireAngles(dof.left), right: toInspireAngles(dof.right) },
    };
    if (!data.inspire.left) delete data.inspire.left;
    rec.frame(T0 + i * FRAME_MS, data);
    frames.push({ t: i * FRAME_MS, ...structuredClone(data) });
  }
  return { take: rec.stop(T0 + n * FRAME_MS)!, frames };
}

describe('take recorder', () => {
  it('replays the same holes and notes frame by frame', () => {
    const { take, frames } = recordSynthetic(300);
    expect(take.frames).toEqual(frames);
    expect(new Set(frames.map((f) => f.midi)).size).toBeGreaterThan(3);

    for (const f of frames) expect(sampleTake(take, f.t)).toEqual(f);

    const player = new TakePlayer(take);
    let checked = 0;
    while (!player.done) {
      const out = player.tick(5);
      const f = frames[Math.min(Math.floor(player.time / FRAME_MS), frames.length - 1)];
      expect(out).toEqual(f);
      if (player.time % FRAME_MS === 0) {
        expect(out!.holes).toEqual(f.holes);
        expect(out!.midi).toBe(f.midi);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('names takes in order with unique ids', () => {
    const rec = new TakeRecorder();
    const takes = [0, 1, 2].map(() => {
      rec.start(0);
      rec.frame(5, { dof: {}, holes: [], midi: null, inspire: {} });
      return rec.stop(10)!;
    });
    expect(takes.map((t) => t.name)).toEqual(['Take 1', 'Take 2', 'Take 3']);
    expect(new Set(takes.map((t) => t.id)).size).toBe(3);
  });

  it('returns null for an empty take and ignores frames when stopped', () => {
    const rec = new TakeRecorder();
    rec.frame(0, { dof: {}, holes: [], midi: null, inspire: {} });
    expect(rec.recording).toBe(false);
    rec.start(0);
    expect(rec.recording).toBe(true);
    expect(rec.stop(100)).toBeNull();
    expect(rec.recording).toBe(false);
    rec.start(0);
    rec.frame(1, { dof: {}, holes: [true], midi: 72, inspire: {} });
    const take = rec.stop(100)!;
    expect(take.name).toBe('Take 1');
    expect(take.durationMs).toBe(100);
  });

  it('stores deep copies', () => {
    const rec = new TakeRecorder();
    const dof: Dof6 = [0, 1, 1, 1, 1, 1];
    const holes = [true, false];
    const angles = [1, 2, 3, 4, 5, 6];
    const data = { dof: { left: dof }, holes, midi: 72, inspire: { left: angles } };
    rec.start(0);
    rec.frame(10, data);
    dof[2] = 0;
    holes[0] = false;
    angles[0] = 999;
    (data.dof as Record<string, Dof6>).right = dof;
    const take = rec.stop(20)!;
    expect(take.frames[0]).toEqual({ t: 10, dof: { left: [0, 1, 1, 1, 1, 1] }, holes: [true, false], midi: 72, inspire: { left: [1, 2, 3, 4, 5, 6] } });
  });
});

describe('sampleTake', () => {
  const frame = (t: number): TakeFrame => ({ t, dof: {}, holes: [], midi: t, inspire: {} });
  const take: Take = { id: 'x', name: 'x', createdAt: 0, durationMs: 40, frames: [10, 20, 20, 30].map(frame) };

  it('is undefined before the first frame', () => {
    expect(sampleTake(take, 9.99)).toBeUndefined();
    expect(sampleTake({ ...take, frames: [] }, 100)).toBeUndefined();
  });

  it('picks the latest frame at or before t', () => {
    expect(sampleTake(take, 10)).toBe(take.frames[0]);
    expect(sampleTake(take, 19)).toBe(take.frames[0]);
    expect(sampleTake(take, 20)).toBe(take.frames[2]);
    expect(sampleTake(take, 29.9)).toBe(take.frames[2]);
    expect(sampleTake(take, 30)).toBe(take.frames[3]);
    expect(sampleTake(take, 1e9)).toBe(take.frames[3]);
  });

  it('player is done only past the duration', () => {
    const p = new TakePlayer(take);
    expect(p.tick(5)).toBeUndefined();
    p.tick(35);
    expect(p.time).toBe(40);
    expect(p.done).toBe(false);
    expect(p.tick(1)).toBe(take.frames[3]);
    expect(p.done).toBe(true);
  });
});

describe('cropTake', () => {
  it('keeps the selected span, re-timed from 0, looking exactly like the original', () => {
    const { take } = recordSynthetic(300); // 3600 ms
    const crop = cropTake(take, 1005, 2500);
    expect(crop.id).not.toBe(take.id);
    expect(crop.name).toBe(take.name);
    expect(crop.durationMs).toBe(1495);
    expect(crop.frames[0].t).toBe(0);
    for (const t of [0, 1, 7, 500, 1000, 1495]) expect(sampleTake(crop, t)).toEqual({ ...sampleTake(take, t + 1005)!, t: sampleTake(crop, t)!.t });
    expect(crop.frames.every((f, i) => i === 0 || f.t >= crop.frames[i - 1].t)).toBe(true);
    expect(take.frames).toHaveLength(300); // original untouched
  });

  it('clamps to the take and never leaves less than the minimum', () => {
    const { take } = recordSynthetic(100); // 1200 ms
    expect(cropTake(take, -50, 99999).durationMs).toBe(take.durationMs);
    expect(cropTake(take, 600, 600).durationMs).toBe(MIN_CROP_MS);
  });
});
