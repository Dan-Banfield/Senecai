import { useEffect, useState } from 'react';
import { calibrationKey, usePipeline } from '../input/pipeline';
import { KEYBOARD_HELP } from '../input/keyboardSource';
import type { Rotation } from '../input/gloveTracker';
import { SOURCE_LABELS, type SourceKind } from '../input/types';

const SOURCES: { kind: SourceKind; icon: string; desc: string }[] = [
  { kind: 'webcam', icon: '📷', desc: 'Emulates the gloves with webcam hand tracking. Same Rokoko JSON v3 frames, no hardware.' },
  { kind: 'fused', icon: '🧤📷', desc: 'Best with Smartgloves: the gloves drive your fingers and wrist, a camera looking down at the table tracks where the gloves are. Needs the bridge (npm run bridge:sdk) and an overhead camera.' },
  { kind: 'gloves', icon: '🧤', desc: 'Rokoko Device SDK (Linux, macOS, Windows) or Rokoko Studio → bridge (npm run bridge) → here. Without a Coil Pro the gloves can\'t track where your hands are, so you aim by tilting your wrist.' },
  { kind: 'keyboard', icon: '⌨️', desc: KEYBOARD_HELP },
];

export function SourcePill() {
  const { kind, status, present, setPanelOpen } = usePipeline();
  const hands = [present.left && 'L', present.right && 'R'].filter(Boolean).join('+');
  return (
    <button className="source-pill" onClick={() => setPanelOpen(true)} title={status.message}>
      <span className={`dot ${status.state}`} />
      {kind ? SOURCE_LABELS[kind] : 'Choose input'}
      {hands && <span className="mono" style={{ color: 'var(--muted)' }}>{hands}</span>}
    </button>
  );
}

export function CalibrationWizard({ onClose }: { onClose: () => void }) {
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

export function InputPanel() {
  const { panelOpen, setPanelOpen, kind, status, start, stop, settings, updateSettings, resetCalibration, calibrations, calibrationContext, fps } = usePipeline();
  const calibrated = kind ? !!calibrations[calibrationKey(kind, calibrationContext)] : false;
  const [calibrating, setCalibrating] = useState(false);
  const [bridgeUrl, setBridgeUrl] = useState(settings.bridgeUrl);
  const cameras = useCameras(panelOpen, status.state);
  if (!panelOpen) return calibrating ? <CalibrationWizard onClose={() => setCalibrating(false)} /> : null;

  return (
    <>
      <div className="drawer-backdrop" onClick={() => setPanelOpen(false)} />
      <aside className="drawer">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Hand input</h2>
          <button className="btn small ghost" onClick={() => setPanelOpen(false)}>Close</button>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {SOURCES.map((s) => (
            <button key={s.kind} className={`source-option ${kind === s.kind ? 'on' : ''}`} onClick={() => {
                if (kind === s.kind) {
                  stop();
                  usePipeline.setState({ lastKind: null });
                } else void start(s.kind);
              }}>
              <span className="ico">{s.icon}</span>
              <span>
                <b>{SOURCE_LABELS[s.kind]}</b>
                <span>{s.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="status-line">
          <span className={`dot ${status.state}`} /> {status.message} {kind && `· ${fps} fps`}
        </div>

        {kind && (
          <div className="card">
            <h3>Calibration</h3>
            <p>
              {calibrated ? 'Calibrated for this input.' : 'Using defaults (auto-range is on). A 6-second calibration makes it feel much better.'}
            </p>
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="btn primary small"
                onClick={() => {
                  setCalibrating(true);
                  setPanelOpen(false);
                }}
              >
                Calibrate
              </button>
              {calibrated && (
                <button className="btn small" onClick={resetCalibration}>
                  Reset
                </button>
              )}
            </div>
          </div>
        )}

        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <h3>Settings</h3>
          <label className="field">
            Dominant hand (drives the knife / plucks)
            <select value={settings.dominant} onChange={(e) => updateSettings({ dominant: e.target.value as 'left' | 'right' })}>
              <option value="right">Right</option>
              <option value="left">Left</option>
            </select>
          </label>
          <label className="field">
            Camera (hand tracking)
            <select value={cameras.some((c) => c.deviceId === settings.cameraId) ? settings.cameraId : ''} onChange={(e) => updateSettings({ cameraId: e.target.value })}>
              <option value="">Default camera</option>
              {cameras.map((c, i) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          {kind === 'fused' && (
            <label className="field">
              Turn the overhead picture so you sit at its bottom
              <select value={settings.cameraRotation ?? 0} onChange={(e) => updateSettings({ cameraRotation: Number(e.target.value) as Rotation })}>
                <option value={0}>Not turned</option>
                <option value={90}>90° clockwise</option>
                <option value={180}>Upside down (180°)</option>
                <option value={270}>90° anticlockwise</option>
              </select>
            </label>
          )}
          <label className="toggle">
            <input type="checkbox" checked={settings.swapHands} onChange={(e) => updateSettings({ swapHands: e.target.checked })} /> Swap left/right (webcam)
          </label>
          <label className="field">
            Bridge URL (for gloves)
            <input type="text" value={bridgeUrl} onChange={(e) => setBridgeUrl(e.target.value)} onBlur={() => bridgeUrl !== settings.bridgeUrl && updateSettings({ bridgeUrl })} />
          </label>
          <label className="toggle">
            <input type="checkbox" checked={settings.mirrorRobot} onChange={(e) => updateSettings({ mirrorRobot: e.target.checked })} /> Mirror to physical robot hand via bridge
          </label>
        </div>
      </aside>
    </>
  );
}
