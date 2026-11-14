import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { benchFor, isBenchCraft } from '../bench/crafts';
import { isBenchRecording } from '../bench/recording';
import { BenchStage } from '../bench/render/BenchStage';
import { BenchSession, useBenchUi } from '../bench/session';
import { community, type Creation } from '../community/api';
import { usePipeline } from '../input/pipeline';
import { PipelineStrip } from '../ui/PipelineStrip';
import { ShareDialog } from '../ui/ShareDialog';
import { WebcamPreview } from '../ui/WebcamPreview';
import { NoHandHint, NoInputCard } from './common';

export function Meter({ label, value, warn, strong }: { label: string; value: number; warn?: boolean; strong?: boolean }) {
  return (
    <div className="meter-row">
      <span>{label}</span>
      <div className={`meter ${strong ? 'copper' : ''} ${warn ? 'warn' : ''}`}>
        <div style={{ width: `${Math.round(Math.min(1, value) * 100)}%` }} />
      </div>
      <span className="mono">{Math.round(Math.min(1, value) * 100)}%</span>
    </div>
  );
}

/** A small JPEG of the bench, for the community card. */
function snapshot(canvas: HTMLCanvasElement | null) {
  if (!canvas) return undefined;
  try {
    const out = document.createElement('canvas');
    out.width = 320;
    out.height = 180;
    const ctx = out.getContext('2d')!;
    const s = Math.max(out.width / canvas.width, out.height / canvas.height);
    const w = canvas.width * s;
    const h = canvas.height * s;
    ctx.drawImage(canvas, (out.width - w) / 2, (out.height - h) / 2, w, h);
    return out.toDataURL('image/jpeg', 0.72);
  } catch {
    return undefined;
  }
}

/** Search-params updater that sets (or clears) `mode` and keeps everything else, notably `from`. */
function withMode(mode: string | null) {
  return (prev: URLSearchParams) => {
    const next = new URLSearchParams(prev);
    if (mode) next.set('mode', mode);
    else next.delete('mode');
    return next;
  };
}

export function BenchPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const mode = params.get('mode') === 'free' ? 'free' : 'learn';
  const fromId = params.get('from');
  const [fromCreation, setFromCreation] = useState<Creation | null>(null);
  const [fromError, setFromError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [sharing, setSharing] = useState<{ thumb?: string } | null>(null);

  // The ?from= creation is fetched regardless of mode and kept across Learn/Free switches, so going
  // back to Learn doesn't refetch. Stale responses (after the id or craft changed) are ignored.
  useEffect(() => {
    let cancelled = false;
    setFromCreation(null);
    setFromError(false);
    if (!fromId) return;
    community
      .get(fromId)
      .then((c) => {
        if (!cancelled) setFromCreation(c && c.craft === id && isBenchRecording(c.recording) ? c : null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error('community get failed', e);
        setFromError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fromId, id]);

  // Only Learn mode follows a creation. In Free mode this stays null, so the creation loading (or
  // changing) never rebuilds the free session and wipes the work.
  // Craft-gated: right after a route change fromCreation still holds the previous craft's creation for one render.
  const learnFrom = mode === 'learn' && fromCreation?.craft === id ? fromCreation : null;

  const session = useMemo(() => {
    if (!isBenchCraft(id)) return null;
    const def = benchFor(id);
    if (mode === 'free') return new BenchSession(def, { kind: 'free' });
    const from = learnFrom && isBenchRecording(learnFrom.recording) ? { id: learnFrom.id, title: learnFrom.title, author: learnFrom.author, recording: learnFrom.recording } : undefined;
    return new BenchSession(def, { kind: 'learn', from });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mode, learnFrom, nonce]);

  useEffect(() => {
    if (!session) return;
    session.activate();
    if (import.meta.env.DEV) Object.assign(window, { senecaiBench: session, senecaiBenchUi: useBenchUi });
    return () => session.dispose();
  }, [session]);

  const ui = useBenchUi();
  const present = usePipeline((s) => s.present);

  if (!session) return <div className="empty">That craft doesn't have a workbench yet. <Link to="/">Back to the globe</Link></div>;
  const def = session.def;
  const stage = def.stages[ui.stage];
  const showFeedback = ui.feedback && performance.now() - ui.feedback.at < 2400;
  const finished = ui.phase === 'finished';

  const finish = () => {
    session.finish();
    setSharing(null);
  };
  const share = () => setSharing({ thumb: snapshot(session.canvas) });

  return (
    <div className="workspace">
      <aside className="panel">
        <div>
          <h1>{def.title}</h1>
          <div className="fi">{def.subtitle}</div>
        </div>
        <div className="tabs">
          <button className={mode === 'learn' ? 'on' : ''} onClick={() => setParams(withMode(null))}>
            Learn
          </button>
          <button className={mode === 'free' ? 'on' : ''} onClick={() => setParams(withMode('free'))}>
            Free work
          </button>
        </div>
        <NoInputCard />

        {learnFrom && (
          <div className="learned-from">
            ★ Learning <Link to={`/community/${learnFrom.id}`}>{learnFrom.title}</Link> by {learnFrom.author}. The ghost hands repeat their real movements.
          </div>
        )}
        {fromError && mode === 'learn' && <div className="learned-from">Couldn't load the creation to learn from. You can still work freely or try again later.</div>}

        {!finished && (
          <>
            <p style={{ margin: 0, color: 'var(--birch-dim)', fontSize: 14 }}>{def.intro}</p>
            <div className="steps">
              {def.stages.map((s, i) => (
                <div key={s.id} className={`step ${i === ui.stage ? 'on' : i < ui.stage ? 'done' : ''}`}>
                  <span className="n">{i < ui.stage ? '✓' : i + 1}</span>
                  <div>
                    <b>{s.title}</b>
                    {i === ui.stage && (
                      <>
                        <p>{s.text}</p>
                        <div className="meter" style={{ marginTop: 8 }}>
                          <div style={{ width: `${Math.round(Math.min(1, ui.stageProgress) * 100)}%` }} />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {ui.meters.length > 0 && (
          <div className="card" style={{ display: 'grid', gap: 8 }}>
            {ui.meters.map((m) => (
              <Meter key={m.label} label={m.label} value={m.value} warn={m.warn} />
            ))}
          </div>
        )}

        {!finished ? (
          <div className="row">
            <button className="btn primary" onClick={finish}>
              Finish
            </button>
            {ui.stage < def.stages.length - 1 && (
              <button className="btn small" onClick={() => session.advanceStage()}>
                Skip step
              </button>
            )}
            <button className="btn small ghost" onClick={() => setNonce((n) => n + 1)}>
              Start over
            </button>
          </div>
        ) : (
          <div className="card">
            <h3>{`Your ${def.title.toLowerCase()} scored ${ui.score ?? 0}`}</h3>
            <p>
              {ui.lastRecording?.frames.length ?? 0} robot frames and {ui.opCount} changes to the workpiece recorded. Others can replay how you made it, frame by frame, or learn it from your movements.
            </p>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={share} disabled={!ui.opCount}>
                Share…
              </button>
              <button className="btn" onClick={() => setNonce((n) => n + 1)}>
                Make another
              </button>
            </div>
          </div>
        )}

        <div className="card bench-help">
          {def.guide && (
            <label className="toggle" style={{ marginBottom: 8 }}>
              <input type="checkbox" checked={ui.guide} onChange={(e) => useBenchUi.setState({ guide: e.target.checked })} /> Show guide
            </label>
          )}
          <p>
            <b>Pick up a tool:</b> close your hand over it. <b>Use it:</b> squeeze. <b>Put it back:</b> squeeze over its spot, or press <code>X</code>.
          </p>
          {def.hold ? (
            <p>
              <b>Other hand:</b> make a fist to pick up the work and hold it (<code>Z</code> on a keyboard). Move and turn that hand to bring it to the blade (arrow keys on a keyboard). <code>Q</code> / <code>E</code> roll it, <code>V</code> swaps ends, open the hand to set it down.
            </p>
          ) : (
            <p>
              <b>Other hand:</b> make a fist and slide sideways to turn the work (<code>Q</code> / <code>E</code>).
            </p>
          )}
          {def.hold && (
            <p>
              <b>Knife:</b> squeeze and draw it across the wood. How hard you squeeze sets the cut: a light grip skims a thin shaving, a full fist bites deep (on a keyboard, <code>S</code>+<code>D</code>+<code>F</code> is light, <code>Space</code> is deep).
            </p>
          )}
        </div>
      </aside>

      <section className="stage">
        <BenchStage key={`${id}-${mode}-${nonce}-${learnFrom?.id ?? ''}`} session={session} />
        <div className="stage-overlay">
          {showFeedback && (
            <div className={`feedback ${ui.feedback!.kind}`} style={{ top: 62 }}>
              {ui.feedback!.text}
            </div>
          )}
          {!present.left && !present.right && <NoHandHint />}
          {(present.left || present.right) && !finished && (
            <div className="legend">
              <span style={{ color: ui.squeezing ? 'var(--good)' : 'var(--birch-dim)' }}>{ui.squeezing ? '● squeezing' : '○ open'}</span>
              <span>{ui.held ? `holding: ${ui.held}` : 'empty hand'}</span>
              {ui.carrying && <span>carrying the {ui.carrying}</span>}
              <span>{ui.opCount} changes</span>
            </div>
          )}
          {ui.hover && !finished && <div className="bench-hover">{ui.hover}</div>}
          {ui.bite !== null && !finished && (
            <div className={`bench-bite ${ui.squeezing ? 'on' : ''}`} title="How deep the knife cuts: set by how hard you squeeze">
              <span>{ui.squeezing ? (ui.bite < 0.34 ? 'thin shaving' : ui.bite < 0.72 ? 'medium cut' : 'deep bite') : 'knife: squeeze to cut'}</span>
              <div className="bite-bar">
                <i style={{ width: `${Math.round(Math.max(0.04, ui.bite) * 100)}%` }} />
              </div>
            </div>
          )}
          {stage && !finished && <div className="bench-stage-tag">{stage.title}</div>}
          <WebcamPreview />
          <PipelineStrip dofOverride={() => session.hands[session.primary].pose?.dof} />
        </div>
      </section>
      {sharing && ui.lastRecording && (
        <ShareDialog
          draft={{
            craft: def.id,
            recording: ui.lastRecording,
            score: ui.score ?? undefined,
            thumb: sharing.thumb,
            learnedFrom: learnFrom ? { id: learnFrom.id, title: learnFrom.title, author: learnFrom.author } : undefined,
          }}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  );
}
