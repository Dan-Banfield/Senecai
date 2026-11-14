// The ocarina page: two robot hands hold a 12-hole Italian alto (ten holes,
// subholes omitted) with fixed wrists; your calibrated finger flexion covers
// the holes. Free play, lessons, and session-only takes with replay.

import { useEffect, useMemo, useState } from 'react';
import { fingeringFor, midiToName } from '../crafts/ocarina/fingering';
import { scheduleSong, type NoteResult } from '../crafts/ocarina/lesson';
import { OcarinaStage } from '../crafts/ocarina/OcarinaStage';
import { OcarinaSession, useOcarinaUi } from '../crafts/ocarina/session';
import { SONGS } from '../crafts/ocarina/songs';
import { HOLES, type HoleStates } from '../crafts/ocarina/types';
import { calibrationKey, usePipeline } from '../input/pipeline';
import { CalibrationWizard } from '../ui/InputPanel';
import { PipelineStrip } from '../ui/PipelineStrip';
import { WebcamPreview } from '../ui/WebcamPreview';

/** Diagram order, as seen from the player: left hand on the left, index fingers in the middle. */
const TOP_ROW = ['L.little', 'L.ring', 'L.middle', 'L.index', 'R.index', 'R.middle', 'R.ring', 'R.little'];
const BACK_ROW = ['L.thumb', 'R.thumb'];
const holeIndex = (id: string) => HOLES.findIndex((h) => h.id === id);

/** Ten-dot fingering chart: filled = covered. With `target`, holes to cover are outlined and wrong holes ringed. */
export function FingeringDiagram({ holes, target }: { holes: HoleStates; target?: HoleStates }) {
  const dot = (id: string, x: number, y: number, r: number) => {
    const i = holeIndex(id);
    const covered = !!holes[i];
    const want = target?.[i];
    const wrong = target !== undefined && covered !== !!want;
    return (
      <g key={id}>
        <title>{`${id}: ${covered ? 'covered' : 'open'}${target ? (want ? ' (cover)' : ' (lift)') : ''}`}</title>
        {wrong && <circle className="oc-miss" cx={x} cy={y} r={r + 4.5} />}
        <circle className={`oc-hole${covered ? ' covered' : ''}${want ? ' target' : ''}`} cx={x} cy={y} r={r} />
      </g>
    );
  };
  return (
    <svg className="oc-diagram" viewBox="0 0 280 74" role="img" aria-label="Fingering chart">
      <line className="oc-split" x1={140} y1={8} x2={140} y2={66} />
      {TOP_ROW.map((id, k) => dot(id, k < 4 ? 20 + k * 30 : 170 + (k - 4) * 30, 24, 10))}
      {BACK_ROW.map((id, k) => dot(id, k === 0 ? 100 : 180, 58, 7))}
      <text className="oc-label" x={6} y={70}>L</text>
      <text className="oc-label" x={268} y={70}>R</text>
    </svg>
  );
}

const RESULT_CLASS: Record<NoteResult, string> = { pending: '', hit: 'hit', miss: 'miss', rest: 'rest' };
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

function InputCard({ onCalibrate }: { onCalibrate: () => void }) {
  const kind = usePipeline((s) => s.kind);
  const status = usePipeline((s) => s.status);
  const present = usePipeline((s) => s.present);
  const calibrated = usePipeline((s) => !!(s.kind && s.calibrations[calibrationKey(s.kind, 'ocarina')]));
  if (!kind) {
    return (
      <div className="card" style={{ borderColor: 'var(--forest)' }}>
        <h3>Connect your hands</h3>
        <p>
          Best with <b>Rokoko Smartgloves</b>: each finger's bend covers one hole. The webcam glove emulator and the keyboard also work for testing.
        </p>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary small" onClick={() => usePipeline.getState().setPanelOpen(true)}>
            Choose input
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="card">
      <h3>{calibrated ? 'Calibrated for the ocarina' : 'Calibrate for the ocarina'}</h3>
      <p>
        Open your hand fully, then make a fist. A finger covers its hole past about half its range. The wrists are held still; only your fingers count.
      </p>
      {!present.left && !present.right && (
        <p style={{ marginTop: 8, color: 'var(--warn)' }}>No hand detected yet. {status.message}</p>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button className={`btn small ${calibrated ? '' : 'primary'}`} onClick={onCalibrate}>
          {calibrated ? 'Recalibrate' : 'Calibrate'}
        </button>
      </div>
    </div>
  );
}

function FreePlay() {
  const noteName = useOcarinaUi((s) => s.noteName);
  const holes = useOcarinaUi((s) => s.holes);
  return (
    <div className="card">
      <h3>Free play</h3>
      <p>All holes covered is C5; lift right little, ring, middle, index, then the left hand, then the thumbs to climb the scale. Lift everything to stop.</p>
      <div className="oc-note">{noteName ?? '—'}</div>
      <FingeringDiagram holes={holes} />
    </div>
  );
}

function LessonPanel({ session }: { session: OcarinaSession }) {
  const lesson = useOcarinaUi((s) => s.lesson);
  const holes = useOcarinaUi((s) => s.holes);
  const noteName = useOcarinaUi((s) => s.noteName);
  const replaying = useOcarinaUi((s) => s.replaying);
  const [songId, setSongId] = useState(SONGS[0].id);
  const [wait, setWait] = useState(false);
  const song = SONGS.find((s) => s.id === (lesson?.songId ?? songId)) ?? SONGS[0];
  const events = useMemo(() => scheduleSong(song).events, [song]);
  const running = !!lesson && lesson.state !== 'done';
  const target = lesson && lesson.state !== 'done' ? (events[lesson.current]?.midi ?? null) : null;
  const targetHoles = target !== null ? fingeringFor(target) : undefined;
  const from = lesson ? Math.max(0, Math.min(lesson.current - 1, events.length - 8)) : 0;
  const lane = events.slice(from, from + 8);

  return (
    <>
      <div className="card">
        <h3>Lesson</h3>
        <div className="field" style={{ marginTop: 8 }}>
          Song
          <select value={song.id} disabled={running} onChange={(e) => {
              setSongId(e.target.value);
              if (lesson) session.stopLesson();
            }}>
            {SONGS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} · {s.bpm} bpm
              </option>
            ))}
          </select>
        </div>
        <label className="toggle" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={lesson?.wait ?? wait} disabled={running} onChange={(e) => {
              setWait(e.target.checked);
              if (lesson) session.stopLesson();
            }} />
          Wait for me (the melody moves on once you hold the right note)
        </label>
        <div className="row" style={{ marginTop: 12 }}>
          {running ? (
            <button className="btn small" onClick={() => session.stopLesson()}>
              Stop
            </button>
          ) : (
            <button className="btn primary small" disabled={!!replaying} onClick={() => session.startLesson(songId, wait)}>
              {lesson ? 'Play again' : 'Start'}
            </button>
          )}
        </div>
      </div>

      {lesson && (
        <div className="card">
          {lesson.state === 'countin' && <h3>Get ready… {lesson.countIn}</h3>}
          {lesson.state === 'playing' && (
            <h3>
              Play {target === null ? 'nothing (rest)' : midiToName(target)}
              <span style={{ color: 'var(--muted)', fontSize: 14, marginLeft: 10 }}>you: {noteName ?? '—'}</span>
            </h3>
          )}
          {lesson.state === 'done' &&
            (lesson.wait ? (
              <h3>Practice complete</h3>
            ) : (
              <h3>
                {Math.round(lesson.hitPercent)}% <span className="oc-stars">{stars(lesson.stars)}</span>
              </h3>
            ))}
          <div className="oc-lane">
            {lane.map((ev) => (
              <span key={ev.index} className={`oc-lane-note ${RESULT_CLASS[lesson.results[ev.index]]}${ev.index === lesson.current && lesson.state !== 'done' ? ' on' : ''}`}>
                {ev.midi === null ? '·' : midiToName(ev.midi)}
              </span>
            ))}
          </div>
          {targetHoles && <FingeringDiagram holes={holes} target={targetHoles} />}
          <div className="meter" style={{ marginTop: 10 }}>
            <div style={{ width: `${(Math.min(lesson.current, events.length) / events.length) * 100}%` }} />
          </div>
        </div>
      )}
    </>
  );
}

function RecordingCard({ session }: { session: OcarinaSession }) {
  const recording = useOcarinaUi((s) => s.recording);
  const takes = useOcarinaUi((s) => s.takes);
  const replaying = useOcarinaUi((s) => s.replaying);
  const replayingName = takes.find((t) => t.id === replaying)?.name;
  return (
    <div className="card">
      <h3>Takes</h3>
      <p>Takes record your fingers, holes, notes and robot commands. They last until you leave the page.</p>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn small rec" disabled={!!replaying} onClick={() => (recording ? session.stopRecording() : session.startRecording())}>
          {recording ? '■ Stop' : '● Record'}
        </button>
        {replayingName && <span style={{ color: 'var(--lake-hi)', fontSize: 14 }}>Replaying {replayingName}</span>}
      </div>
      {takes.length > 0 && (
        <div className="oc-takes">
          {takes.map((t) => (
            <div key={t.id} className="oc-take">
              <b>{t.name}</b>
              <span className="mono">{(t.durationMs / 1000).toFixed(1)} s</span>
              <div className="spacer" />
              {replaying === t.id ? (
                <button className="btn small" onClick={() => session.stopReplay()}>
                  Stop
                </button>
              ) : (
                <button className="btn small" disabled={recording} onClick={() => session.replay(t.id)}>
                  Replay
                </button>
              )}
              <button className="btn small ghost" onClick={() => session.deleteTake(t.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OcarinaPage() {
  const session = useMemo(() => new OcarinaSession(), []);
  useEffect(() => {
    session.activate();
    return () => session.dispose();
  }, [session]);

  const mode = useOcarinaUi((s) => s.mode);
  const muted = useOcarinaUi((s) => s.muted);
  const audioReady = useOcarinaUi((s) => s.audioReady);
  const tracked = useOcarinaUi((s) => s.tracked);
  const replaying = useOcarinaUi((s) => s.replaying);
  const lesson = useOcarinaUi((s) => s.lesson);
  const kind = usePipeline((s) => s.kind);
  const status = usePipeline((s) => s.status);
  const mirror = usePipeline((s) => s.settings.mirrorRobot);
  const [calibrating, setCalibrating] = useState(false);

  return (
    <div className="workspace">
      <aside className="panel">
        <div>
          <h1>Ocarina</h1>
          <div className="fi">ocarina · Budrio, Italy</div>
          <p style={{ margin: '8px 0 0', color: 'var(--birch-dim)', fontSize: 14 }}>
            Giuseppe Donati's clay vessel flute: each finger seals one hole, and the open area sets the pitch.
          </p>
        </div>

        <InputCard onCalibrate={() => setCalibrating(true)} />

        <div className="tabs">
          <button className={mode === 'free' ? 'on' : ''} onClick={() => session.setMode('free')}>
            Free play
          </button>
          <button className={mode === 'lesson' ? 'on' : ''} onClick={() => session.setMode('lesson')}>
            Lesson
          </button>
        </div>

        {mode === 'free' ? <FreePlay /> : <LessonPanel session={session} />}

        <RecordingCard session={session} />

        <div className="card">
          <div className="row">
            <button className="btn small" onClick={() => session.setMuted(!muted)}>
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <span style={{ fontSize: 13, color: 'var(--birch-dim)' }}>Sound plays whenever a hole is covered.</span>
          </div>
          <p style={{ marginTop: 10, fontSize: 13 }}>
            Robot mirror is {mirror ? 'on' : 'off'} (set it in the{' '}
            <button className="oc-link" onClick={() => usePipeline.getState().setPanelOpen(true)}>
              input panel
            </button>
            ). Replaying a take streams the recorded commands to the robot.
          </p>
        </div>
      </aside>

      <section className="stage">
        <OcarinaStage getView={session.getView} />
        <div className="stage-overlay">
          {lesson?.state === 'countin' && <div className="feedback">{lesson.countIn}</div>}
          {replaying && <div className="oc-stage-tag">Replay</div>}
          {!audioReady && (
            <button className="btn primary oc-sound" onClick={() => session.enableAudio()}>
              Enable sound
            </button>
          )}
          {!replaying && !tracked.left && !tracked.right && (
            <div className="hint">{kind ? `Show your hands to play. (${status.message})` : 'Choose a hand input (Rokoko Smartgloves recommended) to play.'}</div>
          )}
          <WebcamPreview />
          <PipelineStrip dofOverride={replaying ? session.replayDof : undefined} />
        </div>
      </section>
      {calibrating && <CalibrationWizard onClose={() => setCalibrating(false)} />}
    </div>
  );
}
