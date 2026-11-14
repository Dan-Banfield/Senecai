import { Quaternion, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dof6, RobotHandCommand } from '../../robot/retarget';
import { STRING_DOF, type Lesson } from './music';

// Stand-ins for the live pipeline and Web Audio, so the session runs headless.
const pipeline = vi.hoisted(() => ({ cmd: undefined as RobotHandCommand | undefined }));
vi.mock('../../input/pipeline', () => ({
  primaryCommand: () => pipeline.cmd,
  usePipeline: { getState: () => ({ kind: 'keyboard' }) },
}));
vi.mock('./audio', () => ({ pluckString: vi.fn(), unlockAudio: vi.fn() }));

const { KanteleSession, useKanteleUi } = await import('./session');

function command(dof: Dof6): RobotHandCommand {
  return { side: 'right', dof, raw: dof, position: new Vector3(), rotation: new Quaternion(), grip: 0 };
}
function dofWith(curls: Record<number, number>): Dof6 {
  const dof: Dof6 = [0, 0, 0, 0, 0, 0];
  for (const [s, v] of Object.entries(curls)) dof[STRING_DOF[Number(s)]] = v;
  return dof;
}

const LESSON: Lesson = {
  id: 'test',
  title: 'test',
  description: '',
  wait: false,
  notes: [
    { t: 0, string: 1 },
    { t: 1000, string: 2 },
  ],
};

/** Starts a lesson and ticks (open hand) until songTime is just past `target`. */
function startAt(target: number, dt = 20) {
  const s = new KanteleSession({ kind: 'lesson', lesson: LESSON });
  s.activate();
  s.start();
  pipeline.cmd = command(dofWith({}));
  while (s.songTime < target) s.tick(dt);
  return s;
}

describe('KanteleSession', () => {
  beforeEach(() => vi.stubGlobal('window', {}));
  afterEach(() => {
    vi.unstubAllGlobals();
    pipeline.cmd = undefined;
  });

  it('judges a pluck 80 ms before the first note (during the countdown) as a hit', () => {
    const s = startAt(-80);
    expect(useKanteleUi.getState().phase).toBe('countdown');
    expect(s.songTime).toBe(-80);
    pipeline.cmd = command(dofWith({ 1: 0.9 }));
    s.tick(20);
    expect(s.notes[0].result).toBe('perfect');
    expect(useKanteleUi.getState().counts).toEqual({ perfect: 1, good: 0, miss: 0 });
    // Running past the window must not then mark it missed.
    pipeline.cmd = command(dofWith({}));
    for (let i = 0; i < 20; i++) s.tick(20);
    expect(s.notes[0].result).toBe('perfect');
    expect(useKanteleUi.getState().counts.miss).toBe(0);
  });

  it('does not judge plucks earlier in the countdown than the judging window', () => {
    const s = startAt(-600);
    pipeline.cmd = command(dofWith({ 1: 0.9 }));
    s.tick(20);
    expect(s.notes[0].result).toBeUndefined();
    expect(useKanteleUi.getState().done).toBe(0);
  });

  it('does not fire plucks for fingers already curled when the hand reappears', () => {
    const s = startAt(-1000);
    const plucked = vi.spyOn(s as unknown as { onPluck: (str: number, v: number) => void }, 'onPluck');
    // Hand lost, then returns with three fingers curled.
    pipeline.cmd = undefined;
    s.tick(20);
    pipeline.cmd = command(dofWith({ 1: 0.8, 2: 0.8, 3: 0.8 }));
    s.tick(20);
    s.tick(20);
    expect(plucked).not.toHaveBeenCalled();
    // Extending and curling again plucks normally.
    pipeline.cmd = command(dofWith({}));
    s.tick(20);
    pipeline.cmd = command(dofWith({ 1: 0.8 }));
    s.tick(20);
    expect(plucked).toHaveBeenCalledTimes(1);
    expect(plucked.mock.calls[0][0]).toBe(1);
  });
});
