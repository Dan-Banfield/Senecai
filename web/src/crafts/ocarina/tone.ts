// Detects a real ocarina sounding, from one microphone spectrum frame.
// An ocarina is close to a pure tone (one strong fundamental, weak overtones),
// so a frame counts as "sounding" when its loudest bin in the ocarina range
// stands well above the room's noise floor AND well above the rest of the
// spectrum (prominence), which rejects breath noise, fans and most chatter.
//
// Pure and DOM-free so it can be unit tested; ocarinaMic.ts feeds it.

/** Searched range (Hz): bass ocarinas (~C4) up to soprano tops (~F7) fit, hum and hiss don't. */
export const TONE_LO_HZ = 240;
export const TONE_HI_HZ = 3000;
/** Peak margin above the noise floor at sensitivity 0 and 1 (dB). */
const MARGIN_AT_MIN_SENS = 30;
const MARGIN_AT_MAX_SENS = 8;
/** Drop below the on-threshold minus this before the note ends (dB). */
const HYSTERESIS_DB = 6;
/** Peak over the band median needed to start (and, lower, to keep) a note (dB). */
const PROMINENCE_ON = 18;
const PROMINENCE_HOLD = 12;
/** Default absolute minimum peak level (dBFS): anything quieter is never a note, however sensitive. */
export const DEFAULT_MIN_DB = -55;
/** Keep sounding this long after the tone drops out, so tonguing gaps and dips don't stutter. */
const HANGOVER_MS = 80;
/** Noise floor follows quiet frames down quickly and drifts up slowly (time constants, ms). */
const FLOOR_FALL_MS = 300;
const FLOOR_RISE_MS = 5000;
/** dB above the on-threshold that reads as full strength. */
const STRENGTH_RANGE_DB = 20;

export interface ToneFeatures {
  /** Frequency of the strongest bin in range (parabolic-interpolated), Hz. */
  peakHz: number;
  /** Level of that bin, dBFS. */
  peakDb: number;
  /** Peak level over the median bin level of the range (dB). */
  prominenceDb: number;
}

const finiteDb = (v: number) => (Number.isFinite(v) ? Math.max(-160, v) : -160);

/** Strongest tonal peak of one AnalyserNode frame (`getFloatFrequencyData`, dBFS per bin). */
export function toneFeatures(spectrumDb: ArrayLike<number>, binHz: number): ToneFeatures {
  const lo = Math.max(1, Math.floor(TONE_LO_HZ / binHz));
  const hi = Math.min(spectrumDb.length - 2, Math.ceil(TONE_HI_HZ / binHz));
  if (hi < lo) return { peakHz: 0, peakDb: -160, prominenceDb: 0 };
  let best = lo;
  const band: number[] = [];
  for (let i = lo; i <= hi; i++) {
    const v = finiteDb(spectrumDb[i]);
    band.push(v);
    if (v > finiteDb(spectrumDb[best])) best = i;
  }
  band.sort((a, b) => a - b);
  const median = band[band.length >> 1];
  // Parabolic interpolation around the peak bin for a sub-bin frequency.
  const a = finiteDb(spectrumDb[best - 1]);
  const b = finiteDb(spectrumDb[best]);
  const c = finiteDb(spectrumDb[best + 1]);
  const den = a - 2 * b + c;
  const off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  return { peakHz: (best + off) * binHz, peakDb: b, prominenceDb: b - median };
}

export const hzToMidi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);

export interface ToneReading {
  sounding: boolean;
  /** 0..1, how loud above the threshold (0 when not sounding). */
  strength: number;
  /** Nearest MIDI note of the heard pitch while sounding, else null. */
  midi: number | null;
  /** For a meter: current peak level, learned floor and on-threshold (dBFS). */
  peakDb: number;
  floorDb: number;
  thresholdDb: number;
}

export class ToneDetector {
  private floor: number | null = null;
  private on = false;
  private hang = 0;
  private lastMidi: number | null = null;
  /** 0..1; higher triggers on quieter playing (and more room noise). */
  sensitivity = 0.5;
  /** Hard minimum peak level (dBFS): below it nothing is heard, whatever the noise floor or sensitivity. */
  minDb = DEFAULT_MIN_DB;

  reset(): void {
    this.floor = null;
    this.on = false;
    this.hang = 0;
    this.lastMidi = null;
  }

  get margin(): number {
    const s = Math.min(1, Math.max(0, this.sensitivity));
    return MARGIN_AT_MIN_SENS + (MARGIN_AT_MAX_SENS - MARGIN_AT_MIN_SENS) * s;
  }

  update({ peakHz, peakDb, prominenceDb }: ToneFeatures, dtMs: number): ToneReading {
    const dt = Math.max(0, Number.isFinite(dtMs) ? dtMs : 0);
    if (this.floor === null) this.floor = peakDb;
    const threshold = Math.max(this.floor + this.margin, this.minDb);
    // Hysteresis lets a held note dip a little, but never below the hard minimum.
    const holdThreshold = Math.max(threshold - HYSTERESIS_DB, this.minDb);

    const loud = peakDb > (this.on ? holdThreshold : threshold);
    const tonal = prominenceDb > (this.on ? PROMINENCE_HOLD : PROMINENCE_ON);
    if (loud && tonal) {
      this.on = true;
      this.hang = HANGOVER_MS;
      this.lastMidi = Math.round(hzToMidi(peakHz));
    } else if (this.on) {
      this.hang -= dt;
      if (this.hang <= 0) {
        this.on = false;
        this.lastMidi = null;
      }
    }

    // Learn the floor only from frames that are not a note.
    if (!this.on) {
      const tau = peakDb < this.floor ? FLOOR_FALL_MS : FLOOR_RISE_MS;
      this.floor += (peakDb - this.floor) * (1 - Math.exp(-dt / tau));
    }

    const strength = this.on ? Math.min(1, Math.max(0, (peakDb - holdThreshold) / STRENGTH_RANGE_DB)) : 0;
    return { sounding: this.on, strength, midi: this.lastMidi, peakDb, floorDb: this.floor, thresholdDb: threshold };
  }
}
