// Mirrored webcam picture-in-picture with the tracked hand skeleton drawn on top.

import { useEffect, useRef } from 'react';
import { live, usePipeline } from '../input/pipeline';
import { WebcamSource } from '../input/webcamSource';

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

export function WebcamPreview() {
  const kind = usePipeline((s) => s.kind);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (kind !== 'webcam') return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const src = live.source;
      const c = canvas.current;
      if (!(src instanceof WebcamSource) || !c) return;
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
        ctx.strokeStyle = right ? '#e0965c' : '#7fd1e8';
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

  if (kind !== 'webcam') return null;
  return (
    <div className="webcam">
      <canvas ref={canvas} />
    </div>
  );
}
