import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dof6, RobotHandCommand } from '../../robot/retarget';
import { toInspireAngles } from '../../robot/retarget';
import type { Side } from '../../rokoko/types';
import { useHoleCalibration } from './holeCalibration';
import { OcarinaSession, useOcarinaUi } from './session';
import { HOLES, SCALE_MIDI, type Take, type TakeFrame } from './types';

// No browser here: stub the pipeline (its module sets up timers and sources) and the WebAudio synth.
const mocks = vi.hoisted(() => {
  const synth = { notes: [] as (number | null)[], muted: false };
  return {
    live: { commands: {} as Partial<Record<'left' | 'right', { dof: number[] }>> },
    override: null as null | (() => unknown),
    overrideCalls: [] as (null | 'fn')[],
    contexts: [] as string[],
    synth,
    /** Whether the fake mic hears the real ocarina. */
    mic: { sounding: true },
  };
});

// The real ocarina is heard through a fake mic (no getUserMedia here).
vi.mock('./ocarinaMic', () => ({
  useListenPrefs: { getState: () => ({ sensitivity: 0.5, minDb: -55 }), subscribe: () => () => {} },
  OcarinaMic: class {
    detector = { sensitivity: 0.5, minDb: -55 };
    status = 'on';
    last = null;
    onStatus = () => {};
    start = async () => {};
    stop = () => {};
    resume = () => {};
    read = () => ({ sounding: mocks.mic.sounding, strength: 1, midi: null, peakDb: -30, floorDb: -90, thresholdDb: -55 });
  },
}));

vi.mock('../../input/pipeline', () => ({
  live: mocks.live,
  setRobotOverride: (fn: null | (() => unknown)) => {
    mocks.override = fn;
    mocks.overrideCalls.push(fn ? 'fn' : null);
  },
  usePipeline: {
    getState: () => ({ kind: 'gloves', settings: { dominant: 'right' }, setCalibrationContext: (c: string) => mocks.contexts.push(c) }),
    subscribe: () => () => {},
  },
}));

vi.mock('./audio', () => ({
  createSynth: () => ({
    unlock: () => {},
    setNote: (m: number | null) => mocks.synth.notes.push(m),
    setMuted: (m: boolean) => {
      mocks.synth.muted = m;
    },
    get muted() {
      return mocks.synth.muted;
    },
    ready: true,
    dispose: () => {},
  }),
}));


/** Flexion that covers every hole except the first `open` holes of the lift order. */
function dofFor(open: number): Partial<Record<Side, Dof6>> {
  const out: Record<Side, Dof6> = { left: [0, 0, 0, 0, 0, 0], right: [0, 0, 0, 0, 0, 0] };
  HOLES.forEach((h, i) => {
    out[h.side][h.dofIndex] = i < open ? 0.1 : 0.9;
  });
  return out;
}

function setLive(dof: Partial<Record<Side, Dof6>>) {
  mocks.live.commands = {};
  for (const side of ['left', 'right'] as const) {
    const d = dof[side];
    if (d) mocks.live.commands[side] = { dof: d } as unknown as RobotHandCommand;
  }
}

beforeEach(() => {
  mocks.live.commands = {};
  mocks.override = null;
  mocks.overrideCalls.length = 0;
  mocks.contexts.length = 0;
  mocks.synth.notes.length = 0;
  mocks.mic.sounding = true;
  useOcarinaUi.setState(useOcarinaUi.getInitialState(), true);
});

afterEach(() => vi.unstubAllGlobals());

describe('OcarinaSession live', () => {
  it('is silent with no hand tracked', () => {
    const s = new OcarinaSession();
    s.tick(16);
    expect(s.getView().midi).toBeNull();
    expect(s.getView().holes.every((h) => !h)).toBe(true);
    expect(mocks.synth.notes.at(-1)).toBeNull();
  });

  it('plays the standard scale from finger flexion while the real ocarina is heard', () => {
    const s = new OcarinaSession();
    const expected = [72, 74, 76, 77, 79, 81, 83, 84, 86, 88, null];
    expected.forEach((midi, open) => {
      setLive(dofFor(open));
      s.tick(16);
      expect(s.getView().midi).toBe(midi);
      // The real instrument is the sound: the synth stays quiet live.
      expect(mocks.synth.notes.at(-1)).toBeNull();
    });
  });

  it('is silent while the mic does not hear the real ocarina', () => {
    const s = new OcarinaSession();
    mocks.mic.sounding = false;
    setLive(dofFor(3));
    s.tick(16);
    expect(s.getView().midi).toBeNull();
    mocks.mic.sounding = true;
    s.tick(16);
    expect(s.getView().midi).toBe(77);
  });

  it('publishes note and hole changes to the UI store', () => {
    const s = new OcarinaSession();
    setLive(dofFor(4));
    s.tick(100);
    const ui = useOcarinaUi.getState();
    expect(ui.midi).toBe(79);
    expect(ui.noteName).toBe('G5');
    expect(ui.holes).toEqual(HOLES.map((_, i) => i >= 4));
    expect(ui.tracked).toEqual({ left: true, right: true });
  });

  it('runs a wait-mode lesson to completion when the right notes are held', () => {
    const s = new OcarinaSession();
    s.startLesson('scale', true);
    expect(useOcarinaUi.getState().lesson?.state).toBe('countin');
    const scale = [72, 74, 76, 77, 79, 81, 83, 84, 86, 88];
    const target = [...scale, 86, 84, 83, 81, 79, 77, 76, 74, 72];
    for (let i = 0; i < 2000 && useOcarinaUi.getState().lesson?.state !== 'done'; i++) {
      const midi = s.targetMidi;
      setLive(dofFor(midi === null ? 0 : scale.indexOf(midi)));
      s.tick(50);
    }
    const lesson = useOcarinaUi.getState().lesson!;
    expect(lesson.state).toBe('done');
    expect(lesson.results).toEqual(target.map(() => 'hit'));
  });
});

describe('OcarinaSession lessons from any song', () => {
  it('starts a lesson from a Song object at a given speed', () => {
    const s = new OcarinaSession();
    const song = { id: 'lib:x', title: 'X', bpm: 120, beatsPerBar: 4, notes: [{ note: 'C5', beats: 1 }] };
    s.startLesson(song, false, 0.5);
    const lesson = useOcarinaUi.getState().lesson!;
    expect(lesson.songId).toBe('lib:x');
    expect(lesson.countIn).toBe(4);
    // At half speed a beat is 1000 ms: after 1.5 s of the 4 s count-in, 2.5 s (3 beats) remain.
    s.tick(100);
    for (let i = 0; i < 14; i++) s.tick(100);
    expect(useOcarinaUi.getState().lesson!.countIn).toBe(3);
  });

  it('refuses a song with no notes', () => {
    const s = new OcarinaSession();
    expect(() => s.startLesson({ id: 'e', title: 'E', bpm: 120, beatsPerBar: 4, notes: [] }, false)).toThrow();
  });
});

describe('OcarinaSession recording and replay', () => {
  it('records frames and replays them, driving the robot override', () => {
    const s = new OcarinaSession();
    s.startRecording();
    const opens = [0, 1, 2, 3, 2, 1, 0];
    for (const open of opens) {
      setLive(dofFor(open));
      s.tick(20);
    }
    const take = s.stopRecording()!;
    expect(take.frames).toHaveLength(opens.length);
    expect(take.frames[2].midi).toBe(76);
    expect(take.frames[2].inspire.right).toEqual(toInspireAngles(dofFor(2).right!));
    expect(useOcarinaUi.getState().takes).toEqual([{ id: take.id, name: take.name, durationMs: take.durationMs }]);

    // Live input is ignored during replay.
    setLive(dofFor(9));
    s.replay(take.id);
    expect(s.replaying).toBe(true);
    expect(useOcarinaUi.getState().replaying).toBe(take.id);
    expect(mocks.override).not.toBeNull();

    // Frames are stamped after each 20 ms step, so replay samples them at the same times.
    const seen: (number | null)[] = [];
    for (let i = 0; i < opens.length; i++) {
      s.tick(20);
      seen.push(s.getView().midi);
      expect(s.getView().holes).toEqual(take.frames[i].holes);
      expect(mocks.override!()).toEqual(take.frames[i].inspire);
      expect(s.replayDof()).toEqual(take.frames[i].dof.right);
    }
    expect(seen).toEqual(take.frames.map((f) => f.midi));

    // Recording and lessons are disabled while replaying.
    s.startRecording();
    expect(useOcarinaUi.getState().recording).toBe(false);
    s.startLesson('scale', false);
    expect(useOcarinaUi.getState().lesson).toBeNull();

    // Runs past the end: replay stops (releasing the replayed note), the robot goes back to live, and live input takes over in the same frame.
    s.tick(100);
    expect(s.replaying).toBe(false);
    expect(mocks.override).toBeNull();
    expect(useOcarinaUi.getState().replaying).toBeNull();
    expect(mocks.synth.notes.slice(-2)).toEqual([null, null]); // live, the synth stays quiet (the real ocarina sounds)
    expect(s.getView().midi).toBe(88);

    // Back to live input.
    s.tick(16);
    expect(s.getView().midi).toBe(88);
  });

  it('deleting the replaying take stops the replay', () => {
    const s = new OcarinaSession();
    setLive(dofFor(0));
    s.startRecording();
    s.tick(16);
    s.tick(16);
    const take = s.stopRecording()!;
    s.replay(take.id);
    s.deleteTake(take.id);
    expect(s.replaying).toBe(false);
    expect(mocks.override).toBeNull();
    expect(useOcarinaUi.getState().takes).toEqual([]);
  });
});

/** An external (e.g. market) take: each entry of `opens` held for 50 ms. */
function externalTake(id: string, opens: number[]): Take {
  const frames: TakeFrame[] = opens.map((open, i) => {
    const dof = dofFor(open);
    return {
      t: i * 50,
      dof,
      holes: HOLES.map((_, h) => h >= open),
      midi: SCALE_MIDI[open],
      inspire: { left: toInspireAngles(dof.left!), right: toInspireAngles(dof.right!) },
    };
  });
  return { id, name: id, createdAt: 0, durationMs: opens.length * 50, frames };
}

describe('OcarinaSession replayTake (market songs)', () => {
  it('replays a take outside the take list and ends by itself', () => {
    const s = new OcarinaSession();
    const take = externalTake('song-take', [0, 2, 4]);
    setLive(dofFor(9));
    s.replayTake(take, 'market:ode');
    expect(s.replaying).toBe(true);
    expect(useOcarinaUi.getState().replaying).toBe('market:ode');
    expect(useOcarinaUi.getState().takes).toEqual([]);

    for (let i = 0; i < 3; i++) {
      s.tick(i === 0 ? 10 : 50);
      expect(s.getView().midi).toBe(take.frames[i].midi);
      expect(s.getView().holes).toEqual(take.frames[i].holes);
      expect(s.getView().dof.right).toEqual(take.frames[i].dof.right);
      expect(mocks.synth.notes.at(-1)).toBe(take.frames[i].midi);
      expect(mocks.override!()).toEqual(take.frames[i].inspire);
    }

    s.tick(100);
    expect(s.replaying).toBe(false);
    expect(useOcarinaUi.getState().replaying).toBeNull();
    expect(mocks.override).toBeNull();
    expect(s.getView().midi).toBe(88); // live input again
  });

  it('is refused while recording', () => {
    const s = new OcarinaSession();
    setLive(dofFor(0));
    s.startRecording();
    s.tick(16);
    s.replayTake(externalTake('x', [1]), 'market:x');
    expect(s.replaying).toBe(false);
    expect(useOcarinaUi.getState()).toMatchObject({ replaying: null, recording: true });
    expect(mocks.overrideCalls).toEqual([]);

    // Session takes are refused too (recording is not stopped).
    s.tick(16);
    const take = s.stopRecording()!;
    s.startRecording();
    s.replay(take.id);
    expect(s.replaying).toBe(false);
    expect(useOcarinaUi.getState().recording).toBe(true);
  });

  it('switches cleanly between replays', () => {
    const s = new OcarinaSession();
    setLive(dofFor(0));
    s.startRecording();
    s.tick(16);
    s.tick(16);
    const own = s.stopRecording()!;

    s.replay(own.id);
    s.tick(16);
    s.replayTake(externalTake('m', [5, 5]), 'market:m');
    expect(useOcarinaUi.getState().replaying).toBe('market:m');
    expect(mocks.overrideCalls).toEqual(['fn', null, 'fn']);
    s.tick(10);
    expect(s.getView().midi).toBe(SCALE_MIDI[5]);

    s.replay(own.id);
    expect(useOcarinaUi.getState().replaying).toBe(own.id);
    s.tick(16);
    expect(s.getView().midi).toBe(own.frames[0].midi);
  });

  it('deleting an unrelated take does not stop a market replay', () => {
    const s = new OcarinaSession();
    setLive(dofFor(0));
    s.startRecording();
    s.tick(16);
    const own = s.stopRecording()!;
    // Same underlying take id as a session take, different replay id.
    s.replayTake(externalTake(own.id, [3, 3]), 'market:y');
    s.deleteTake(own.id);
    expect(s.replaying).toBe(true);
    expect(useOcarinaUi.getState().replaying).toBe('market:y');
    expect(mocks.override).not.toBeNull();
  });
});

describe('OcarinaSession lifecycle', () => {
  it('activate/dispose set the calibration context, run the loop, and clear the robot override', () => {
    const win = new EventTarget();
    const raf = vi.fn(() => 7);
    const caf = vi.fn();
    vi.stubGlobal('window', win);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);

    const s = new OcarinaSession();
    s.activate();
    expect(mocks.contexts).toEqual(['ocarina']);
    expect(raf).toHaveBeenCalledTimes(1);

    // The loop clamps long frames.
    const loop = (raf.mock.calls[0] as unknown as [(t: number) => void])[0];
    s.startLesson('scale', false);
    loop(performance.now() + 5000);
    // 3 s count-in (4 beats at 80 bpm): unclamped, 5 s would have finished it.
    expect(useOcarinaUi.getState().lesson).toMatchObject({ state: 'countin', countIn: 4 });

    s.setMode('free');
    setLive(dofFor(0));
    s.startRecording();
    s.tick(16);
    const take = s.stopRecording()!;
    s.replay(take.id);
    s.dispose();
    expect(caf).toHaveBeenCalledWith(7);
    expect(mocks.override).toBeNull();
    expect(mocks.contexts).toEqual(['ocarina', 'default']);

    // StrictMode re-activation of the same session works.
    s.activate();
    expect(mocks.contexts).toEqual(['ocarina', 'default', 'ocarina']);
    expect(useOcarinaUi.getState().takes).toHaveLength(1);
    s.dispose();
  });
});

describe('OcarinaSession recording count-in and crop', () => {
  it('counts in for 3 s before recording, and can be cancelled', () => {
    const s = new OcarinaSession();
    setLive(dofFor(0));
    s.startRecordingCountdown();
    expect(useOcarinaUi.getState().recCountdown).toBe(3);
    for (let i = 0; i < 15; i++) s.tick(100); // 1.5 s
    expect(useOcarinaUi.getState()).toMatchObject({ recording: false, recCountdown: 2 });
    for (let i = 0; i < 15; i++) s.tick(100); // 3 s
    expect(useOcarinaUi.getState()).toMatchObject({ recording: true, recCountdown: null });
    s.tick(16);
    expect(s.stopRecording()?.frames.length).toBeGreaterThan(0);

    s.startRecordingCountdown();
    s.tick(100);
    s.cancelRecordingCountdown();
    for (let i = 0; i < 40; i++) s.tick(100);
    expect(useOcarinaUi.getState()).toMatchObject({ recording: false, recCountdown: null });
  });

  it('crops a take in place under a new id', () => {
    const s = new OcarinaSession();
    s.startRecording();
    for (let i = 0; i < 20; i++) {
      setLive(dofFor(i < 10 ? 0 : 3));
      s.tick(50);
    }
    const take = s.stopRecording()!;
    const cropped = s.cropTake(take.id, 500, 900)!;
    expect(cropped.durationMs).toBe(400);
    expect(s.getTakes().map((t) => t.id)).toEqual([cropped.id]);
    expect(useOcarinaUi.getState().takes).toEqual([{ id: cropped.id, name: take.name, durationMs: 400 }]);
    expect(s.cropTake('nope', 0, 100)).toBeNull();
  });
});

describe('OcarinaSession hole calibration', () => {
  it('applies the saved calibration for the current source, live', () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const light = (v: number): Dof6 => [0, v, v, v, v, v];
    const s = new OcarinaSession();
    s.activate();
    setLive({ left: light(0.15), right: light(0.15) });
    s.tick(16);
    expect(s.getView().holes.some(Boolean)).toBe(false);

    useHoleCalibration.getState().save('gloves', { open: HOLES.map(() => 0.02), covered: HOLES.map(() => 0.2) });
    s.tick(16);
    expect(s.getView().holes.every(Boolean)).toBe(true);
    expect(s.getView().coverOn?.[0]).toBeCloseTo(0.11);

    useHoleCalibration.getState().clear('gloves');
    setLive({ left: light(0.05), right: light(0.05) });
    s.tick(16);
    expect(s.getView().holes.some(Boolean)).toBe(false);
    s.dispose();
  });
});

describe('OcarinaSession playback controls', () => {
  it('pauses (hands hold, sound off), resumes, seeks and honours the playback rate', () => {
    const s = new OcarinaSession();
    s.replayTake(externalTake('m', [0, 1, 2, 3, 4, 5, 6, 7]), 'm');
    expect(useOcarinaUi.getState().replayDurationMs).toBe(400);

    s.tick(60);
    expect(s.replayTime).toBe(60);
    expect(s.getView().midi).toBe(SCALE_MIDI[1]);

    s.setReplayPaused(true);
    expect(useOcarinaUi.getState().replayPaused).toBe(true);
    s.tick(100);
    expect(s.replayTime).toBe(60);
    expect(s.getView().midi).toBeNull();
    expect(s.getView().holes).toEqual(HOLES.map((_, h) => h >= 1));

    s.seekReplay(210);
    s.tick(16);
    expect(s.replayTime).toBe(210);
    expect(s.getView().holes).toEqual(HOLES.map((_, h) => h >= 4));

    s.setReplayPaused(false);
    s.setPlaybackRate(0.5);
    s.tick(40);
    expect(s.replayTime).toBe(230);
    expect(s.getView().midi).toBe(SCALE_MIDI[4]);

    s.stopReplay();
    const ui = useOcarinaUi.getState();
    expect(ui.replaying).toBeNull();
    expect(ui.replayPaused).toBe(false);
    expect(ui.replayDurationMs).toBe(0);
  });

  it('a new replay starts unpaused', () => {
    const s = new OcarinaSession();
    s.replayTake(externalTake('a', [0, 1, 2]), 'a');
    s.setReplayPaused(true);
    s.replayTake(externalTake('b', [0, 1, 2]), 'b');
    expect(useOcarinaUi.getState().replayPaused).toBe(false);
    s.tick(30);
    expect(s.replayTime).toBe(30);
  });
});

describe('OcarinaSession recording is free play only', () => {
  it('refuses to record in lesson mode', () => {
    const s = new OcarinaSession();
    s.setMode('lesson');
    s.startRecording();
    s.startRecordingCountdown();
    expect(useOcarinaUi.getState().recording).toBe(false);
    expect(useOcarinaUi.getState().recCountdown).toBeNull();
  });

  it('entering a lesson stops a recording (keeping the take) and cancels a count-in', () => {
    const s = new OcarinaSession();
    setLive(dofFor(2));
    s.startRecording();
    s.tick(16);
    s.tick(16);
    s.startLesson('scale', false);
    expect(useOcarinaUi.getState().recording).toBe(false);
    expect(s.getTakes()).toHaveLength(1);

    s.setMode('free');
    s.startRecordingCountdown();
    expect(useOcarinaUi.getState().recCountdown).not.toBeNull();
    s.setMode('lesson');
    expect(useOcarinaUi.getState().recCountdown).toBeNull();
    s.tick(5000);
    expect(useOcarinaUi.getState().recording).toBe(false);
  });
});
