// Camera picture-in-picture: the mirrored webcam with the tracked hand skeleton
// on top, or (gloves + camera) the turned overhead view with each glove marked.

import { useEffect, useRef } from 'react';
import { live, usePipeline } from '../input/pipeline';
import { FusedSource } from '../input/fusedSource';
import { drawRotated, rotatedSize } from '../input/gloveTracker';
import { WebcamSource } from '../input/webcamSource';

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

function drawOverhead(c: HTMLCanvasElement, src: FusedSource) {
  const cam = src.camera;
  const v = cam.video;
  if (v.readyState < 2 || !v.videoWidth) return;
  const [w, h] = rotatedSize(320, Math.round((320 * v.videoHeight) / v.videoWidth), cam.rotation);
  // Keep the preview no wider than usual when the picture is turned on its side.
  const k = 320 / Math.max(w, h);
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const ctx = c.getContext('2d')!;
  ctx.globalAlpha = 0.85;
  drawRotated(ctx, v, cam.rotation, c.width, c.height);
  ctx.globalAlpha = 1;
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const side of ['left', 'right'] as const) {
    const p = cam.hands[side];
    if (!p) continue;
    const x = p.x * c.width;
    const y = p.y * c.height;
    ctx.fillStyle = side === 'right' ? '#5fa36b' : '#7fd1e8';
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14191b';
    ctx.fillText(side === 'right' ? 'R' : 'L', x, y + 0.5);
  }
  // You sit at the bottom edge.
  ctx.fillStyle = 'rgba(20,25,27,0.6)';
  ctx.fillRect(0, c.height - 16, c.width, 16);
  ctx.fillStyle = '#f2ede4';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('you sit here', c.width / 2, c.height - 8);
}

export function WebcamPreview() {
  const kind = usePipeline((s) => s.kind);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (kind !== 'webcam' && kind !== 'fused') return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c) return;
      if (live.source instanceof FusedSource) return drawOverhead(c, live.source);
      const src = live.source;
      if (!(src instanceof WebcamSource)) return;
      const ctx = c.getContext('2d')!;
      const v = src.video;
      if (v.readyState < 2) return;
      c.width = 320;
      c.height = Math.round((320 * v.videoHeight) / v.videoWidth) || 240;
      ctx.save();
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      ctx.globalAlpha = 1;
      const res = src.lastResult;
      res?.landmarks.forEach((lm, i) => {
        const right = res.handedness[i]?.[0]?.categoryName !== 'Left';
        ctx.strokeStyle = right ? '#5fa36b' : '#7fd1e8';
        ctx.lineWidth = 2.5;
        for (const [a, b] of BONES) {
          ctx.beginPath();
          ctx.moveTo(lm[a].x * c.width, lm[a].y * c.height);
          ctx.lineTo(lm[b].x * c.width, lm[b].y * c.height);
          ctx.stroke();
        }
        ctx.fillStyle = '#f2ede4';
        for (const p of lm) {
          ctx.beginPath();
          ctx.arc(p.x * c.width, p.y * c.height, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.restore();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [kind]);

  if (kind !== 'webcam' && kind !== 'fused') return null;
  return (
    <div className="webcam">
      <canvas ref={canvas} />
    </div>
  );
}
