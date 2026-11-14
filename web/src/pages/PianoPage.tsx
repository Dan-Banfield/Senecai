import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { unlockPiano } from '../crafts/piano/audio';
import { noteName, RIGHT_FINGERING, SONG } from '../crafts/piano/keys';
import { PianoStage } from '../crafts/piano/PianoStage';
import { PianoSession, usePianoUi, type PianoMode } from '../crafts/piano/session';
import { usePipeline } from '../input/pipeline';
import { CalibrationWizard } from '../ui/InputPanel';
import { PipelineStrip } from '../ui/PipelineStrip';
import { WebcamPreview } from '../ui/WebcamPreview';
import { NoHandHint, NoInputCard } from './common';

export function PianoPage() {
  const [params, setParams] = useSearchParams();
  const mode: PianoMode = params.get('mode') === 'play' ? 'free' : 'learn';
  const session = useMemo(() => new PianoSession(mode), [mode]);
  useEffect(() => {
    session.activate();
    if (import.meta.env.DEV) Object.assign(window, { senecaiPiano: session });
    return () => session.dispose();
  }, [session]);
  // Browsers only allow sound after the page has been interacted with.
  useEffect(() => {
    const unlock = () => unlockPiano();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const ui = usePianoUi();
  const present = usePipeline((s) => s.present);
  const kind = usePipeline((s) => s.kind);
  const calibrated = usePipeline((s) => !!(s.kind && s.calibrations[`${s.kind}:piano`]));
  const [calibrating, setCalibrating] = useState(false);
  const next = SONG[ui.step];
  const showFeedback = ui.feedback && performance.now() - ui.feedback.at < 1400;
  const accuracy = ui.hits + ui.misses ? Math.round((ui.hits / (ui.hits + ui.misses)) * 100) : 0;

  return (
    <div className="workspace">
      <aside className="panel">
        <div>
          <h1>Piano</h1>
          <div className="fi">pianoforte · Bartolomeo Cristofori, Florence, c. 1700</div>
        </div>
        <div className="tabs">
          <button className={mode === 'learn' ? 'on' : ''} onClick={() => setParams({})}>Learn</button>
          <button className={mode === 'free' ? 'on' : ''} onClick={() => setParams({ mode: 'play' })}>Free play</button>
        </div>
        <NoInputCard />

        {kind && (
          <div className="card">
            <h3>{calibrated ? 'Calibrated for the piano' : 'Calibrate for the piano'}</h3>
            <p>
              Rest your hands on a table as if on the keys (palms down, fingers gently curved), then press down. Your resting hands become the robot's hands on the keys:
              right thumb on middle C, left hand an octave lower.
            </p>
            <div className="row" style={{ marginTop: 12 }}>
              <button className={`btn small ${calibrated ? '' : 'primary'}`} onClick={() => setCalibrating(true)}>
                {calibrated ? 'Recalibrate' : 'Calibrate'}
              </button>
            </div>
          </div>
        )}

        {mode === 'learn' ? (
          <>
            <div className="card">
              <h3>Mary Had a Little Lamb</h3>
              <p>
                Right hand in the C position: thumb on C, index on D, middle on E, little finger on G. Press the glowing key; each one lights up the next. Notes only sound when a robot
                fingertip pushes a key down, so press, don't just curl.
              </p>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn primary" onClick={() => session.start()}>
                  {ui.phase === 'playing' ? 'Restart' : 'Start'}
                </button>
                <button className="btn" onClick={() => session.listen()} disabled={ui.phase === 'listening'}>
                  {ui.phase === 'listening' ? 'Listening…' : '♪ Listen first'}
                </button>
              </div>
            </div>
            <div className="stats">
              <div>
                <b>{ui.hits}</b>
                <span>right notes</span>
              </div>
              <div>
                <b>{ui.misses}</b>
                <span>wrong keys</span>
              </div>
              <div>
                <b>
                  {Math.min(ui.step, SONG.length)}/{SONG.length}
                </b>
                <span>of the song</span>
              </div>
            </div>
            <div className="meter">
              <div style={{ width: `${(ui.step / SONG.length) * 100}%` }} />
            </div>
            {ui.phase === 'finished' && (
              <div className="card">
                <h3>You played it! {accuracy}% accurate</h3>
                <p>{accuracy > 85 ? 'Lovely. Try it again without looking at the glowing keys.' : 'Nice. Play it again to cut down the wrong keys.'}</p>
              </div>
            )}
          </>
        ) : (
          <div className="card">
            <h3>Free play</h3>
            <p>Play anything. Move your hands to reach other keys; lift your wrist to play the black keys at the back.</p>
            <p className="mono" style={{ marginTop: 10, minHeight: 20 }}>
              {ui.played.join(' ') || 'Notes you play appear here.'}
            </p>
          </div>
        )}
      </aside>

      <section className="stage">
        <PianoStage session={session} />
        <div className="stage-overlay">
          {mode === 'learn' && ui.phase === 'playing' && next && (
            <div className="bench-stage-tag">
              Next: {noteName(next[0])} · {RIGHT_FINGERING[next[0]]} · “{next[2]}”
            </div>
          )}
          {showFeedback && (
            <div className={`feedback ${ui.feedback!.kind}`} style={{ top: 62 }}>
              {ui.feedback!.text}
            </div>
          )}
          {!present.left && !present.right && <NoHandHint />}
          <WebcamPreview />
          <PipelineStrip />
        </div>
      </section>
      {calibrating && <CalibrationWizard onClose={() => setCalibrating(false)} />}
    </div>
  );
}
