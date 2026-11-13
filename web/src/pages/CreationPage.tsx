import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { community, type Creation } from '../community/api';
import { KanteleStage } from '../crafts/kantele/KanteleStage';
import { KanteleSession, useKanteleUi } from '../crafts/kantele/session';
import { KuksaStage } from '../crafts/kuksa/KuksaStage';
import { KuksaSession, useKuksaUi } from '../crafts/kuksa/session';
import { downloadDemonstration } from '../recording/recording';
import { LikeButton, timeAgo } from './CommunityPage';

function KanteleReplay({ creation }: { creation: Creation }) {
  const session = useMemo(() => new KanteleSession({ kind: 'replay', recording: creation.recording }), [creation]);
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

function KuksaReplay({ creation }: { creation: Creation }) {
  const [nonce, setNonce] = useState(0);
  const session = useMemo(() => new KuksaSession({ kind: 'replay', recording: creation.recording }), [creation]);
  useEffect(() => session.activate(), [session]);
  const phase = useKuksaUi((s) => s.phase);
  const [speed, setSpeed] = useState(session.replaySpeed);
  return (
    <section className="stage">
      <KuksaStage key={nonce} session={session} />
      <div className="stage-overlay">
        <div className="center-msg" style={{ top: '85%', pointerEvents: 'auto' }}>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button
              className="btn primary"
              onClick={() => {
                session.restartReplay();
                setNonce((n) => n + 1);
              }}
            >
              {phase === 'replayDone' ? '↺ Replay' : '↺ Restart'}
            </button>
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
      </div>
    </section>
  );
}

export function CreationPage() {
  const { id } = useParams();
  const [c, setC] = useState<Creation | null | undefined>(undefined);
  useEffect(() => {
    void community.get(id!).then((x) => setC(x ?? null));
  }, [id]);

  if (c === undefined) return <div className="empty">Loading…</div>;
  if (c === null) return <div className="empty">Creation not found. <Link to="/community">Back to community</Link></div>;

  const plucks = c.recording.events.filter((e) => e.type === 'pluck').length;
  const cuts = c.recording.events.filter((e) => e.type === 'cut').length;
  const learnUrl = c.craft === 'kantele' ? `/kantele?from=${c.id}` : `/kuksa?from=${c.id}`;

  return (
    <div className="detail">
      <aside className="panel">
        <Link to="/community" style={{ color: 'var(--muted)', fontSize: 14 }}>← Community</Link>
        <div>
          <span className="tag">{c.craft}</span>
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
          <Link className="btn primary" to={learnUrl}>Learn this</Link>
          <LikeButton creation={c} onChange={setC} />
        </div>
        <div className="card">
          <h3>Demonstration data</h3>
          <p>
            {(c.recording.durationMs / 1000).toFixed(1)} s · {c.recording.frames.length} robot frames · {c.craft === 'kantele' ? `${plucks} plucks` : `${cuts} cuts`} · source: {c.recording.source}
          </p>
          <p style={{ marginTop: 8 }}>Each frame holds the 6 actuator positions and wrist pose of the robot hand. That's the data needed to train a robot to do this craft by itself.</p>
          <button className="btn small" style={{ marginTop: 12 }} onClick={() => downloadDemonstration(c.recording, c.title)}>
            Download demonstration (.json)
          </button>
        </div>
      </aside>
      {c.craft === 'kantele' ? <KanteleReplay creation={c} /> : <KuksaReplay creation={c} />}
    </div>
  );
}
