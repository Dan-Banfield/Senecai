// WebAudio ocarina voice: sine + a little triangle + band-passed breath noise,
// one persistent voice with attack/release/glide, into a short noise reverb.
// No AudioContext exists until unlock() (call it from a user gesture).

import type { OcarinaSynth } from './types';

const ATTACK = 0.03;
const RELEASE = 0.06;
const GLIDE = 0.02;
/** Voice level at gain 1 (keeps the summed peak under ~0.5). */
const LEVEL = 0.32;
const VIBRATO_DELAY = 0.4;
const VIBRATO_CENTS = 5; // ~0.3%

export const midiToHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** Freeze a param at its current value so new automation starts from there (no clicks). */
function hold(p: AudioParam, t: number): void {
  if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(t);
  else {
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
  }
}

function noiseBuffer(ctx: AudioContext, seconds: number, channels: number, decay: boolean): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(channels, len, ctx.sampleRate);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (decay ? (1 - i / len) ** 3 : 1);
  }
  return buf;
}

interface Graph {
  ctx: AudioContext;
  sources: (OscillatorNode | AudioBufferSourceNode)[];
  nodes: AudioNode[];
  sine: OscillatorNode;
  tri: OscillatorNode;
  band: BiquadFilterNode;
  vibrato: GainNode;
  voice: GainNode;
  master: GainNode;
}

function build(ctx: AudioContext, muted: boolean): Graph {
  const gain = (v: number) => new GainNode(ctx, { gain: v });
  const sine = new OscillatorNode(ctx, { type: 'sine' });
  const tri = new OscillatorNode(ctx, { type: 'triangle' });
  const noise = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx, 2, 1, false), loop: true });
  const band = new BiquadFilterNode(ctx, { type: 'bandpass', Q: 3 });
  const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 5 });
  const vibrato = gain(0);
  const triGain = gain(0.25);
  const breath = gain(0.6); // post-filter; white noise through Q=3 is ~-20 dB, so this lands near 0.05 effective
  const voice = gain(0);
  const master = gain(muted ? 0 : 1);
  const verb = new ConvolverNode(ctx, { buffer: noiseBuffer(ctx, 1.2, 2, true) });
  const wet = gain(0.2);

  lfo.connect(vibrato).connect(sine.detune);
  vibrato.connect(tri.detune);
  sine.connect(voice);
  tri.connect(triGain).connect(voice);
  noise.connect(band).connect(breath).connect(voice);
  voice.connect(master).connect(ctx.destination);
  master.connect(verb).connect(wet).connect(ctx.destination);

  const sources = [sine, tri, noise, lfo];
  for (const s of sources) s.start();
  return {
    ctx, sources, sine, tri, band, vibrato, voice, master,
    nodes: [...sources, band, vibrato, triGain, breath, voice, master, verb, wet],
  };
}

export function createSynth(): OcarinaSynth {
  let g: Graph | null = null;
  let disposed = false;
  let muted = false;
  let target: number | null = null;
  let targetGain = 0.8;
  /** What the graph is currently set to (null = silent). */
  let applied: number | null = null;
  let appliedGain = 0;

  const apply = (): void => {
    if (!g) return;
    const t = g.ctx.currentTime;
    const { sine, tri, band, vibrato, voice } = g;
    if (target === null) {
      if (applied === null) return;
      hold(voice.gain, t);
      voice.gain.setTargetAtTime(0, t, RELEASE / 3);
      hold(vibrato.gain, t);
      vibrato.gain.setTargetAtTime(0, t, RELEASE / 3);
    } else {
      const hz = midiToHz(target);
      const level = LEVEL * Math.min(1, Math.max(0, targetGain));
      if (target !== applied) {
        for (const p of [sine.frequency, tri.frequency, band.frequency]) {
          hold(p, t);
          if (applied === null) p.setValueAtTime(hz, t);
          else p.setTargetAtTime(hz, t, GLIDE / 3);
        }
        // Vibrato fades in only once a note has been held a while.
        hold(vibrato.gain, t);
        vibrato.gain.setTargetAtTime(0, t, 0.02);
        vibrato.gain.setValueAtTime(0, t + VIBRATO_DELAY);
        vibrato.gain.linearRampToValueAtTime(VIBRATO_CENTS, t + VIBRATO_DELAY + 0.5);
      }
      if (applied === null) {
        hold(voice.gain, t);
        // Anchor the ramp at now, or it would start from the last event (possibly t = 0) and skip the attack.
        voice.gain.setValueAtTime(voice.gain.value, t);
        voice.gain.linearRampToValueAtTime(level, t + ATTACK);
      } else if (level !== appliedGain) {
        hold(voice.gain, t);
        voice.gain.setTargetAtTime(level, t, 0.01);
      }
      appliedGain = level;
    }
    applied = target;
  };

  return {
    unlock() {
      if (disposed || typeof AudioContext === 'undefined') return;
      if (!g) {
        g = build(new AudioContext(), muted);
        apply();
      }
      if (g.ctx.state === 'suspended') g.ctx.resume().catch(() => {});
    },
    setNote(midi, gain = 0.8) {
      if (midi === target && gain === targetGain) return;
      target = midi;
      targetGain = gain;
      apply();
    },
    setMuted(m) {
      muted = m;
      if (!g) return;
      const t = g.ctx.currentTime;
      hold(g.master.gain, t);
      g.master.gain.setTargetAtTime(m ? 0 : 1, t, 0.01);
    },
    get muted() {
      return muted;
    },
    get ready() {
      return !!g && g.ctx.state === 'running';
    },
    dispose() {
      disposed = true;
      target = null;
      if (!g) return;
      const { ctx, master, sources, nodes } = g;
      g = null;
      const t = ctx.currentTime;
      hold(master.gain, t);
      master.gain.linearRampToValueAtTime(0, t + 0.03);
      for (const s of sources) s.stop(t + 0.05);
      setTimeout(() => {
        for (const n of nodes) n.disconnect();
        ctx.close().catch(() => {});
      }, 80);
    },
  };
}
