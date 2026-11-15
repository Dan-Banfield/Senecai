// Ten-dot ocarina fingering chart, as seen from the player.

import { HOLES, type HoleStates } from './types';

/** Diagram order, as seen from the player: left hand on the left, index fingers in the middle. */
const TOP_ROW = ['L.little', 'L.ring', 'L.middle', 'L.index', 'R.index', 'R.middle', 'R.ring', 'R.little'];
const BACK_ROW = ['L.thumb', 'R.thumb'];
const holeIndex = (id: string) => HOLES.findIndex((h) => h.id === id);

/**
 * Ten-dot fingering chart: filled = covered. With `target`, holes to cover are outlined and wrong holes ringed.
 * `silent` marks a rest: holes fade and a "Wait" label sits in the middle.
 */
export function FingeringDiagram({
  holes,
  target,
  silent = false,
  focus,
}: {
  holes: HoleStates;
  target?: HoleStates;
  silent?: boolean;
  /** One hole to point at (a pulsing ring), e.g. the hole being calibrated. */
  focus?: number;
}) {
  const dot = (id: string, x: number, y: number, r: number) => {
    const i = holeIndex(id);
    const covered = !!holes[i];
    const want = target?.[i];
    const wrong = target !== undefined && covered !== !!want;
    return (
      <g key={id}>
        <title>{`${id}: ${covered ? 'covered' : 'open'}${target ? (want ? ' (cover)' : ' (lift)') : ''}`}</title>
        {wrong && <circle className="oc-miss" cx={x} cy={y} r={r + 4.5} />}
        {focus === i && <circle className="oc-focus" cx={x} cy={y} r={r + 5} />}
        <circle className={`oc-hole${covered ? ' covered' : ''}${want ? ' target' : ''}`} cx={x} cy={y} r={r} />
      </g>
    );
  };
  return (
    <svg className={`oc-diagram${silent ? ' silent' : ''}`} viewBox="0 0 280 74" role="img" aria-label={silent ? 'Fingering chart: wait' : 'Fingering chart'}>
      <line className="oc-split" x1={140} y1={8} x2={140} y2={66} />
      {TOP_ROW.map((id, k) => dot(id, k < 4 ? 20 + k * 30 : 170 + (k - 4) * 30, 24, 10))}
      {BACK_ROW.map((id, k) => dot(id, k === 0 ? 100 : 180, 58, 7))}
      <text className="oc-label" x={6} y={70}>L</text>
      <text className="oc-label" x={268} y={70}>R</text>
      {silent && (
        <g className="oc-silent" aria-hidden="true">
          <rect x={96} y={30} width={88} height={24} rx={3} />
          <text x={140} y={46} textAnchor="middle">
            Wait
          </text>
        </g>
      )}
    </svg>
  );
}

/** Hole indices in diagram reading order: left hand little..index, right hand index..little, then the thumbs. */
export const DIAGRAM_ORDER: readonly number[] = [...TOP_ROW, ...BACK_ROW].map(holeIndex);
