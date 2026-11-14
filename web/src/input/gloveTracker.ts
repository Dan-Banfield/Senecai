// Finds black gloves on a table, seen from an overhead camera. Only where each
// hand is matters here: the gloves themselves measure the fingers and wrist.
//
// A glove is a large patch much darker than the background behind it. The
// background is learned as it goes: it follows anything that gets brighter
// quickly (a hand moving away reveals the table) but anything that gets darker
// only slowly, and never where a glove is being tracked. So dark things that
// stay put (a keyboard, cables, the floor past the table edge) fade into the
// background within seconds, while a glove resting still stays found. Hands
// are never perfectly still, so a patch that hasn't moved at all for a while
// (a phone put down on the table) loses that protection and fades away too.
// Hands that touch (on the kantele the fingers interlace) merge into one
// patch; one about twice the size of a glove seen alone is split in two,
// around where each hand last was. Gloves are knitted, with seams, folds and
// sensor pods, so they show texture and catch some light; a patch that is
// both flat and nearly black (the floor past the table's edge, a switched-off
// screen) is never taken for one.

export interface GloveBlob {
  /** Centre, 0..1 across and down the image. */
  x: number;
  y: number;
  /** Fraction of the image it covers. */
  area: number;
}

/** Background follows brightening this fast per frame... */
const UP = 0.25;
/** ...and darkening this slowly (about 8 s at 30 fps), except under a tracked glove. */
const DOWN = 0.004;
/** A glove pixel is this much darker than the background (0..255)... */
const DIFF = 28;
/** ...and below this fraction of the background's brightness. */
const RATIO = 0.6;
/** A patch whose brightness varies less than this (std, 0..255)... */
const FLAT_STD = 14;
/** ...and is darker than this on average is a black void, not a glove. */
const FLAT_MEAN = 20;
/** Smallest glove, as a fraction of the image. */
const MIN_AREA = 0.012;
/** More than this much of the image changing at once means the camera moved: start over. */
const SCENE_CHANGE = 0.4;
/** A patch that moves less than this many pixels... */
const STILL_PX = 1.5;
/** ...for this many frames (about 20 s) is an object, not a hand. */
const STILL_FRAMES = 600;
/** One patch this many times the size of a glove seen alone is both hands touching. */
const MERGED = 1.6;
/** For this long (frames) after the gloves were last told apart, split a merged patch around where they were. */
const PAIR_FRAMES = 60;

export class GloveTracker {
  private bg: Float32Array | null = null;
  private readonly v: Float32Array;
  private readonly tmp: Float32Array;
  private readonly mask: Uint8Array;
  private readonly work: Uint8Array;
  private readonly label: Int32Array;
  private readonly stack: Int32Array;
  /** Each tracked patch: where it last moved to, and for how many frames it has stayed there. */
  private anchors: { x: number; y: number; still: number }[] = [];
  /** The two gloves when last told apart, and how many frames ago. */
  private pair: { a: GloveBlob; b: GloveBlob; age: number } | null = null;
  /** How big one glove is (fraction of the image), learned whenever two are seen apart. */
  private single = 0;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    const n = w * h;
    this.v = new Float32Array(n);
    this.tmp = new Float32Array(n);
    this.mask = new Uint8Array(n);
    this.work = new Uint8Array(n);
    this.label = new Int32Array(n);
    this.stack = new Int32Array(n);
  }

  /** Forget the background (e.g. after the camera moved). */
  reset() {
    this.bg = null;
    this.anchors = [];
    this.pair = null;
    this.single = 0;
  }

  /** One RGBA frame of w x h pixels in, up to two gloves out (largest first). */
  update(rgba: Uint8ClampedArray | Uint8Array): GloveBlob[] {
    const { w, h, v, tmp, mask } = this;
    const n = w * h;
    // Brightness = the brightest channel: black fabric is dark in all three, wood isn't.
    for (let i = 0, j = 0; i < n; i++, j += 4) tmp[i] = Math.max(rgba[j], rgba[j + 1], rgba[j + 2]);
    blur3(tmp, v, w, h);

    if (!this.bg) {
      this.bg = v.slice();
      return [];
    }
    const bg = this.bg;
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const on = bg[i] - v[i] > DIFF && v[i] < bg[i] * RATIO ? 1 : 0;
      mask[i] = on;
      changed += on;
    }
    if (changed > n * SCENE_CHANGE) {
      bg.set(v);
      return [];
    }

    // Open (drop specks and thin cables), then close (fill the glove's gaps).
    morph(mask, this.work, w, h, false);
    morph(this.work, mask, w, h, true);
    morph(mask, this.work, w, h, true);
    morph(this.work, mask, w, h, true);
    morph(mask, this.work, w, h, false);
    morph(this.work, mask, w, h, false);

    let { blobs, ids } = this.components(Math.max(1, Math.round(MIN_AREA * n)));
    if (blobs.length === 2) {
      const each = (blobs[0].area + blobs[1].area) / 2;
      this.single = this.single ? this.single + (each - this.single) * 0.05 : each;
    } else if (blobs.length === 1 && this.single && blobs[0].area >= MERGED * this.single) {
      const pair = this.pair && this.pair.age < PAIR_FRAMES ? this.pair : null;
      blobs = this.split(ids[0], pair);
      ids = [ids[0], ids[0]];
    }
    if (blobs.length === 2) this.pair = { a: blobs[0], b: blobs[1], age: 0 };
    else if (this.pair) this.pair.age++;

    // Keep tracked gloves out of the background, with a margin; but not patches that never move.
    const anchors = blobs.map((b) => {
      const x = b.x * w;
      const y = b.y * h;
      const a = this.anchors.find((q) => Math.hypot(q.x - x, q.y - y) < STILL_PX);
      return a ? { ...a, still: a.still + 1 } : { x, y, still: 0 };
    });
    this.anchors = anchors;
    const guarded = new Set(ids.filter((_, k) => anchors[k].still < STILL_FRAMES));
    const keep = this.work;
    for (let i = 0; i < n; i++) keep[i] = guarded.has(this.label[i]) ? 1 : 0;
    for (let k = 0; k < 3; k++) {
      morph(keep, mask, w, h, true);
      keep.set(mask);
    }
    for (let i = 0; i < n; i++) {
      const d = v[i] - bg[i];
      if (d > 0) bg[i] += d * UP;
      else if (!keep[i]) bg[i] += d * DOWN;
    }
    return blobs;
  }

  /**
   * Splits patch `id` in two (2-means on its pixels), starting from where the
   * gloves last were, or else from its left and right quarters (the hands lie
   * side by side, the player sitting at the bottom of the picture).
   */
  private split(id: number, last: { a: GloveBlob; b: GloveBlob } | null): GloveBlob[] {
    const { w, h, label } = this;
    const n = w * h;
    let c: { x: number; y: number }[];
    if (last) {
      c = [last.a, last.b].map((g) => ({ x: g.x * w - 0.5, y: g.y * h - 0.5 }));
    } else {
      let x0 = w;
      let x1 = 0;
      let sy = 0;
      let k = 0;
      for (let i = 0; i < n; i++) {
        if (label[i] !== id) continue;
        const x = i % w;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        sy += (i - x) / w;
        k++;
      }
      const y = sy / Math.max(1, k);
      c = [
        { x: x0 + (x1 - x0) * 0.25, y },
        { x: x0 + (x1 - x0) * 0.75, y },
      ];
    }
    const acc = [
      { sx: 0, sy: 0, k: 0 },
      { sx: 0, sy: 0, k: 0 },
    ];
    for (let iter = 0; iter < 5; iter++) {
      for (const s of acc) s.sx = s.sy = s.k = 0;
      for (let i = 0; i < n; i++) {
        if (label[i] !== id) continue;
        const x = i % w;
        const y = (i - x) / w;
        const j = (x - c[0].x) ** 2 + (y - c[0].y) ** 2 <= (x - c[1].x) ** 2 + (y - c[1].y) ** 2 ? 0 : 1;
        acc[j].sx += x;
        acc[j].sy += y;
        acc[j].k++;
      }
      acc.forEach((s, j) => s.k && (c[j] = { x: s.sx / s.k, y: s.sy / s.k }));
    }
    return c.map((p, j) => ({ x: (p.x + 0.5) / w, y: (p.y + 0.5) / h, area: acc[j].k / n })).sort((p, q) => q.area - p.area);
  }

  /** Connected patches of the mask at least minArea big; their pixels are labelled > 0, the rest 0. */
  private components(minArea: number): { blobs: GloveBlob[]; ids: number[] } {
    const { w, h, mask, label, stack } = this;
    const n = w * h;
    label.fill(0);
    const raw = this.tmp;
    const found: { id: number; area: number; sx: number; sy: number; sv: number; svv: number }[] = [];
    let id = 0;
    for (let start = 0; start < n; start++) {
      if (!mask[start] || label[start]) continue;
      id++;
      let top = 0;
      let area = 0;
      let sx = 0;
      let sy = 0;
      let sv = 0;
      let svv = 0;
      stack[top++] = start;
      label[start] = id;
      while (top) {
        const p = stack[--top];
        const x = p % w;
        const y = (p - x) / w;
        area++;
        sx += x;
        sy += y;
        sv += raw[p];
        svv += raw[p] * raw[p];
        if (x > 0 && mask[p - 1] && !label[p - 1]) (label[p - 1] = id), (stack[top++] = p - 1);
        if (x < w - 1 && mask[p + 1] && !label[p + 1]) (label[p + 1] = id), (stack[top++] = p + 1);
        if (y > 0 && mask[p - w] && !label[p - w]) (label[p - w] = id), (stack[top++] = p - w);
        if (y < h - 1 && mask[p + w] && !label[p + w]) (label[p + w] = id), (stack[top++] = p + w);
      }
      found.push({ id, area, sx, sy, sv, svv });
    }
    found.sort((a, b) => b.area - a.area);
    const isVoid = (c: (typeof found)[number]) => {
      const mean = c.sv / c.area;
      return mean < FLAT_MEAN && Math.sqrt(Math.max(0, c.svv / c.area - mean * mean)) < FLAT_STD;
    };
    const kept = found.filter((c) => c.area >= minArea && !isVoid(c)).slice(0, 2);
    const ids = new Set(kept.map((c) => c.id));
    for (let i = 0; i < n; i++) if (label[i] && !ids.has(label[i])) label[i] = 0;
    return { blobs: kept.map((c) => ({ x: (c.sx / c.area + 0.5) / w, y: (c.sy / c.area + 0.5) / h, area: c.area / n })), ids: kept.map((c) => c.id) };
  }
}

/** 3x3 box blur. */
function blur3(src: Float32Array, dst: Float32Array, w: number, h: number) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += src[yy * w + xx];
          c++;
        }
      }
      dst[y * w + x] = s / c;
    }
}

/** 3x3 dilate (grow) or erode (shrink) of a 0/1 mask. */
function morph(src: Uint8Array, dst: Uint8Array, w: number, h: number, grow: boolean) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let any = 0;
      let all = 1;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const m = src[yy * w + xx];
          any |= m;
          all &= m;
        }
      }
      dst[y * w + x] = grow ? any : all;
    }
}

export type Rotation = 0 | 90 | 180 | 270;
export type HandPoint = { x: number; y: number };

/**
 * Which glove is which. With the image turned so the player sits at the bottom,
 * their left hand is on the left. A single glove keeps the side it had (if it
 * hasn't jumped across the image), else takes the side of the image it is on.
 */
export function assignSides(blobs: GloveBlob[], prev: Partial<Record<'left' | 'right', HandPoint>>, swap = false): Partial<Record<'left' | 'right', HandPoint>> {
  const flip = (s: 'left' | 'right') => (swap ? (s === 'left' ? 'right' : 'left') : s);
  if (blobs.length >= 2) {
    const [a, b] = [...blobs.slice(0, 2)].sort((p, q) => p.x - q.x);
    return { [flip('left')]: { x: a.x, y: a.y }, [flip('right')]: { x: b.x, y: b.y } };
  }
  if (blobs.length === 1) {
    const p = { x: blobs[0].x, y: blobs[0].y };
    let side: 'left' | 'right' = p.x < 0.5 ? flip('left') : flip('right');
    let best = 0.25;
    for (const s of ['left', 'right'] as const) {
      const q = prev[s];
      if (!q) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < best) {
        best = d;
        side = s;
      }
    }
    return { [side]: p };
  }
  return {};
}

/** Size of the rotated image for a camera frame of w x h. */
export const rotatedSize = (w: number, h: number, r: Rotation): [number, number] => (r % 180 ? [h, w] : [w, h]);

/** Draws `src` (sw x sh) turned clockwise by `r` to fill a cw x ch canvas. */
export function drawRotated(ctx: CanvasRenderingContext2D, src: CanvasImageSource, r: Rotation, cw: number, ch: number) {
  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((r * Math.PI) / 180);
  const [dw, dh] = r % 180 ? [ch, cw] : [cw, ch];
  ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}
