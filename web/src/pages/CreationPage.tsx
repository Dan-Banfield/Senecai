import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { benchFor, isBenchCraft } from '../bench/crafts';
import { downloadBenchDemonstration, isBenchRecording, type BenchRecording } from '../bench/recording';
import { BenchStage } from '../bench/render/BenchStage';
import { BenchSession, useBenchUi } from '../bench/session';
import { community, type Creation } from '../community/api';
import { craftById } from '../crafts/catalog';
import { KanteleStage } from '../crafts/kantele/KanteleStage';
import { KanteleSession, useKanteleUi } from '../crafts/kantele/session';
import { downloadDemonstration, type Recording } from '../recording/recording';
import { LikeButton, timeAgo } from './CommunityPage';

function KanteleReplay({ recording }: { recording: Recording }) {
  const session = useMemo(() => new KanteleSession({ kind: 'replay', recording }), [recording]);
  useEffect(() => session.activate(), [session]);
  const phase = useKanteleUi((s) => s.phase);
  return (
    <section className="stage">
      <KanteleStage session={session} />
      <div className="stage-overlay">
        <div className="center-msg" style={{ top: '82%', pointerEvents: 'auto' }}>
          <button className="btn primary" onClick={() => session.replay()}>
            {phase === 'playing' ? '↺ Restart' : '▶ Play'}
          </button>
        </div>
      </div>
    </section>
  );
}

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms / 1000) % 60)).padStart(2, '0')}`;

/** Replays a workbench recording: both robot hands, their tools, and the workpiece rebuilt frame by frame. */
function BenchReplay({ recording }: { recording: BenchRecording }) {
  const session = useMemo(() => new BenchSession(benchFor(recording.craft), { kind: 'replay', recording }), [recording]);
  useEffect(() => {
    session.activate();
    return () => session.dispose();
  }, [session]);
  const ui = useBenchUi();
  const [speed, setSpeed] = useState(session.replaySpeed);
  // Keep the highlighted speed authoritative if the session is rebuilt under the same creation.
  useEffect(() => {
    session.replaySpeed = speed;
  }, [session, speed]);
  const stage = session.def.stages[ui.stage];
  return (
    <section className="stage">
      <BenchStage session={session} />
      <div className="stage-overlay">
        {stage && <div className="bench-stage-tag">{stage.title}</div>}
        <div className="replay-bar">
          <button className="btn primary small" onClick={() => session.restartReplay()}>
            {ui.phase === 'replayDone' ? '↺ Replay' : '↺ Restart'}
          </button>
          <input
            type="range"
            min={0}
            max={ui.duration}
            value={Math.min(ui.replayTime, ui.duration)}
            onChange={(e) => session.seek(Number(e.target.value))}
            aria-label="Replay position"
          />
          <span className="mono">
            {fmt(ui.replayTime)} / {fmt(ui.duration)}
          </span>
          {[1, 4, 12].map((s) => (
            <button
              key={s}
              className={`btn small ${speed === s ? '' : 'ghost'}`}
              onClick={() => {
                session.replaySpeed = s;
                setSpeed(s);
              }}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CreationPage() {
  const { id } = useParams();
  const [c, setC] = useState<Creation | null | undefined>(undefined);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setC(undefined);
    setError(false);
    if (!id) {
      setC(null);
      return;
    }
    community
      .get(id)
      .then((x) => {
        if (!cancelled) setC(x ?? null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error('community get failed', e);
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <div className="empty">Couldn't load this creation. <Link to="/community">Back to community</Link></div>;
  if (c === undefined) return <div className="empty">Loading…</div>;
  if (c === null) return <div className="empty">Creation not found. <Link to="/community">Back to community</Link></div>;

  const rec = c.recording;
  const bench = isBenchRecording(rec) && isBenchCraft(c.craft) ? rec : null;
  const learnUrl = bench ? `/craft/${c.craft}?from=${c.id}` : `/kantele?from=${c.id}`;
  const craftName = craftById(c.craft)?.name ?? c.craft;
  let detail: string;
  if (bench) {
    const ops = bench.frames.reduce((n, f) => n + (f.ops?.length ?? 0), 0);
    const tools = new Set(bench.frames.flatMap((f) => f.hands.map((h) => h.tool).filter(Boolean)));
    detail = `${bench.frames.length} robot frames · ${ops} changes to the workpiece · ${tools.size} tool${tools.size === 1 ? '' : 's'} used`;
  } else {
    const plucks = rec.version === 1 ? rec.events.filter((e) => e.type === 'pluck').length : 0;
    detail = `${rec.frames.length} robot frames · ${plucks} plucks`;
  }

  return (
    <div className="detail">
      <aside className="panel">
        <Link to="/community" style={{ color: 'var(--muted)', fontSize: 14 }}>
          ← Community
        </Link>
        <div>
          <span className="tag">{craftName}</span>
          {c.score !== undefined && <span className="tag">score {c.score}</span>}
          <h1 style={{ marginTop: 10 }}>{c.title}</h1>
          <div style={{ color: 'var(--muted)', marginTop: 4 }}>
            by {c.author} · {timeAgo(c.createdAt)}
          </div>
        </div>
        {c.description && <p style={{ margin: 0, color: 'var(--birch-dim)' }}>{c.description}</p>}
        {c.learnedFrom && (
          <div className="learned-from">
            Learned from <Link to={`/community/${c.learnedFrom.id}`}>{c.learnedFrom.title}</Link> by {c.learnedFrom.author}
          </div>
        )}
        <div className="row">
          <Link className="btn primary" to={learnUrl}>
            Learn this
          </Link>
          {/* Keep the recording reference so a like doesn't rebuild (and restart) the replay session. */}
          <LikeButton creation={c} onChange={(n) => setC((prev) => (prev && prev.id === n.id ? { ...n, recording: prev.recording } : n))} />
        </div>
        <div className="card">
          <h3>Demonstration data</h3>
          <p>
            {(rec.durationMs / 1000).toFixed(1)} s · {detail} · source: {rec.source}
          </p>
          <p style={{ marginTop: 8 }}>
            {bench
              ? 'Each frame holds both robot hands (6 actuators and the wrist pose), the tool each one holds, and every change made to the workpiece in that frame. Replaying them rebuilds the object exactly as it was made.'
              : "Each frame holds the 6 actuator positions and wrist pose of the robot hand. That's the data needed to train a robot to do this craft by itself."}
          </p>
          <button
            className="btn small"
            style={{ marginTop: 12 }}
            onClick={() => (bench ? downloadBenchDemonstration(bench, benchFor(bench.craft), c.title) : rec.version === 1 && downloadDemonstration(rec, c.title))}
          >
            Download demonstration (.json)
          </button>
        </div>
      </aside>
      {bench ? <BenchReplay key={c.id} recording={bench} /> : rec.version === 1 ? <KanteleReplay key={c.id} recording={rec} /> : null}
    </div>
  );
}
