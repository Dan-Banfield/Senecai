import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { community, type Creation } from '../community/api';
import { LESSONS, lessonFromRecording, STRINGS, type Lesson } from '../crafts/kantele/music';
import { KanteleStage } from '../crafts/kantele/KanteleStage';
import { KanteleSession, useKanteleUi } from '../crafts/kantele/session';
import { usePipeline } from '../input/pipeline';
import { PipelineStrip } from '../ui/PipelineStrip';
import { ShareDialog } from '../ui/ShareDialog';
import { WebcamPreview } from '../ui/WebcamPreview';
import { NoInputCard, NoHandHint } from './common';

export function KantelePage() {
  const [params, setParams] = useSearchParams();
  const mode = params.get('mode') === 'play' ? 'play' : 'learn';
  const fromId = params.get('from');
  const [fromCreation, setFromCreation] = useState<Creation | null>(null);
  const [lessonId, setLessonId] = useState(LESSONS[0].id);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!fromId) return setFromCreation(null);
    void community.get(fromId).then((c) => {
      if (c?.craft === 'kantele') {
        setFromCreation(c);
        setLessonId(`creation-${c.id}`);
      }
    });
  }, [fromId]);

  const lessons: Lesson[] = useMemo(() => (fromCreation ? [lessonFromRecording(fromCreation), ...LESSONS] : LESSONS), [fromCreation]);
  const lesson = lessons.find((l) => l.id === lessonId) ?? lessons[0];

  const session = useMemo(() => new KanteleSession(mode === 'play' ? { kind: 'free' } : { kind: 'lesson', lesson }), [mode, lesson]);
  useEffect(() => {
    session.activate();
    return () => session.dispose();
  }, [session]);

  const ui = useKanteleUi();
  const present = usePipeline((s) => s.present);
  const side = usePipeline((s) => (s.present[s.settings.dominant] ? s.settings.dominant : s.present.left && !s.present.right ? 'left' : 'right'));
  useEffect(() => session.setSide(side), [session, side]);
  const score = ui.total ? Math.round(((ui.counts.perfect * 100 + ui.counts.good * 60) / ui.total) || 0) : 0;
  const showFeedback = ui.feedback && performance.now() - ui.feedback.at < 900;

  return (
    <div className="workspace">
      <aside className="panel">
        <div>
          <h1>Kantele</h1>
          <div className="fi">the five-string kantele · viisikielinen kantele</div>
        </div>
        <div className="tabs">
          <button className={mode === 'learn' ? 'on' : ''} onClick={() => setParams(fromId ? { from: fromId } : {})}>Learn</button>
          <button className={mode === 'play' ? 'on' : ''} onClick={() => setParams({ mode: 'play' })}>Free play</button>
        </div>
        <NoInputCard />

        {mode === 'learn' ? (
          <>
            <div className="lesson-list">
              {lessons.map((l) => (
                <button key={l.id} className={`lesson-item ${l.id === lesson.id ? 'on' : ''}`} onClick={() => setLessonId(l.id)}>
                  <b>{l.fromCreation ? `★ ${l.title}` : l.title}</b>
                  <span>{l.fromCreation ? `from the community, by ${l.fromCreation.author}` : l.wait ? 'at your own pace' : 'in time'} · {l.notes.length} notes</span>
                </button>
              ))}
            </div>
            <div className="card">
              <h3>{lesson.title}</h3>
              <p>{lesson.description}</p>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn primary" onClick={() => session.start()}>
                  {ui.phase === 'ready' ? 'Start' : 'Restart'}
                </button>
                {lesson.fromCreation && (
                  <Link className="btn small ghost" to={`/community/${lesson.fromCreation.id}`}>
                    Watch original
                  </Link>
                )}
              </div>
            </div>
            <div className="stats">
              <div><b>{ui.counts.perfect}</b><span>perfect</span></div>
              <div><b>{ui.counts.good}</b><span>good</span></div>
              <div><b>{ui.counts.miss}</b><span>missed</span></div>
            </div>
            <div className="meter"><div style={{ width: `${ui.total ? (ui.done / ui.total) * 100 : 0}%` }} /></div>
            {ui.phase === 'finished' && (
              <div className="card">
                <h3>Lesson complete: {score}%</h3>
                <p>{score > 85 ? 'Wonderful playing! Try free play and share your own piece.' : 'Nice! Run it again to tighten your timing.'}</p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="card">
              <h3>Compose your own</h3>
              <p>Play anything you like. Press record, play, then share it. Others will be able to learn it with your recorded hand as their guide.</p>
              <div className="row" style={{ marginTop: 14 }}>
                <button className={`btn ${ui.recording ? 'rec' : 'primary'}`} onClick={() => session.toggleRecording()}>
                  {ui.recording ? `■ Stop (${ui.recordedPlucks} notes)` : '● Record'}
                </button>
                {ui.lastRecording && !ui.recording && (
                  <button className="btn" onClick={() => setSharing(true)}>
                    Share…
                  </button>
                )}
              </div>
            </div>
            <div className="card">
              <h3>Need ideas?</h3>
              <p>
                Browse the <Link to="/community">community</Link> for pieces to learn from, or try the runo rhythm: eight notes, then a breath.
              </p>
            </div>
          </>
        )}
      </aside>

      <section className="stage">
        <KanteleStage session={session} side={side} />
        <div className="stage-overlay">
          <div className="legend">
            {STRINGS.map((s, i) => (
              <span key={s.note} style={{ color: ['#e9b872', '#9ad1c3', '#f2ede4', '#b7c4e8', '#e8a0a0'][i] }}>
                {s.note} · {s.finger}
              </span>
            ))}
          </div>
          {showFeedback && <div className={`feedback ${ui.feedback!.kind}`}>{ui.feedback!.text}</div>}
          {ui.phase === 'countdown' && ui.countdown > 0 && (
            <div className="center-msg">
              <div className="countdown">{ui.countdown}</div>
            </div>
          )}
          {!present.left && !present.right && <NoHandHint />}
          <WebcamPreview />
          <PipelineStrip />
        </div>
      </section>
      {sharing && ui.lastRecording && (
        <ShareDialog
          draft={{ craft: 'kantele', recording: ui.lastRecording, learnedFrom: fromCreation ? { id: fromCreation.id, title: fromCreation.title, author: fromCreation.author } : undefined }}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}
