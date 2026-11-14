// A small piano voice: struck-string partials (slightly stretched, as real
// piano strings are), each dying away at its own rate, a felt-hammer thump,
// brightness that follows how hard the key was struck, and a damper that
// stops the string when the key comes back up.

import { frequency } from './keys';

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
const voices = new Map<number, { gain: GainNode; stop: (at: number) => void }>();

/** Must be called from a user gesture at least once (browser autoplay rules). */
export function unlockPiano() {
  if (typeof AudioContext === 'undefined') return;
  if (!ctx) {
    ctx = new AudioContext();
    bus = ctx.createGain();
    bus.gain.value = 0.5;
    // A little room: a short generated reverb tail mixed in.
    const verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.18;
    bus.connect(ctx.destination);
    bus.connect(verb);
    verb.connect(wet);
    wet.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

const PARTIALS = [1, 0.55, 0.32, 0.22, 0.13, 0.09, 0.05];

export function noteOn(midi: number, velocity = 0.7) {
  if (!ctx || !bus) return;
  noteOff(midi, 0.02); // re-striking a key restarts its string
  const now = ctx.currentTime;
  const f0 = frequency(midi);
  const voice = ctx.createGain();
  voice.gain.value = 1;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = Math.min(16000, f0 * (3 + velocity * 9));
  tone.connect(voice);
  voice.connect(bus);

  const oscs: OscillatorNode[] = [];
  const amp = 0.12 + velocity * 0.32;
  // Lower notes ring longer.
  const sustain = 1.4 + 3.2 * Math.max(0, (72 - midi) / 30);
  PARTIALS.forEach((a, k) => {
    const n = k + 1;
    const f = f0 * n * Math.sqrt(1 + 0.00035 * n * n);
    if (f > 18000) return;
    const osc = ctx!.createOscillator();
    osc.frequency.value = f;
    const g = ctx!.createGain();
    const peak = amp * a;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.004);
    // Fast initial drop, then a long ring; higher partials fade sooner.
    g.gain.setTargetAtTime(peak * 0.45, now + 0.004, 0.08);
    g.gain.setTargetAtTime(0, now + 0.12, sustain / (1 + k * 0.6));
    osc.connect(g);
    g.connect(tone);
    osc.start(now);
    oscs.push(osc);
  });

  // The hammer: a very short burst of filtered noise.
  const nlen = Math.floor(ctx.sampleRate * 0.03);
  const nb = ctx.createBuffer(1, nlen, ctx.sampleRate);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nlen, 2);
  const noise = ctx.createBufferSource();
  noise.buffer = nb;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = Math.min(6000, f0 * 4);
  bp.Q.value = 0.8;
  const ng = ctx.createGain();
  ng.gain.value = 0.05 + velocity * 0.12;
  noise.connect(bp);
  bp.connect(ng);
  ng.connect(voice);
  noise.start(now);

  voices.set(midi, {
    gain: voice,
    stop: (at) => {
      for (const o of oscs) o.stop(at);
    },
  });
}

/** The damper falls back on the string. */
export function noteOff(midi: number, damp = 0.09) {
  const v = voices.get(midi);
  if (!v || !ctx) return;
  voices.delete(midi);
  const now = ctx.currentTime;
  v.gain.gain.cancelScheduledValues(now);
  v.gain.gain.setValueAtTime(v.gain.gain.value, now);
  v.gain.gain.setTargetAtTime(0, now, damp);
  v.stop(now + damp * 8);
}
