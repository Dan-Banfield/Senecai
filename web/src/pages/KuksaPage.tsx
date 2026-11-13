import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { community, type Creation } from '../community/api';
import { KuksaStage } from '../crafts/kuksa/KuksaStage';
import { KuksaSession, STEPS, useKuksaUi } from '../crafts/kuksa/session';
import { decodeShape, encodeShape } from '../crafts/kuksa/voxels';
import { usePipeline } from '../input/pipeline';
import { PipelineStrip } from '../ui/PipelineStrip';
import { ShareDialog } from '../ui/ShareDialog';
import { WebcamPreview } from '../ui/WebcamPreview';
import { NoHandHint, NoInputCard } from './common';

function Meter({ label, value, copper }: { label: string; value: number; copper?: boolean }) {
  return (
    <div className="meter-row">
      <span>{label}</span>
      <div className={`meter ${copper ? 'copper' : ''}`}>
        <div style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="mono">{Math.round(value * 100)}%</span>
    </div>
  );
}

export function KuksaPage() {
  const [params, setParams] = useSearchParams();
  const mode = params.get('mode') === 'free' ? 'free' : 'learn';
  const fromId = params.get('from');
  const [fromCreation, setFromCreation] = useState<Creation | null>(null);
  const [nonce, setNonce] = useState(0);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!fromId) return setFromCreation(null);
    void community.get(fromId).then((c) => setFromCreation(c?.craft === 'kuksa' ? c : null));
  }, [fromId]);

  const session = useMemo(() => {
    if (mode === 'free') return new KuksaSession({ kind: 'free' });
    if (fromCreation?.shape)
      return new KuksaSession({
        kind: 'lesson',
        target: decodeShape(fromCreation.shape),
        fromCreation: { id: fromCreation.id, title: fromCreation.title, author: fromCreation.author, recording: fromCreation.recording },
      });
    return new KuksaSession({ kind: 'lesson' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, fromCreation, nonce]);
  useEffect(() => {
    session.activate();
    return () => session.dispose();
  }, [session]);

  const ui = useKuksaUi();
  const present = usePipeline((s) => s.present);
  const p = ui.progress;
  const showFeedback = ui.feedback && performance.now() - ui.feedback.at < 2200;

  return (
    <div className="workspace">
      <aside className="panel">
        <div>
          <h1>Kuksa</h1>
          <div className="fi">the birch-burl cup · kuksa</div>
        </div>
        <div className="tabs">
          <button className={mode === 'learn' ? 'on' : ''} onClick={() => setParams(fromId ? { from: fromId } : {})}>Learn</button>
          <button className={mode === 'free' ? 'on' : ''} onClick={() => setParams({ mode: 'free' })}>Free carve</button>
        </div>
        <NoInputCard />

        {fromCreation && mode === 'learn' && (
          <div className="learned-from">
            ★ Learning <Link to={`/community/${fromCreation.id}`}>{fromCreation.title}</Link> by {fromCreation.author}. The ghost hand repeats their real carving movements.
          </div>
        )}

        {mode === 'learn' && ui.phase === 'carving' && (
          <div className="steps">
            {STEPS.map((s, i) => (
              <div key={s.id} className={`step ${i === ui.step ? 'on' : i < ui.step ? 'done' : ''}`}>
                <span className="n">{i < ui.step ? '✓' : i + 1}</span>
                <div>
                  <b>{s.title}</b>
                  {i === ui.step && <p>{s.text}</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {mode === 'free' && ui.phase === 'carving' && (
          <div className="card">
            <h3>Carve anything</h3>
            <p>A fresh birch burl, no guide lines. Make your own cup, spoon blank or sculpture, then share it so others can learn your shape.</p>
          </div>
        )}

        {p && (
          <div className="card" style={{ display: 'grid', gap: 8 }}>
            <Meter label="Outside" value={p.outside} />
            <Meter label="Hollow" value={p.cavity} />
            <Meter label="Overall" value={p.overall} copper />
            <div className="meter-row">
              <span>Overcut</span>
              <span style={{ color: p.overcut > 0.03 ? 'var(--warn)' : 'var(--muted)' }}>{(p.overcut * 100).toFixed(1)}% of the cup</span>
              <span />
            </div>
          </div>
        )}

        {ui.phase === 'carving' ? (
          <div className="row">
            <button className="btn primary" onClick={() => session.finish()}>Finish</button>
            {mode === 'learn' && ui.step < STEPS.length - 1 && (
              <button className="btn small" onClick={() => session.advanceStep()}>Skip step</button>
            )}
            <button className="btn small ghost" onClick={() => setNonce((n) => n + 1)}>New block</button>
          </div>
        ) : (
          <div className="card">
            <h3>{p ? `Your kuksa scored ${p.score}` : 'Carving finished'}</h3>
            <p>{p ? (p.score > 80 ? 'A cup worth drinking from by the campfire!' : p.overcut > 0.05 ? 'A few deep cuts. Try a lighter grip near the pale wood.' : 'Keep going: more of the marked wood can come off.') : `${ui.cutCount} cuts recorded.`}</p>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={() => setSharing(true)} disabled={!ui.cutCount}>Share…</button>
              <button className="btn" onClick={() => setNonce((n) => n + 1)}>Carve another</button>
            </div>
          </div>
        )}

        <div className="card">
          <div className="row">
            <div className="tabs" style={{ flex: 1 }}>
              <button className={ui.view === 'side' ? 'on' : ''} onClick={() => useKuksaUi.setState({ view: 'side' })}>Side</button>
              <button className={ui.view === 'top' ? 'on' : ''} onClick={() => useKuksaUi.setState({ view: 'top' })}>Top</button>
            </div>
            {session.target && (
              <label className="toggle">
                <input type="checkbox" checked={ui.guide} onChange={(e) => useKuksaUi.setState({ guide: e.target.checked })} /> Guide
              </label>
            )}
          </div>
          <p style={{ marginTop: 10 }}>
            Turn the block: <code>Q</code>/<code>E</code>, or make a fist with your other hand and slide it sideways.
          </p>
        </div>
      </aside>

      <section className="stage">
        <KuksaStage key={`${mode}-${nonce}-${fromCreation?.id ?? ''}`} session={session} />
        <div className="stage-overlay">
          {showFeedback && <div className={`feedback ${ui.feedback!.kind}`}>{ui.feedback!.text}</div>}
          {!present.left && !present.right && <NoHandHint />}
          {(present.left || present.right) && ui.phase === 'carving' && (
            <div className="legend">
              <span style={{ color: ui.engaged ? 'var(--good)' : 'var(--birch-dim)' }}>{ui.engaged ? '● cutting' : '○ blade lifted'}</span>
              <span>{ui.cutCount} cuts</span>
            </div>
          )}
          <WebcamPreview />
          <PipelineStrip dofOverride={() => session.livePose?.dof} />
        </div>
      </section>
      {sharing && ui.lastRecording && (
        <ShareDialog
          draft={{
            craft: 'kuksa',
            recording: ui.lastRecording,
            shape: encodeShape(session.grid),
            score: p?.score,
            learnedFrom: fromCreation ? { id: fromCreation.id, title: fromCreation.title, author: fromCreation.author } : undefined,
          }}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}
