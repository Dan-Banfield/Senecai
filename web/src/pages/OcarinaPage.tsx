// The ocarina page: two robot hands hold a 12-hole Italian alto (ten holes,
// subholes omitted) with fixed wrists; your calibrated finger flexion covers
// the holes. Free play, lessons, and session-only takes with replay.

import { useEffect, useMemo, useState } from 'react';
import { useOcarinaCamera } from '../crafts/ocarina/cameraStore';
import { cameraKeyStep, VIEW_LABEL, VIEW_ORDER } from '../crafts/ocarina/cameraViews';
import { fingeringFor, midiToName } from '../crafts/ocarina/fingering';
import { scheduleSong, type NoteResult } from '../crafts/ocarina/lesson';
import { OcarinaStage } from '../crafts/ocarina/OcarinaStage';
import { OcarinaSession, useOcarinaUi } from '../crafts/ocarina/session';
import { SONGS } from '../crafts/ocarina/songs';
import { HOLES, type HoleStates } from '../crafts/ocarina/types';
import { calibrationKey, usePipeline } from '../input/pipeline';
import { Icon } from '../ui/icons';
import { CalibrationWizard } from '../ui/InputPanel';
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

const fmtTime = (ms: number) => {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const sec = (total % 60).toFixed(1).padStart(4, '0');
  return `${m}:${sec}`;
};

/** Voice-recorder style strip: record button + timer, sound and robot toggles, then the take list. */
function Recorder({ session }: { session: OcarinaSession }) {
  const recording = useOcarinaUi((s) => s.recording);
  const takes = useOcarinaUi((s) => s.takes);
  const replaying = useOcarinaUi((s) => s.replaying);
  const muted = useOcarinaUi((s) => s.muted);
  const mirror = usePipeline((s) => s.settings.mirrorRobot);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!recording) {
      setStartedAt(null);
      return;
    }
    const t0 = performance.now();
    setStartedAt(t0);
    setNow(t0);
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [recording]);

  const elapsed = startedAt === null ? 0 : now - startedAt;

  return (
    <div className="card oc-recorder">
      <div className="oc-rec-bar">
        <button
          type="button"
          className={`oc-rec-btn${recording ? ' on' : ''}`}
          disabled={!!replaying}
          aria-label={recording ? 'Stop recording' : 'Record a take'}
          title={recording ? 'Stop recording' : 'Record a take (fingers, notes and robot commands; kept until you leave)'}
          onClick={() => (recording ? session.stopRecording() : session.startRecording())}
        >
          <span />
        </button>
        <span className={`oc-rec-time mono${recording ? ' live' : ''}`}>{fmtTime(elapsed)}</span>
        <div className="spacer" />
        <button
          type="button"
          className={`oc-icon-btn${muted ? ' off' : ''}`}
          aria-label={muted ? 'Unmute' : 'Mute'}
          aria-pressed={muted}
          title={muted ? 'Unmute' : 'Mute'}
          onClick={() => session.setMuted(!muted)}
        >
          <Icon name={muted ? 'mute' : 'volume'} />
        </button>
        <button
          type="button"
          className={`oc-icon-btn${mirror ? ' active' : ' off'}`}
          aria-label={`Robot mirror ${mirror ? 'on' : 'off'}, open input panel`}
          title={`Robot mirror ${mirror ? 'on' : 'off'} (change in the input panel). Replays stream to the robot.`}
          onClick={() => usePipeline.getState().setPanelOpen(true)}
        >
          <Icon name="robot" />
        </button>
      </div>
      {takes.length > 0 && (
        <ul className="oc-takes">
          {takes.map((t) => {
            const playing = replaying === t.id;
            return (
              <li key={t.id} className={`oc-take${playing ? ' playing' : ''}`}>
                <button
                  type="button"
                  className="oc-icon-btn"
                  disabled={!playing && recording}
                  aria-label={playing ? `Stop ${t.name}` : `Replay ${t.name}`}
                  title={playing ? 'Stop' : 'Replay'}
                  onClick={() => (playing ? session.stopReplay() : session.replay(t.id))}
                >
                  <Icon name={playing ? 'stop' : 'play'} size={16} />
                </button>
                <span className="oc-take-name">{t.name}</span>
                <span className="mono">{fmtTime(t.durationMs)}</span>
                <button
                  type="button"
                  className="oc-icon-btn ghost"
                  aria-label={`Delete ${t.name}`}
                  title="Delete"
                  onClick={() => session.deleteTake(t.id)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
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
  const audioReady = useOcarinaUi((s) => s.audioReady);
  const tracked = useOcarinaUi((s) => s.tracked);
  const replaying = useOcarinaUi((s) => s.replaying);
  const lesson = useOcarinaUi((s) => s.lesson);
  const kind = usePipeline((s) => s.kind);
  const status = usePipeline((s) => s.status);
  const [calibrating, setCalibrating] = useState(false);
  const [hudOpen, setHudOpen] = useState(true);
  const view = useOcarinaCamera((s) => s.view);
  const setView = useOcarinaCamera((s) => s.setView);

  // Arrow keys switch the camera view (Shift + arrows with the keyboard source, whose plain arrows turn the wrist).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = cameraKeyStep(e, usePipeline.getState().kind);
      if (!dir) return;
      e.preventDefault();
      useOcarinaCamera.getState().step(dir);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="oc-page">
      <div className="oc-stage-wrap">
        <OcarinaStage getView={session.getView} />
      </div>

      <aside className={`oc-hud${hudOpen ? '' : ' collapsed'}`}>
        <div className="oc-hud-head">
          <div>
            <h1>Ocarina</h1>
            <div className="fi">ocarina · Budrio, Italy</div>
          </div>
          <button
            type="button"
            className="oc-icon-btn oc-hud-toggle"
            aria-expanded={hudOpen}
            aria-label={hudOpen ? 'Hide controls' : 'Show controls'}
            title={hudOpen ? 'Hide controls' : 'Show controls'}
            onClick={() => setHudOpen((v) => !v)}
          >
            <Icon name={hudOpen ? 'collapse' : 'sliders'} />
          </button>
        </div>

        {hudOpen && (
          <div className="oc-hud-body">
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

            <Recorder session={session} />
          </div>
        )}
      </aside>

      <div className="oc-top-actions">
        {!audioReady && (
          <button className="btn primary oc-sound" onClick={() => session.enableAudio()}>
            Enable sound
          </button>
        )}
        {replaying && <div className="oc-stage-tag">Replay</div>}
        <WebcamPreview />
      </div>

      <div
        className="oc-views"
        role="group"
        aria-label="Camera view"
        title={kind === 'keyboard' ? 'Shift + ← / → to switch view' : '← / → to switch view'}
      >
        {VIEW_ORDER.map((id) => (
          <button key={id} type="button" className={view === id ? 'on' : ''} aria-pressed={view === id} onClick={() => setView(id)}>
            {VIEW_LABEL[id]}
          </button>
        ))}
      </div>

      <div className="stage-overlay">
        {lesson?.state === 'countin' && <div className="feedback">{lesson.countIn}</div>}
        {!replaying && !tracked.left && !tracked.right && (
          <div className="hint">{kind ? `Show your hands to play. (${status.message})` : 'Choose a hand input (Rokoko Smartgloves recommended) to play.'}</div>
        )}
      </div>

      {calibrating && <CalibrationWizard onClose={() => setCalibrating(false)} />}
    </div>
  );
}
