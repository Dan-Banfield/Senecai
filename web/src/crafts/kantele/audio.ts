// Plucked-string synthesis (Karplus–Strong), pre-rendered per string.

import { STRINGS } from './music';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
const buffers: AudioBuffer[] = [];

function render(c: AudioContext, freq: number): AudioBuffer {
  const sr = c.sampleRate;
  const len = Math.floor(sr * 3);
  const buf = c.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const N = Math.round(sr / freq);
  // Seed with filtered noise for a softer, gut-string-like attack.
  let last = 0;
  for (let i = 0; i < N; i++) {
    last = last * 0.5 + (Math.random() * 2 - 1) * 0.5;
    d[i] = last;
  }
  const decay = 0.9965;
  for (let i = N; i < len; i++) d[i] = decay * 0.5 * (d[i - N] + d[i - N - 1 < 0 ? 0 : i - N - 1]);
  return buf;
}

/** Must be called from a user gesture at least once (browser autoplay rules). */
export function unlockAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    out = ctx.createGain();
    out.gain.value = 0.7;
    // A touch of "wooden box": low-pass plus a short feedback echo.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.045;
    const fb = ctx.createGain();
    fb.gain.value = 0.22;
    out.connect(lp);
    lp.connect(ctx.destination);
    lp.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(ctx.destination);
    for (const s of STRINGS) buffers.push(render(ctx, s.freq));
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

/**
 * Unlocks audio on the first user gesture anywhere on the page, so free play has
 * sound without pressing Start/Record. Listeners stay until the context is actually
 * running (a touch pointerdown alone doesn't count as activation in some browsers),
 * then remove themselves. Returns a cleanup that removes them early.
 */
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => {};
  const events = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;
  const remove = () => {
    for (const e of events) window.removeEventListener(e, onGesture, true);
  };
  function onGesture() {
    unlockAudio();
    if (!ctx || ctx.state === 'running') return remove();
    ctx.resume().then(
      () => {
        if (ctx?.state === 'running') remove();
      },
      () => {},
    );
  }
  if (ctx?.state === 'running') return () => {};
  for (const e of events) window.addEventListener(e, onGesture, true);
  return remove;
}

export function pluckString(index: number, velocity = 0.8) {
  if (!ctx || !out || !buffers[index]) return;
  // Contexts can be suspended again (e.g. tab backgrounded); resume works once the page has had a gesture.
  if (ctx.state === 'suspended') void ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = buffers[index];
  const g = ctx.createGain();
  g.gain.value = 0.25 + velocity * 0.75;
  src.connect(g);
  g.connect(out);
  src.start();
}

/** Short filtered-noise burst, used for wood-carving cuts. */
export function scrape(intensity = 0.5) {
  if (!ctx || !out) return;
  const len = Math.floor(ctx.sampleRate * 0.09);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800 + Math.random() * 1400;
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.value = 0.15 + intensity * 0.35;
  src.connect(bp);
  bp.connect(g);
  g.connect(out);
  src.start();
}
