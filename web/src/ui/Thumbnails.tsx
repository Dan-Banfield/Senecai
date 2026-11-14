import type { Creation } from '../community/api';
import { craftById } from '../crafts/catalog';

const NOTE_COLORS = ['#e9b872', '#9ad1c3', '#f2ede4', '#b7c4e8', '#e8a0a0'];

/** Piano-roll of the plucks. */
export function KanteleThumb({ creation, width = 260, height = 120 }: { creation: Creation; width?: number; height?: number }) {
  const plucks = creation.recording.version === 1 ? creation.recording.events.filter((e) => e.type === 'pluck') : [];
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

export function CreationThumb({ creation }: { creation: Creation }) {
  if (creation.thumb) return <img className="thumb-img" src={creation.thumb} alt="" />;
  if (creation.recording.version === 1) return <KanteleThumb creation={creation} />;
  const photo = craftById(creation.craft)?.image.src;
  return photo ? <img className="thumb-img" src={photo} alt="" /> : null;
}
