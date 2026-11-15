// The ocarina page: two robot hands hold a 12-hole Italian alto (ten holes,
// subholes omitted) with fixed wrists; your calibrated finger flexion covers
// the holes. Free play, lessons, session-only takes with replay, and a song
// market for publishing takes and replaying other players' songs.

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useOcarinaCamera } from '../crafts/ocarina/cameraStore';
import { cameraKeyStep, VIEW_LABEL, VIEW_ORDER } from '../crafts/ocarina/cameraViews';
import { fingeringFor, midiToName } from '../crafts/ocarina/fingering';
import { market } from '../crafts/ocarina/market';
import { library } from '../crafts/ocarina/market/library';
import { noteIndexAt, takeNoteEvents } from '../crafts/ocarina/market/lessonSong';
import { MarketModal } from '../crafts/ocarina/market/MarketModal';
import { previewPlayer } from '../crafts/ocarina/market/preview';
import { ARTIST_MAX, TITLE_MAX } from '../crafts/ocarina/market/types';
import { OcarinaStage } from '../crafts/ocarina/OcarinaStage';
import { OcarinaSession, useOcarinaUi } from '../crafts/ocarina/session';
import { LIB_PREFIX } from '../crafts/ocarina/lessonPrefs';
import { PlaybackBar, WATCH_PREFIX } from '../crafts/ocarina/PlaybackBar';
import { useSelectedSong } from '../crafts/ocarina/useSelectedSong';
import { SONGS } from '../crafts/ocarina/songs';
import { HOLES, type HoleStates } from '../crafts/ocarina/types';
import { useInputDemand, usePipeline } from '../input/pipeline';
import { Icon } from '../ui/icons';
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
  const holes = useOcarinaUi((s) => s.holes);
  const replaying = useOcarinaUi((s) => s.replaying);
  const sel = useSelectedSong();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [time, setTime] = useState(0);

  const song = sel.song;
  const take = sel.take;
  // Note timings straight from the take the playback bar replays, so the card follows it exactly.
  const events = useMemo(() => (take ? takeNoteEvents(take) : []), [take]);
  const following = replaying === WATCH_PREFIX + sel.pick;
  const playable = !!song && song.notes.length > 0;

  // Follow the replay position (pause, seek and speed included) ~20x per second.
  useEffect(() => {
    if (!following) {
      setTime(0);
      return;
    }
    setTime(session.replayTime);
    const id = window.setInterval(() => setTime(session.replayTime), 50);
    return () => window.clearInterval(id);
  }, [following, session]);

  const current = following ? noteIndexAt(events, time) : 0;
  const ev = events[current];
  const next = events[current + 1];
  const targetHoles = ev?.midi != null ? fingeringFor(ev.midi) : undefined;
  const from = Math.max(0, Math.min(current - 1, events.length - 8));
  const lane = events.slice(from, from + 8);
  const progress = following && take ? Math.min(1, time / take.durationMs) : 0;
  const noteLabel = (midi: number | null) => (midi === null ? 'rest' : midiToName(midi));

  const choose = (value: string) => {
    if (following) session.stopReplay();
    setRemoveError(null);
    sel.setPick(value);
  };

  return (
    <>
      <div className="card">
        <h3>Lesson</h3>
        <div className="field" style={{ marginTop: 8 }}>
          Song
          <select value={sel.pick} onChange={(e) => choose(e.target.value)}>
            <optgroup label="Built-in">
              {SONGS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {s.bpm} bpm
                </option>
              ))}
            </optgroup>
            {sel.downloaded.length > 0 && (
              <optgroup label="Downloaded">
                {sel.downloaded.map((s) => (
                  <option key={s.id} value={LIB_PREFIX + s.id}>
                    {s.title} · {s.artist}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        {sel.libId && (
          <div className="oc-lib-row">
            <span className="grow">
              {removeError ?? sel.error ?? (sel.artist ? `Recorded by ${sel.artist}` : 'Loading…')}
              {song && !playable && ' · no notes to practise'}
            </span>
            <button
              type="button"
              className="oc-icon-btn ghost"
             
              aria-label="Remove from lesson library"
              title="Remove from lesson library"
              onClick={() => {
                const id = sel.libId!;
                if (replaying === WATCH_PREFIX + sel.pick) session.stopReplay();
                void library.remove(id).catch((e: unknown) => setRemoveError(e instanceof Error ? e.message : 'Could not remove this song.'));
              }}
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        )}
        {!sel.libId && sel.downloaded.length === 0 && (
          <p style={{ marginTop: 8, fontSize: 13 }}>Download songs from the Song market to practise them here.</p>
        )}
      </div>

      {events.length > 0 && (
        <div className="card">
          {following ? (
            <h3>
              Now {ev ? noteLabel(ev.midi) : '—'}
              {next && <span style={{ color: 'var(--muted)', fontSize: 14, marginLeft: 10 }}>next: {noteLabel(next.midi)}</span>}
            </h3>
          ) : (
            <h3>
              Starts on {ev ? noteLabel(ev.midi) : '—'}
              <span style={{ color: 'var(--muted)', fontSize: 14, marginLeft: 10 }}>press play below to follow along</span>
            </h3>
          )}
          <div className="oc-lane">
            {lane.map((e) => (
              <span
                key={e.index}
                className={`oc-lane-note${e.midi === null ? ' rest' : ''}${e.index < current ? ' past' : ''}${e.index === current ? ' on' : ''}`}
              >
                {e.midi === null ? '·' : midiToName(e.midi)}
              </span>
            ))}
          </div>
          {targetHoles && <FingeringDiagram holes={following ? holes : targetHoles} target={targetHoles} />}
          <div className="meter" style={{ marginTop: 10 }}>
            <div style={{ width: `${progress * 100}%` }} />
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

const ARTIST_KEY = 'senecai.ocarina.artist';

const loadArtist = () => {
  try {
    return localStorage.getItem(ARTIST_KEY) ?? '';
  } catch {
    return '';
  }
};

const saveArtist = (name: string) => {
  try {
    localStorage.setItem(ARTIST_KEY, name);
  } catch {
    // Remembering the name is a convenience only.
  }
};

/** Inline form under a take: title + artist, then publish the take to the song market. */
function PublishForm({ session, takeId, takeName, onDone, onCancel }: {
  session: OcarinaSession;
  takeId: string;
  takeName: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(() => takeName.slice(0, TITLE_MAX));
  const [artist, setArtist] = useState(loadArtist);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = title.trim();
  const a = artist.trim();
  const valid = t.length > 0 && t.length <= TITLE_MAX && a.length > 0 && a.length <= ARTIST_MAX;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const take = session.getTakes().find((x) => x.id === takeId);
    if (!valid || saving || !take) return;
    setSaving(true);
    setError(null);
    try {
      await market.publish(take, { title: t, artist: a });
      saveArtist(a);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish this take.');
      setSaving(false);
    }
  };

  return (
    <form className="oc-publish" onSubmit={submit}>
      <label className="field">
        <span>Title</span>
        <input type="text" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Your name</span>
        <input type="text" value={artist} maxLength={ARTIST_MAX} placeholder="Shown on the market" onChange={(e) => setArtist(e.target.value)} />
      </label>
      {error && <div className="oc-publish-error" role="alert">{error}</div>}
      <div className="row">
        <button type="submit" className="btn small primary" disabled={!valid || saving}>
          {saving ? 'Publishing…' : 'Publish'}
        </button>
        <button type="button" className="btn small ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Voice-recorder style strip: record button + timer, sound and robot toggles, then the take list. */
function Recorder({ session }: { session: OcarinaSession }) {
  const recording = useOcarinaUi((s) => s.recording);
  const takes = useOcarinaUi((s) => s.takes);
  const replaying = useOcarinaUi((s) => s.replaying);
  const muted = useOcarinaUi((s) => s.muted);
  const mirror = usePipeline((s) => s.settings.mirrorRobot);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const [publishing, setPublishing] = useState<string | null>(null);
  const [published, setPublished] = useState<ReadonlySet<string>>(() => new Set());

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
          onClick={() => {
            if (recording) {
              session.stopRecording();
            } else {
              previewPlayer.stop();
              session.startRecording();
            }
          }}
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
                  onClick={() => {
                    if (playing) {
                      session.stopReplay();
                    } else {
                      previewPlayer.stop();
                      session.replay(t.id);
                    }
                  }}
                >
                  <Icon name={playing ? 'stop' : 'play'} size={16} />
                </button>
                <span className="oc-take-name">{t.name}</span>
                <span className="mono">{fmtTime(t.durationMs)}</span>
                {published.has(t.id) ? (
                  <span className="oc-take-published" title="Published to the song market" aria-label="Published">
                    <Icon name="check" size={16} />
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`oc-icon-btn ghost${publishing === t.id ? ' on' : ''}`}
                    disabled={playing}
                    aria-label={`Publish ${t.name} to the song market`}
                    aria-expanded={publishing === t.id}
                    title="Publish to the song market"
                    onClick={() => setPublishing((cur) => (cur === t.id ? null : t.id))}
                  >
                    <Icon name="upload" size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="oc-icon-btn ghost"
                  aria-label={`Delete ${t.name}`}
                  title="Delete"
                  onClick={() => {
                    if (publishing === t.id) setPublishing(null);
                    session.deleteTake(t.id);
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
                {publishing === t.id && (
                  <PublishForm
                    session={session}
                    takeId={t.id}
                    takeName={t.name}
                    onCancel={() => setPublishing(null)}
                    onDone={() => {
                      setPublishing((cur) => (cur === t.id ? null : cur));
                      setPublished((prev) => new Set(prev).add(t.id));
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function OcarinaPage() {
  // The picked input source (camera, gloves…) runs only while a page like this one needs it.
  useInputDemand();
  const session = useMemo(() => new OcarinaSession(), []);
  useEffect(() => {
    session.activate();
    return () => {
      previewPlayer.dispose();
      session.dispose();
    };
  }, [session]);

  const mode = useOcarinaUi((s) => s.mode);
  const audioReady = useOcarinaUi((s) => s.audioReady);
  const tracked = useOcarinaUi((s) => s.tracked);
  const replaying = useOcarinaUi((s) => s.replaying);
  const lesson = useOcarinaUi((s) => s.lesson);
  const kind = usePipeline((s) => s.kind);
  const status = usePipeline((s) => s.status);
  const [hudOpen, setHudOpen] = useState(true);
  const [marketOpen, setMarketOpen] = useState(false);
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
        <button
          type="button"
          className="oc-market-btn"
          aria-expanded={marketOpen}
          aria-controls="oc-market"
          onClick={() => setMarketOpen((v) => !v)}
        >
          <Icon name="market" />
          Song market
        </button>
        {!audioReady && (
          <button className="btn primary oc-sound" onClick={() => session.enableAudio()}>
            Enable sound
          </button>
        )}
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

      <PlaybackBar session={session} />

      <MarketModal session={session} open={marketOpen} onClose={() => setMarketOpen(false)} />

    </div>
  );
}
