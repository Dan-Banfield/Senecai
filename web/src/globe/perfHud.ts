// Dev-only performance HUD for the globe page. Enabled with `?perf`, and only when import.meta.env.DEV,
// so the whole module body is dead code in production builds.

import type { WebGLRenderer } from 'three';

export interface PerfHud {
  el: HTMLElement;
  /** Call once per rendered frame, after render, with the CPU time the frame took (ms). */
  frame(cpuMs: number): void;
  dispose(): void;
}

const WINDOW = 30;

/** Mean of `values`, or 0 when empty. */
export function mean(values: readonly number[]): number {
  if (!values.length) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Rendered fps from consecutive frame timestamps: only gaps shorter than `maxGapMs` count, so idle
 * periods between on-demand frames don't drag the number down.
 */
export function fpsFromTimes(times: readonly number[], maxGapMs = 200): number {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > 0 && gap < maxGapMs) gaps.push(gap);
  }
  const m = mean(gaps);
  return m > 0 ? 1000 / m : 0;
}

export function createPerfHud(renderer: WebGLRenderer): PerfHud | null {
  if (!import.meta.env.DEV) return null;
  if (typeof location === 'undefined' || !new URLSearchParams(location.search).has('perf')) return null;

  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed',
    top: '64px',
    right: '12px',
    zIndex: '10000',
    padding: '6px 9px',
    background: 'rgba(20, 16, 12, 0.82)',
    color: '#f3ead8',
    font: '11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    whiteSpace: 'pre',
    borderRadius: '4px',
    pointerEvents: 'none',
    userSelect: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);

  const times: number[] = [];
  const cpu: number[] = [];
  const recent: number[] = []; // render timestamps in the last second
  let calls = 0;
  let triangles = 0;

  const draw = () => {
    const now = performance.now();
    while (recent.length && now - recent[0] > 1000) recent.shift();
    el.textContent =
      `fps      ${fpsFromTimes(times).toFixed(1)}\n` +
      `cpu ms   ${mean(cpu).toFixed(2)}\n` +
      `calls    ${calls}\n` +
      `tris     ${triangles}\n` +
      `dpr      ${renderer.getPixelRatio()}\n` +
      `renders  ${recent.length}/s`;
  };
  draw();
  const interval = window.setInterval(draw, 250);

  return {
    el,
    frame(cpuMs) {
      const now = performance.now();
      times.push(now);
      if (times.length > WINDOW + 1) times.shift();
      cpu.push(cpuMs);
      if (cpu.length > WINDOW) cpu.shift();
      recent.push(now);
      const info = renderer.info.render;
      calls = info.calls;
      triangles = info.triangles;
    },
    dispose() {
      clearInterval(interval);
      el.remove();
    },
  };
}
