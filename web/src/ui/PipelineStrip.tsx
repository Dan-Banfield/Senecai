// Live view of the data flow, for the user and for judges: what the source
// streamed (Rokoko JSON), and the six actuator commands the robot received.

import { useEffect, useState } from 'react';
import { live, primaryCommand, usePipeline } from '../input/pipeline';
import { DOF_LABELS, toInspireAngles } from '../robot/retarget';

export function PipelineStrip({ dofOverride }: { dofOverride?: () => number[] | undefined }) {
  const [, force] = useState(0);
  const kind = usePipeline((s) => s.kind);
  const fps = usePipeline((s) => s.fps);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 80);
    return () => clearInterval(id);
  }, []);

  const cmd = primaryCommand();
  const dof = dofOverride?.() ?? cmd?.dof;
  const side = cmd?.side ?? 'right';
  const actor = live.frame?.scene.actors[0];
  const j = actor?.body[`${side}IndexMedial`];
  const json = actor
    ? `{ "version": ${live.frame!.version}, "fps": ${live.frame!.fps},\n  "actors": [{ "name": "${actor.name}",\n    "${side}IndexMedial": { "rotation":\n      { "x": ${j?.rotation.x.toFixed(3) ?? '–'}, "y": ${j?.rotation.y.toFixed(3) ?? '–'}, "z": ${j?.rotation.z.toFixed(3) ?? '–'}, "w": ${j?.rotation.w.toFixed(3) ?? '–'} } } …`
    : 'waiting for frames…';

  return (
    <div className="strip">
      <div className="strip-box">
        <h4>Rokoko JSON v3 · {kind ?? 'no source'} · {fps} fps</h4>
        <div className="frame-json">{json}</div>
      </div>
      <div className="strip-arrow">→</div>
      <div className="strip-box">
        <h4>Retarget → 6-DoF robot hand {dof ? `· inspire [${toInspireAngles(dof as never).join(', ')}]` : ''}</h4>
        <div className="dof-bars">
          {DOF_LABELS.map((label, i) => (
            <div className="dof-bar" key={label}>
              <div className="fill" style={{ height: `${Math.round((dof?.[i] ?? 0) * 40) + 2}px`, opacity: dof ? 1 : 0.3 }} />
              <span>{label.replace('Thumb ', 'T.')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
