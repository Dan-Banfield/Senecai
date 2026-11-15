// Ocarina hole calibration, one hole at a time. First every finger hovers just
// above its hole (one reading for all ten), then each finger in turn presses its
// own hole. Nothing runs on a timer: a step captures once its pose has been held
// steady for a moment, and every step can be redone, skipped or taken by hand.

import { useEffect, useRef, useState } from 'react';
import { live, useInputDemand, usePipeline } from '../../input/pipeline';
import { FingeringDiagram } from './FingeringDiagram';
import {
  MIN_SPAN,
  SteadyDetector,
  thresholdsFrom,
  useHoleCalibration,
  type HoleCalibration,
  type HoleReadings,
} from './holeCalibration';
import { HOLES } from './types';

/** Calibration order: left hand index to little, its thumb, then the same on the right. */
const ORDER: readonly number[] = (['left', 'right'] as const).flatMap((side) =>
  (['index', 'middle', 'ring', 'little', 'thumb'] as const).map((f) => HOLES.findIndex((h) => h.side === side && h.finger === f)),
);

/** Time to read the instructions before a step starts counting a hold. */
const LEAD_MS = 1500;
/** How long the "got it" tick shows before moving on. */
const CONFIRM_MS = 700;

/** "R.little" -> "Right little finger", "L.thumb" -> "Left thumb". */
export const holeLabel = (i: number) => {
  const h = HOLES[i];
  const name = `${h.side} ${h.finger === 'thumb' ? 'thumb' : `${h.finger} finger`}`;
  return name[0].toUpperCase() + name.slice(1);
};

const flexOf = (i: number): number | null => {
  const h = HOLES[i];
  const v = live.commands[h.side]?.dof[h.dofIndex];
  return v === undefined || !Number.isFinite(v) ? null : v;
};

const emptyCal = (): HoleCalibration => ({ open: HOLES.map(() => null), covered: HOLES.map(() => null) });

type PressPhase = { kind: 'press'; step: number; only: boolean };
type Phase = { kind: 'intro' } | { kind: 'hover' } | PressPhase | { kind: 'done' };

interface LiveState {
  /** Flexion of the hole being pressed (press phase). */
  value: number | null;
  /** Hold progress 0..1. */
  progress: number;
  /** Which hands are visible. */
  left: boolean;
  right: boolean;
  /** The finger has not gone past its hover reading yet. */
  tooLight: boolean;
  /** Just captured: show the tick. */
  captured: boolean;
}

const IDLE: LiveState = { value: null, progress: 0, left: false, right: false, tooLight: false, captured: false };

const nextAfterPress = (p: PressPhase): Phase =>
  p.only || p.step + 1 >= ORDER.length ? { kind: 'done' } : { kind: 'press', step: p.step + 1, only: false };

export function HoleCalibrationWizard({ onClose }: { onClose: () => void }) {
  useInputDemand();
  const kind = usePipeline((s) => s.kind);
  const [phase, setPhase] = useState<Phase>(() =>
    kind && useHoleCalibration.getState().bySource[kind] ? { kind: 'done' } : { kind: 'intro' },
  );
  const [cal, setCal] = useState<HoleCalibration>(() => (kind && useHoleCalibration.getState().bySource[kind]) || emptyCal());
  const [ls, setLs] = useState<LiveState>(IDLE);
  const calRef = useRef(cal);
  calRef.current = cal;

  const save = (next: HoleCalibration) => {
    calRef.current = next;
    setCal(next);
    if (kind) useHoleCalibration.getState().save(kind, next);
  };

  // The live loop for the hover and press steps.
  useEffect(() => {
    if (phase.kind !== 'hover' && phase.kind !== 'press') return;
    const det = new SteadyDetector();
    const t0 = performance.now();
    let raf = 0;
    let doneAt = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const left = !!live.commands.left;
      const right = !!live.commands.right;
      if (doneAt) {
        if (now - doneAt >= CONFIRM_MS) {
          cancelAnimationFrame(raf);
          setLs(IDLE);
          setPhase(phase.kind === 'hover' ? { kind: 'press', step: 0, only: false } : nextAfterPress(phase));
        }
        return;
      }

      if (phase.kind === 'hover') {
        const vals = HOLES.map((_, i) => flexOf(i));
        const present = vals.flatMap((v) => (v === null ? [] : [v]));
        const ready = present.length > 0 && now - t0 >= LEAD_MS;
        if (!ready) det.reset();
        const progress = ready ? det.push(now, present) : 0;
        if (progress >= 1) {
          const mean = det.mean;
          let k = 0;
          const open: HoleReadings = vals.map((v) => (v === null ? null : mean[k++]));
          calRef.current = { ...calRef.current, open };
          setCal(calRef.current);
          doneAt = now;
        }
        setLs({ value: null, progress, left, right, tooLight: false, captured: progress >= 1 });
        return;
      }

      const hole = ORDER[phase.step];
      const v = flexOf(hole);
      const base = calRef.current.open[hole] ?? 0;
      const tooLight = v !== null && v < base + MIN_SPAN;
      const ready = v !== null && !tooLight && now - t0 >= LEAD_MS;
      if (!ready) det.reset();
      const progress = ready ? det.push(now, [v]) : 0;
      if (progress >= 1) {
        const c = calRef.current;
        const covered = det.mean[0];
        save({ ...c, covered: c.covered.map((x, i) => (i === hole ? covered : x)) });
        doneAt = now;
      }
      setLs({ value: v, progress, left, right, tooLight: tooLight && now - t0 >= LEAD_MS, captured: progress >= 1 });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Restarts only when the step changes; `save` and the refs are stable enough for one step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const start = () => {
    calRef.current = emptyCal();
    setCal(calRef.current);
    setPhase({ kind: 'hover' });
  };

  /** Take the current reading as is (press phase). */
  const captureNow = () => {
    if (phase.kind !== 'press' || ls.value === null) return;
    const hole = ORDER[phase.step];
    const v = ls.value;
    save({ ...cal, covered: cal.covered.map((x, i) => (i === hole ? v : x)) });
    setPhase(nextAfterPress(phase));
  };

  const skip = () => {
    if (phase.kind !== 'press') return;
    const hole = ORDER[phase.step];
    save({ ...cal, covered: cal.covered.map((x, i) => (i === hole ? null : x)) });
    setPhase(nextAfterPress(phase));
  };

  const back = () => {
    if (phase.kind !== 'press' || phase.only) return;
    setPhase(phase.step > 0 ? { kind: 'press', step: phase.step - 1, only: false } : { kind: 'hover' });
  };

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal hc-modal" role="dialog" aria-labelledby="hc-title">
        <div className="hc-head">
          <h2 id="hc-title">Calibrate the holes</h2>
          {(phase.kind === 'hover' || phase.kind === 'press') && (
            <span className="hc-count">
              {phase.kind === 'hover' ? 'Step 1 · hover' : phase.only ? 'Redo' : `Hole ${phase.step + 1} of ${ORDER.length}`}
            </span>
          )}
        </div>

        {phase.kind === 'intro' && <Intro onStart={start} onClose={onClose} />}

        {phase.kind === 'hover' && (
          <>
            <p className="hc-lead">
              Rest all ten fingers <b>just above their holes</b>, not touching, the way you hold the ocarina between notes. Keep still.
            </p>
            <FingeringDiagram holes={HOLES.map(() => false)} />
            <Hands left={ls.left} right={ls.right} />
            <HoldBar progress={ls.progress} captured={ls.captured} waiting={!ls.left && !ls.right} />
            <div className="hc-actions">
              <button type="button" className="btn ghost" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {phase.kind === 'press' && (
          <PressStep
            hole={ORDER[phase.step]}
            open={cal.open[ORDER[phase.step]]}
            ls={ls}
            canBack={!phase.only}
            onBack={back}
            onSkip={skip}
            onCapture={captureNow}
          />
        )}

        {phase.kind === 'done' && (
          <Summary
            cal={cal}
            onRedo={(hole) => setPhase({ kind: 'press', step: ORDER.indexOf(hole), only: true })}
            onRestart={start}
            onClose={onClose}
          />
        )}
      </div>
    </>
  );
}

function Intro({ onStart, onClose }: { onStart: () => void; onClose: () => void }) {
  return (
    <>
      <p className="hc-lead">Teach the ocarina how your fingers feel on each hole. It takes about a minute.</p>
      <ol className="hc-steps">
        <li>
          <b>Hover.</b> Rest every finger just above its hole and keep still.
        </li>
        <li>
          <b>Press each hole.</b> One finger at a time, press it down as lightly as you really play, and hold it.
        </li>
      </ol>
      <p className="hc-note">Each step saves itself once you've held still for a moment, so take your time.</p>
      <div className="hc-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={onStart}>
          Start
        </button>
      </div>
    </>
  );
}

function Hands({ left, right }: { left: boolean; right: boolean }) {
  return (
    <div className="hc-hands">
      <span className={left ? 'on' : ''}>Left hand {left ? 'tracked' : 'not seen'}</span>
      <span className={right ? 'on' : ''}>Right hand {right ? 'tracked' : 'not seen'}</span>
    </div>
  );
}

function HoldBar({ progress, captured, waiting, hint }: { progress: number; captured: boolean; waiting?: boolean; hint?: string }) {
  const label = captured
    ? 'Got it'
    : waiting
      ? 'Waiting for your hand…'
      : (hint ?? (progress > 0 ? 'Hold steady…' : 'Get into position'));
  return (
    <div className={`hc-hold${captured ? ' done' : ''}`} aria-live="polite">
      <div className="hc-hold-track">
        <div style={{ width: `${(captured ? 1 : progress) * 100}%` }} />
      </div>
      <span>
        {captured ? '✓ ' : ''}
        {label}
      </span>
    </div>
  );
}

const pct = (v: number) => `${Math.min(1, Math.max(0, v)) * 100}%`;

function PressStep({
  hole,
  open,
  ls,
  canBack,
  onBack,
  onSkip,
  onCapture,
}: {
  hole: number;
  open: number | null;
  ls: LiveState;
  canBack: boolean;
  onBack: () => void;
  onSkip: () => void;
  onCapture: () => void;
}) {
  const h = HOLES[hole];
  const handSeen = h.side === 'left' ? ls.left : ls.right;
  return (
    <>
      <p className="hc-lead">
        Press your <b>{holeLabel(hole).toLowerCase()}</b> onto its hole{h.back ? ' on the back' : ''} and hold it. Keep the other fingers
        hovering.
      </p>
      <FingeringDiagram holes={HOLES.map((_, i) => i === hole && ls.captured)} focus={hole} />
      <div className="hc-meter">
        <div className="hc-meter-track">
          {open !== null && <div className="hc-meter-zone" style={{ left: pct(open + MIN_SPAN) }} />}
          {ls.value !== null && <div className="hc-meter-fill" style={{ width: pct(ls.value) }} />}
          {open !== null && <div className="hc-meter-mark" style={{ left: pct(open) }} />}
        </div>
        <div className="hc-meter-legend">
          <span>open</span>
          {open !== null && <span>| your hover · shaded = pressed</span>}
          <span>fist</span>
        </div>
      </div>
      <HoldBar
        progress={ls.progress}
        captured={ls.captured}
        waiting={!handSeen}
        hint={ls.tooLight ? 'Press a little further' : undefined}
      />
      <div className="hc-actions">
        {canBack && (
          <button type="button" className="btn ghost" onClick={onBack}>
            Back
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="inp-link" onClick={onSkip} title="Keep the default threshold for this hole">
          Skip
        </button>
        <button type="button" className="btn" onClick={onCapture} disabled={ls.value === null || ls.captured} title="Save the current reading now">
          Use this
        </button>
      </div>
    </>
  );
}

function Summary({
  cal,
  onRedo,
  onRestart,
  onClose,
}: {
  cal: HoleCalibration;
  onRedo: (hole: number) => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  const fitted = thresholdsFrom(cal);
  const status = (i: number) => {
    const o = cal.open[i];
    const c = cal.covered[i];
    if (o === null || c === null) return { text: 'Default', cls: 'skip' };
    if (c - o < MIN_SPAN) return { text: 'Barely moved · default', cls: 'weak' };
    return { text: `Covers at ${Math.round(fitted[i].on * 100)}%`, cls: 'ok' };
  };
  return (
    <>
      <p className="hc-lead">Saved. Each hole now covers halfway between your hover and your press. Redo any hole that still feels off.</p>
      <ul className="hc-list">
        {ORDER.map((i) => {
          const s = status(i);
          const o = cal.open[i];
          const c = cal.covered[i];
          return (
            <li key={i}>
              <span className="hc-list-name">{holeLabel(i)}</span>
              <span className="hc-list-range" aria-hidden="true">
                {o !== null && c !== null && <span className={s.cls} style={{ left: pct(Math.min(o, c)), width: pct(Math.abs(c - o)) }} />}
              </span>
              <span className={`hc-list-status ${s.cls}`}>{s.text}</span>
              <button type="button" className="inp-link" onClick={() => onRedo(i)}>
                Redo
              </button>
            </li>
          );
        })}
      </ul>
      <div className="hc-actions">
        <button type="button" className="btn ghost" onClick={onRestart}>
          Start over
        </button>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}
