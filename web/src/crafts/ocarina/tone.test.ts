import { describe, expect, it } from 'vitest';
import { hzToMidi, ToneDetector, toneFeatures } from './tone';

const SR = 48000;
const FFT = 2048;
const BIN = SR / FFT;
const BINS = FFT / 2;

/** A flat noise floor at `floorDb` with an optional tone (spread over 3 bins like a windowed sine). */
function spectrum(floorDb: number, tone?: { hz: number; db: number }): Float32Array {
  const s = new Float32Array(BINS);
  for (let i = 0; i < BINS; i++) s[i] = floorDb + ((i * 7919) % 5) - 2; // a little deterministic ripple
  if (tone) {
    const k = tone.hz / BIN;
    const c = Math.round(k);
    for (let d = -2; d <= 2; d++) s[c + d] = Math.max(s[c + d], tone.db - 12 * (c + d - k) ** 2);
  }
  return s;
}

/** Feed `ms` of identical frames at 60 fps. */
function run(det: ToneDetector, spec: Float32Array, ms: number) {
  let r = det.update(toneFeatures(spec, BIN), 16);
  for (let t = 16; t < ms; t += 16) r = det.update(toneFeatures(spec, BIN), 16);
  return r;
}

describe('toneFeatures', () => {
  it('finds the peak frequency of a tone to within a few cents', () => {
    const f = toneFeatures(spectrum(-90, { hz: 880, db: -30 }), BIN);
    expect(Math.abs(hzToMidi(f.peakHz) - 81)).toBeLessThan(0.3);
    expect(f.prominenceDb).toBeGreaterThan(40);
  });

  it('reports low prominence for plain noise', () => {
    expect(toneFeatures(spectrum(-60), BIN).prominenceDb).toBeLessThan(6);
  });

  it('copes with digital silence', () => {
    const f = toneFeatures(new Float32Array(BINS).fill(-Infinity), BIN);
    expect(Number.isFinite(f.peakDb)).toBe(true);
  });
});

describe('ToneDetector', () => {
  it('stays silent on room noise, sounds on a tone, and releases after it stops', () => {
    const det = new ToneDetector();
    expect(run(det, spectrum(-90), 1000).sounding).toBe(false);
    const on = run(det, spectrum(-90, { hz: 1046.5, db: -35 }), 100);
    expect(on.sounding).toBe(true);
    expect(on.midi).toBe(84); // C6
    expect(on.strength).toBeGreaterThan(0);
    expect(run(det, spectrum(-90), 300).sounding).toBe(false);
  });

  it('ignores loud broadband noise (breath, fans)', () => {
    const det = new ToneDetector();
    run(det, spectrum(-90), 500);
    expect(run(det, spectrum(-40), 300).sounding).toBe(false);
  });

  it('rides through a short dip without stuttering', () => {
    const det = new ToneDetector();
    run(det, spectrum(-90), 500);
    run(det, spectrum(-90, { hz: 700, db: -35 }), 100);
    expect(det.update(toneFeatures(spectrum(-90), BIN), 40).sounding).toBe(true);
    expect(run(det, spectrum(-90, { hz: 700, db: -35 }), 50).sounding).toBe(true);
  });

  it('needs a louder tone at lower sensitivity', () => {
    const quiet = spectrum(-90, { hz: 900, db: -68 });
    const low = new ToneDetector();
    low.sensitivity = 0;
    low.minDb = -160; // this test is about sensitivity only
    run(low, spectrum(-90), 500);
    expect(run(low, quiet, 100).sounding).toBe(false);
    const high = new ToneDetector();
    high.sensitivity = 1;
    high.minDb = -160;
    run(high, spectrum(-90), 500);
    expect(run(high, quiet, 100).sounding).toBe(true);
  });
});

describe('ToneDetector minimum level', () => {
  it('never hears a tone quieter than minDb, even at full sensitivity in a silent room', () => {
    const det = new ToneDetector();
    det.sensitivity = 1;
    det.minDb = -50;
    run(det, spectrum(-110), 500);
    expect(run(det, spectrum(-110, { hz: 900, db: -55 }), 200).sounding).toBe(false);
    expect(run(det, spectrum(-110, { hz: 900, db: -45 }), 100).sounding).toBe(true);
  });

  it('releases a held note once it falls below minDb (no hysteresis under the minimum)', () => {
    const det = new ToneDetector();
    det.minDb = -50;
    run(det, spectrum(-110), 500);
    run(det, spectrum(-110, { hz: 900, db: -30 }), 100);
    expect(run(det, spectrum(-110, { hz: 900, db: -52 }), 200).sounding).toBe(false);
  });
});
