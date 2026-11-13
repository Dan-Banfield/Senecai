import { usePipeline } from '../input/pipeline';

export function NoInputCard() {
  const kind = usePipeline((s) => s.kind);
  const start = usePipeline((s) => s.start);
  const setPanelOpen = usePipeline((s) => s.setPanelOpen);
  if (kind) return null;
  return (
    <div className="card" style={{ borderColor: 'var(--copper)' }}>
      <h3>Connect your hands</h3>
      <p>No gloves yet? Use your webcam as a glove emulator. It streams the same Rokoko data format.</p>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary small" onClick={() => start('webcam')}>Use webcam</button>
        <button className="btn small" onClick={() => setPanelOpen(true)}>Other inputs</button>
      </div>
    </div>
  );
}

export function NoHandHint() {
  const kind = usePipeline((s) => s.kind);
  const status = usePipeline((s) => s.status);
  if (!kind) return <div className="hint">Choose a hand input to bring the robot hand to life.</div>;
  return <div className="hint">{status.message}</div>;
}
