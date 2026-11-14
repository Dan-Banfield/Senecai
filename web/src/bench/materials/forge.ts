// A steel bar forged into a blade. The bar is a row of segments along local +X
// (tang at x = 0, tip at the far end), each with a width (local Z, the edge
// on the -Z side) and a thickness (local Y). Hot steel moves under the hammer:
// a flat blow thins and spreads it, a blow on the edge narrows it.

import { clamp01, type Op, type Workpiece } from '../core';

export const SEGMENTS = 40;
/** Segments before this index are the tang, already drawn out. */
export const TANG = 12;
const SEG_LEN = 0.06;
const BAR_W = 0.3;
const BAR_T = 0.16;
const TANG_W = 0.13;

type ForgeOp =
  | { k: 'temp'; v: number }
  | { k: 'strike'; u: number; s: number; e: boolean }
  | { k: 'grind'; u: number; s: number }
  | { k: 'quench'; ok: boolean };

/** Heat at which the steel moves under the hammer (0 = cold, 1 = yellow heat). */
export const WORKING_HEAT = 0.42;

export class ForgeBar implements Workpiece {
  readonly kind = 'forge' as const;
  version = 0;
  len = new Float32Array(SEGMENTS).fill(SEG_LEN);
  w = new Float32Array(SEGMENTS);
  t = new Float32Array(SEGMENTS);
  bevel = new Float32Array(SEGMENTS);
  temp = 0;
  hardened = false;
  strikes = 0;

  constructor(readonly id: string) {
    for (let i = 0; i < SEGMENTS; i++) {
      this.w[i] = i < TANG ? TANG_W : BAR_W;
      this.t[i] = i < TANG ? 0.1 : BAR_T;
    }
  }

  get length() {
    let s = 0;
    for (let i = 0; i < SEGMENTS; i++) s += this.len[i];
    return s;
  }

  /** Centre of each segment along the bar, 0..1. */
  centres() {
    const L = this.length;
    const c = new Float32Array(SEGMENTS);
    let x = 0;
    for (let i = 0; i < SEGMENTS; i++) {
      c[i] = (x + this.len[i] / 2) / L;
      x += this.len[i];
    }
    return c;
  }

  /** How readily the steel moves right now, 0..1. */
  get plasticity() {
    return clamp01((this.temp - WORKING_HEAT * 0.75) / 0.45);
  }

  apply(op: Op) {
    const o = op as unknown as ForgeOp;
    if (o.k === 'temp') this.temp = o.v;
    else if (o.k === 'quench') {
      this.temp = 0;
      if (o.ok) this.hardened = true;
    } else if (o.k === 'strike') {
      this.strikes++;
      const h = this.plasticity;
      const c = this.centres();
      for (let i = TANG; i < SEGMENTS; i++) {
        const f = Math.exp(-(((c[i] - o.u) / 0.075) ** 2)) * o.s * h;
        if (f < 1e-3) continue;
        if (o.e) {
          // On edge: the blow narrows the blade (the point, the belly).
          this.w[i] = Math.max(0.02, this.w[i] * (1 - 0.2 * f));
          this.t[i] = Math.min(0.2, this.t[i] * (1 + 0.04 * f));
        } else {
          // Flat: thinner, a little wider and longer.
          this.t[i] = Math.max(0.035, this.t[i] * (1 - 0.16 * f));
          this.w[i] = Math.min(0.5, this.w[i] * (1 + 0.05 * f));
        }
        this.len[i] *= 1 + 0.06 * f;
      }
    } else if (o.k === 'grind') {
      const c = this.centres();
      for (let i = TANG; i < SEGMENTS; i++) {
        const f = Math.exp(-(((c[i] - o.u) / 0.07) ** 2)) * o.s;
        this.bevel[i] = Math.min(1, this.bevel[i] + 0.22 * f);
      }
    }
    this.version++;
  }

  snapshot() {
    return { len: this.len.slice(), w: this.w.slice(), t: this.t.slice(), bevel: this.bevel.slice(), temp: this.temp, hardened: this.hardened, strikes: this.strikes };
  }
  restore(s: unknown) {
    const v = s as ReturnType<ForgeBar['snapshot']>;
    this.len = v.len.slice();
    this.w = v.w.slice();
    this.t = v.t.slice();
    this.bevel = v.bevel.slice();
    this.temp = v.temp;
    this.hardened = v.hardened;
    this.strikes = v.strikes;
    this.version++;
  }

  /** Blade-part width the finished puukko should have at v (0 = ricasso, 1 = tip). */
  static targetWidth(v: number) {
    const W = 0.36;
    if (v < 0.62) return W * (1 - 0.06 * v);
    const k = (v - 0.62) / 0.38;
    return W * 0.96 * Math.sqrt(Math.max(0, 1 - k * k));
  }
  static TARGET_T = 0.075;
  /** Blade length (from the end of the tang) the finished puukko should reach. */
  static TARGET_BLADE = (SEGMENTS - TANG) * SEG_LEN * 1.3;

  /** 0..1 shape match: width profile, thinness and length of the blade part. */
  shapeMatch() {
    const lens = this.len;
    let blade = 0;
    for (let i = TANG; i < SEGMENTS; i++) blade += lens[i];
    let x = 0;
    let wErr = 0;
    let tErr = 0;
    for (let i = TANG; i < SEGMENTS; i++) {
      const v = (x + lens[i] / 2) / blade;
      x += lens[i];
      wErr += Math.abs(this.w[i] - ForgeBar.targetWidth(v)) / 0.36;
      tErr += Math.max(0, this.t[i] - ForgeBar.TARGET_T) / (BAR_T - ForgeBar.TARGET_T);
    }
    const n = SEGMENTS - TANG;
    const width = clamp01(1 - (wErr / n) * 2.2);
    const thin = clamp01(1 - tErr / n);
    const length = clamp01((blade - (SEGMENTS - TANG) * SEG_LEN) / (ForgeBar.TARGET_BLADE - (SEGMENTS - TANG) * SEG_LEN));
    return { width, thin, length, overall: width * 0.45 + thin * 0.3 + length * 0.25 };
  }

  /** Mean bevel along the blade's edge, 0..1. */
  sharpness() {
    let s = 0;
    for (let i = TANG; i < SEGMENTS; i++) s += this.bevel[i];
    return s / (SEGMENTS - TANG);
  }
}
