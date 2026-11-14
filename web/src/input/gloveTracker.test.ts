import { describe, expect, it } from 'vitest';
import { assignSides, GloveTracker } from './gloveTracker';

const W = 160;
const H = 120;
const TABLE: [number, number, number] = [190, 140, 90];
const GLOVE: [number, number, number] = [25, 25, 30];

type Rect = { x: number; y: number; w: number; h: number; c: [number, number, number]; textured?: boolean };

/** An overhead frame: wooden table, plus dark rectangles. */
function frame(rects: Rect[]) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) px.set([...TABLE, 255], i * 4);
  for (const r of rects)
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        // Knitted fabric: a 2-pixel check of darker and lighter stitches.
        const k = r.textured && (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 2.4 : 1;
        px.set([...r.c.map((v) => v * k), 255], (y * W + x) * 4);
      }
  return px;
}
const glove = (cx: number, cy: number): Rect => ({ x: cx - 10, y: cy - 12, w: 20, h: 24, c: GLOVE, textured: true });
const KEYBOARD: Rect = { x: 40, y: 90, w: 80, h: 25, c: [20, 20, 22] };
const CABLE: Rect = { x: 0, y: 30, w: 160, h: 2, c: [15, 15, 15] };

/** Feeds `n` copies of a frame, returning the last result. */
function feed(t: GloveTracker, px: Uint8ClampedArray, n = 1) {
  let out = t.update(px);
  for (let i = 1; i < n; i++) out = t.update(px);
  return out;
}

describe('GloveTracker', () => {
  it('finds a glove that appears on the table, at its centre', () => {
    const t = new GloveTracker(W, H);
    feed(t, frame([]), 5);
    const blobs = t.update(frame([glove(50, 40)]));
    expect(blobs).toHaveLength(1);
    expect(blobs[0].x * W).toBeCloseTo(50, 0);
    expect(blobs[0].y * H).toBeCloseTo(40, 0);
  });

  it('finds two gloves, largest first', () => {
    const t = new GloveTracker(W, H);
    feed(t, frame([]), 3);
    const big = { x: 100, y: 40, w: 26, h: 30, c: GLOVE, textured: true };
    const blobs = t.update(frame([glove(40, 50), big]));
    expect(blobs).toHaveLength(2);
    expect(blobs[0].x * W).toBeCloseTo(113, 0);
    expect(blobs[1].x * W).toBeCloseTo(40, 0);
  });

  it('ignores dark things that were there from the start (a keyboard) and thin cables', () => {
    const t = new GloveTracker(W, H);
    feed(t, frame([KEYBOARD]), 3);
    expect(t.update(frame([KEYBOARD, CABLE]))).toEqual([]);
    const blobs = t.update(frame([KEYBOARD, CABLE, glove(80, 50)]));
    expect(blobs).toHaveLength(1);
    expect(blobs[0].x * W).toBeCloseTo(80, 0);
  });

  it('learns a dark object put down and left there into the background', () => {
    const t = new GloveTracker(W, H);
    feed(t, frame([]), 3);
    const book = { x: 100, y: 10, w: 40, h: 30, c: [30, 30, 30] as [number, number, number], textured: true };
    expect(t.update(frame([book]))).toHaveLength(1);
    // Moving gloves come and go meanwhile; the book never moves.
    let blobs = [] as ReturnType<GloveTracker['update']>;
    for (let i = 0; i < 1500; i++) blobs = t.update(frame([book, glove(30 + (i % 40), 60)])); // 50 s at 30 fps
    expect(blobs.map((b) => Math.round(b.x * W) < 90)).toEqual([true]);
  }, 30000);

  it('keeps finding a glove that rests still for a long time (a resting hand still shifts a little)', () => {
    const t = new GloveTracker(W, H);
    feed(t, frame([]), 3);
    let blobs = [] as ReturnType<GloveTracker['update']>;
    for (let i = 0; i < 900; i++) blobs = t.update(frame([glove(60 + (Math.floor(i / 150) % 2) * 2, 60)])); // 30 s at 30 fps
    expect(blobs).toHaveLength(1);
  }, 30000);

  it('finds a glove that was already on the table at the start once it moves', () => {
    const t = new GloveTracker(W, H);
    feed(t, frame([glove(40, 60)]), 3);
    expect(t.update(frame([glove(40, 60)]))).toEqual([]);
    const blobs = feed(t, frame([glove(110, 60)]), 2);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].x * W).toBeCloseTo(110, 0);
  });

  it('splits two gloves that touch (interlaced fingers) around where each hand was', () => {
    const t = new GloveTracker(W, H);
    feed(t, frame([]), 3);
    expect(t.update(frame([glove(60, 60), glove(100, 60)]))).toHaveLength(2);
    // They move together until they overlap into one patch.
    t.update(frame([glove(66, 60), glove(94, 60)]));
    for (let k = 0; k < 30; k++) {
      const blobs = t.update(frame([glove(70, 60), glove(88, 60)]));
      expect(blobs).toHaveLength(2);
      const xs = blobs.map((b) => b.x * W).sort((p, q) => p - q);
      expect(xs[0]).toBeGreaterThan(62);
      expect(xs[0]).toBeLessThan(76);
      expect(xs[1]).toBeGreaterThan(82);
      expect(xs[1]).toBeLessThan(96);
    }
    // One hand leaving: a single glove is not split.
    expect(t.update(frame([glove(70, 60)]))).toHaveLength(1);
  });

  it('splits gloves that touch even long after they were last seen apart', () => {
    const t = new GloveTracker(W, H);
    feed(t, frame([]), 3);
    t.update(frame([glove(40, 60), glove(110, 60)]));
    for (let i = 0; i < 200; i++) t.update(frame([glove(40 + (i % 3), 60)])); // one hand only for a while
    const blobs = t.update(frame([glove(70, 60), glove(88, 60)]));
    expect(blobs.map((b) => Math.round(b.x * W)).sort((p, q) => p - q)).toEqual([expect.closeTo(70, -1), expect.closeTo(88, -1)]);
  });

  it('never takes a flat black patch (the floor past the table edge) for a glove', () => {
    const t = new GloveTracker(W, H);
    feed(t, frame([]), 3);
    const voidCorner: Rect = { x: 130, y: 0, w: 30, h: 30, c: [8, 3, 9] };
    expect(t.update(frame([voidCorner]))).toEqual([]);
    const blobs = t.update(frame([voidCorner, glove(60, 60)]));
    expect(blobs).toHaveLength(1);
    expect(blobs[0].x * W).toBeCloseTo(60, 0);
  });

  it('starts over when the whole picture changes (the camera moved)', () => {
    const t = new GloveTracker(W, H);
    feed(t, frame([]), 3);
    const moved = frame([{ x: 0, y: 0, w: 160, h: 70, c: [20, 20, 20] }]);
    expect(t.update(moved)).toEqual([]);
    expect(t.update(moved)).toEqual([]);
    expect(t.update(frame([{ x: 0, y: 0, w: 160, h: 70, c: [20, 20, 20] }, glove(80, 95)]))).toHaveLength(1);
  });
});

describe('assignSides', () => {
  it('puts the glove further left in the picture on the left hand, unless swapped', () => {
    const blobs = [
      { x: 0.7, y: 0.5, area: 0.05 },
      { x: 0.3, y: 0.4, area: 0.04 },
    ];
    expect(assignSides(blobs, {})).toEqual({ left: { x: 0.3, y: 0.4 }, right: { x: 0.7, y: 0.5 } });
    expect(assignSides(blobs, {}, true)).toEqual({ right: { x: 0.3, y: 0.4 }, left: { x: 0.7, y: 0.5 } });
  });

  it('keeps a lone glove on the side it had, even past the middle of the picture', () => {
    const blobs = [{ x: 0.55, y: 0.5, area: 0.05 }];
    expect(assignSides(blobs, { left: { x: 0.45, y: 0.5 } })).toEqual({ left: { x: 0.55, y: 0.5 } });
    expect(assignSides(blobs, {})).toEqual({ right: { x: 0.55, y: 0.5 } });
  });
});
