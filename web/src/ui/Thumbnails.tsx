import { useMemo } from 'react';
import type { Creation } from '../community/api';
import { decodeShape, DIM } from '../crafts/kuksa/voxels';

const NOTE_COLORS = ['#e9b872', '#9ad1c3', '#f2ede4', '#b7c4e8', '#e8a0a0'];

/** Piano-roll of the plucks. */
export function KanteleThumb({ creation, width = 260, height = 120 }: { creation: Creation; width?: number; height?: number }) {
  const plucks = creation.recording.events.filter((e) => e.type === 'pluck');
  const dur = Math.max(1, creation.recording.durationMs);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {[0, 1, 2, 3, 4].map((s) => (
        <line key={s} x1={10} x2={width - 10} y1={height - 18 - s * ((height - 36) / 4)} y2={height - 18 - s * ((height - 36) / 4)} stroke="#2c3a3e" />
      ))}
      {plucks.map((p, i) =>
        p.type === 'pluck' ? <circle key={i} cx={10 + (p.t / dur) * (width - 20)} cy={height - 18 - p.string * ((height - 36) / 4)} r={4} fill={NOTE_COLORS[p.string]} /> : null,
      )}
    </svg>
  );
}

/** Side silhouette + top view of the carved shape. */
export function KuksaThumb({ shape, width = 260, height = 120 }: { shape: string; width?: number; height?: number }) {
  const { side, top } = useMemo(() => {
    const g = decodeShape(shape);
    const side: boolean[][] = [];
    const top: number[][] = [];
    for (let y = 0; y < DIM.y; y++) {
      side[y] = [];
      for (let x = 0; x < DIM.x; x++) {
        let any = false;
        for (let z = 0; z < DIM.z && !any; z++) any = !!g.get(x, y, z);
        side[y][x] = any;
      }
    }
    for (let z = 0; z < DIM.z; z++) {
      top[z] = [];
      for (let x = 0; x < DIM.x; x++) {
        let h = -1;
        for (let y = DIM.y - 1; y >= 0 && h < 0; y--) if (g.get(x, y, z)) h = y;
        top[z][x] = h;
      }
    }
    return { side, top };
  }, [shape]);
  const cs = Math.min((width / 2 - 16) / DIM.x, (height - 16) / Math.max(DIM.y, DIM.z));
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <g transform={`translate(8, ${(height - DIM.y * cs) / 2})`}>
        {side.map((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x * cs} y={(DIM.y - 1 - y) * cs} width={cs + 0.3} height={cs + 0.3} fill="#e1c79a" /> : null)))}
      </g>
      <g transform={`translate(${width / 2 + 8}, ${(height - DIM.z * cs) / 2})`}>
        {top.map((row, z) =>
          row.map((h, x) => (h >= 0 ? <rect key={`${x}-${z}`} x={x * cs} y={z * cs} width={cs + 0.3} height={cs + 0.3} fill={`hsl(35, 45%, ${28 + (h / DIM.y) * 52}%)`} /> : null)),
        )}
      </g>
    </svg>
  );
}

export function CreationThumb({ creation }: { creation: Creation }) {
  return creation.craft === 'kuksa' && creation.shape ? <KuksaThumb shape={creation.shape} /> : <KanteleThumb creation={creation} />;
}
