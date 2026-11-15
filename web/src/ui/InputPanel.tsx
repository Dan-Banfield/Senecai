import { useEffect, useState } from 'react';
import { calibrationKey, useInputDemand, usePipeline } from '../input/pipeline';
import { SOURCE_LABELS } from '../input/types';
import { Icon } from './icons';
import { SOURCE_INFO, SOURCE_ORDER, sourceFields } from './inputFields';
import { WebcamPreview } from './WebcamPreview';

export function SourcePill() {
  const { kind, status, present, setPanelOpen } = usePipeline();
  // A map-legend cartouche: status symbol, source name, and both hands always shown.
  return (
    <button className="source-pill" onClick={() => setPanelOpen(true)} title={status.message}>
      <span className={`cart-mark ${kind ? status.state : 'idle'}`} aria-hidden="true" />
      <span className="cart-text">
        <span className="cart-name">{kind ? SOURCE_LABELS[kind] : 'Choose input'}</span>
      </span>
      <span className="cart-hands" aria-label={`Left hand ${present.left ? 'tracked' : 'not tracked'}, right hand ${present.right ? 'tracked' : 'not tracked'}`}>
        <span className={present.left ? 'on' : 'off'}>L</span>
        <span className={present.right ? 'on' : 'off'}>R</span>
      </span>
    </button>
  );
}

export function CalibrationWizard({ onClose }: { onClose: () => void }) {
  // Calibrating reads live hands.
  useInputDemand();
  const calibrate = usePipeline((s) => s.calibrate);
  const [step, setStep] = useState<'open' | 'fist' | 'done'>('open');
  const [count, setCount] = useState(3);
  const [error, setError] = useState('');

  useEffect(() => {
    if (step === 'done') return;
    if (count > 0) {
      const id = setTimeout(() => setCount((c) => c - 1), 1000);
      return () => clearTimeout(id);
    }
    const side = calibrate(step);
    if (!side) {
      setError('No hand detected. Make sure your hand is visible / the gloves are streaming.');
      setCount(3);
      return;
    }
    setError('');
    setStep(step === 'open' ? 'fist' : 'done');
    setCount(3);
  }, [count, step, calibrate]);

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal">
        <h2>Calibrate your hand</h2>
        {step === 'open' && <p>Hold your hand <b>open and relaxed</b>, in a comfortable spot in front of you. This sets "open", the neutral wrist angle, and the centre of your workspace.</p>}
        {step === 'fist' && <p>Now make a <b>tight fist</b> with your thumb tucked across your fingers.</p>}
        {step === 'done' && <p>Done. The robot hand now follows your range of motion. Recalibrate any time.</p>}
        {step !== 'done' ? <div className="calib-big">{count}</div> : <div className="calib-big">✓</div>}
        {error && <p style={{ color: 'var(--warn)' }}>{error}</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn primary" onClick={onClose}>
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </>
  );
}

/** The cameras the browser can see. Their names only appear once camera permission has been granted, so re-read when the input's status changes. */
function useCameras(enabled: boolean, statusState: string) {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!enabled || !media?.enumerateDevices) return;
    let cancelled = false;
    const read = () =>
      void media
        .enumerateDevices()
        .then((all) => !cancelled && setCameras(all.filter((d) => d.kind === 'videoinput' && d.deviceId)))
        .catch(() => {});
    read();
    media.addEventListener('devicechange', read);
    return () => {
      cancelled = true;
      media.removeEventListener('devicechange', read);
    };
  }, [enabled, statusState]);
  return cameras;
}


/** Render `code` spans in a setup note. */
function SetupNote({ text }: { text: string }) {
  return <p className="inp-note">{text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}</p>;
}

/** The keyboard map as key chips: "A S D F G = thumb…little · Space = fist" → rows of <kbd> + meaning. */
function KeyMap({ text }: { text: string }) {
  return (
    <dl className="inp-keys">
      {text.split(' · ').map((entry) => {
        const [keys, meaning] = entry.split(' = ');
        return (
          <div key={entry}>
            <dt>{keys.split(' ').map((k) => <kbd key={k}>{k}</kbd>)}</dt>
            <dd>{meaning}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function InputPanel() {
  const { panelOpen, setPanelOpen, kind, status, present, start, stop, settings, updateSettings, resetCalibration, calibrations, calibrationContext, fps } = usePipeline();
  const calibrated = kind ? !!calibrations[calibrationKey(kind, calibrationContext)] : false;
  const [calibrating, setCalibrating] = useState(false);
  const [bridgeUrl, setBridgeUrl] = useState(settings.bridgeUrl);
  const fields = sourceFields(kind);
  const cameras = useCameras(panelOpen && fields.includes('camera'), status.state);
  // The drawer shows the live input (status, fps, camera preview), so the source runs while it is open.
  useInputDemand(panelOpen);
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanelOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, setPanelOpen]);
  if (!panelOpen) return calibrating ? <CalibrationWizard onClose={() => setCalibrating(false)} /> : null;

  const hands = [present.left && 'L', present.right && 'R'].filter(Boolean).join(' + ');
  // The keyboard source reports its whole key map as its status; that lives in the fold instead.
  const statusText = kind === 'keyboard' && status.state === 'live' ? 'Live' : status.message;

  return (
    <>
      <div className="drawer-backdrop" onClick={() => setPanelOpen(false)} />
      <aside className="drawer" aria-label="Hand input">
        <header className="inp-head">
          <div>
            <h2>Hand input</h2>
          </div>
          <button className="oc-icon-btn ghost" onClick={() => setPanelOpen(false)} aria-label="Close" title="Close (Esc)">
            <Icon name="close" />
          </button>
        </header>

        <div className="inp-sources" role="radiogroup" aria-label="Input source">
          {SOURCE_ORDER.map((k) => {
            const info = SOURCE_INFO[k];
            const on = kind === k;
            return (
              <button key={k} role="radio" aria-checked={on} className={`inp-source${on ? ' on' : ''}`} onClick={() => !on && void start(k)}>
                <span className="inp-source-ico"><Icon name={info.icon} size={22} /></span>
                <span className="inp-source-text">
                  <b>{SOURCE_LABELS[k]}</b>
                  <span>{info.blurb}</span>
                </span>
                <span className="inp-radio" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        {kind && (
          <section className="inp-section">
            <div className="inp-status">
              <span className={`dot ${status.state}`} />
              <span className="inp-status-text">{statusText}</span>
              <span className="inp-status-meta mono">
                {fps} fps{hands && ` · ${hands}`}
              </span>
              <button className="inp-link" onClick={() => { stop(); usePipeline.setState({ lastKind: null }); }}>Stop</button>
            </div>
            {status.state !== 'error' && <WebcamPreview />}
            <div className="inp-calib">
              <span>
                <b>Calibration</b>
                {calibrated ? 'Fitted to your hand.' : 'Using defaults. Six seconds makes it feel much better.'}
              </span>
              <span className="row">
                {calibrated && <button className="inp-link" onClick={resetCalibration}>Reset</button>}
                <button className="btn primary small" onClick={() => { setCalibrating(true); setPanelOpen(false); }}>
                  {calibrated ? 'Recalibrate' : 'Calibrate'}
                </button>
              </span>
            </div>
          </section>
        )}

        <section className="inp-section inp-settings">
          <h3>Settings</h3>
          <div className="inp-field">
            <span>Dominant hand</span>
            <div className="inp-seg" role="radiogroup" aria-label="Dominant hand">
              {(['left', 'right'] as const).map((side) => (
                <button key={side} role="radio" aria-checked={settings.dominant === side} className={settings.dominant === side ? 'on' : ''} onClick={() => updateSettings({ dominant: side })}>
                  {side === 'left' ? 'Left' : 'Right'}
                </button>
              ))}
            </div>
          </div>
          {fields.includes('camera') && (
            <label className="inp-field">
              <span>Camera</span>
              <select value={cameras.some((c) => c.deviceId === settings.cameraId) ? settings.cameraId : ''} onChange={(e) => updateSettings({ cameraId: e.target.value })}>
                <option value="">Default camera</option>
                {cameras.map((c, i) => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {fields.includes('swapHands') && (
            <label className="inp-check">
              <input type="checkbox" checked={settings.swapHands} onChange={(e) => updateSettings({ swapHands: e.target.checked })} />
              <span>Swap left and right</span>
            </label>
          )}
        </section>

        <details className="inp-fold">
          <summary>
            <Icon name="chevron" size={14} /> Setup &amp; advanced
          </summary>
          <div className="inp-fold-body">
            {kind === 'keyboard' ? <KeyMap text={SOURCE_INFO.keyboard.setup} /> : kind && <SetupNote text={SOURCE_INFO[kind].setup} />}
            {fields.includes('bridgeUrl') && (
              <label className="inp-field">
                <span>Bridge URL</span>
                <input type="text" spellCheck={false} value={bridgeUrl} onChange={(e) => setBridgeUrl(e.target.value)} onBlur={() => bridgeUrl !== settings.bridgeUrl && updateSettings({ bridgeUrl })} />
              </label>
            )}
            <label className="inp-check">
              <input type="checkbox" checked={settings.mirrorRobot} onChange={(e) => updateSettings({ mirrorRobot: e.target.checked })} />
              <span>Mirror to the physical robot hand (via the bridge)</span>
            </label>
          </div>
        </details>
      </aside>
    </>
  );
}
