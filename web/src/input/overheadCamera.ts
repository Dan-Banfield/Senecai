// An overhead camera that finds where each gloved hand is on the table (see
// gloveTracker.ts). It emits Rokoko frames carrying only each hand's wrist
// position, which is all the gloves + camera input takes from a camera.
//
// The picture is turned (`rotation`) so the player sits at its bottom edge;
// then left in the picture is the player's left, and up is away from them.

import type { JointFrame, RokokoFrame, Side } from '../rokoko/types';
import { assignSides, drawRotated, GloveTracker, rotatedSize, type HandPoint, type Rotation } from './gloveTracker';
import type { SourceStatus } from './types';
import { openCamera } from './webcamSource';

/** Tracking resolution (the long side); small is plenty to find a hand and keeps it cheap. */
const TRACK_W = 160;
/** About how much table the camera sees across, in metres (it only scales movement; calibration sets the centre). */
const VIEW_M = 0.5;
/** Forget a hand the camera hasn't seen for this long. */
const LOST_MS = 500;

export class OverheadGloveCamera {
  readonly video = document.createElement('video');
  cameraId = '';
  swapHands = false;
  rotation: Rotation = 0;
  /** Where each hand was last seen, 0..1 in the turned picture (for the preview). */
  hands: Partial<Record<Side, HandPoint & { at: number }>> = {};
  private stream: MediaStream | null = null;
  private raf = 0;
  private running = false;
  private canvas = document.createElement('canvas');
  private tracker: GloveTracker | null = null;

  async start(onFrame: (f: RokokoFrame) => void, onStatus: (s: SourceStatus) => void) {
    this.running = true;
    onStatus({ state: 'starting', message: 'Waiting for camera permission…' });
    this.stream = await openCamera(this.cameraId);
    if (!this.running) return this.stop();
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    onStatus({ state: 'waiting', message: 'Learning the table… keep the camera still' });

    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    let lastVideoTime = -1;
    let seen = false;
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const v = this.video;
      if (v.readyState < 2 || v.currentTime === lastVideoTime || !v.videoWidth) return;
      lastVideoTime = v.currentTime;

      const [w, h] = rotatedSize(TRACK_W, Math.round((TRACK_W * v.videoHeight) / v.videoWidth), this.rotation);
      if (!this.tracker || this.tracker.w !== w || this.tracker.h !== h) {
        this.tracker = new GloveTracker(w, h);
        this.canvas.width = w;
        this.canvas.height = h;
      }
      drawRotated(ctx, v, this.rotation, w, h);
      const blobs = this.tracker.update(ctx.getImageData(0, 0, w, h).data);

      const now = performance.now();
      const prev: Partial<Record<Side, HandPoint>> = {};
      for (const s of ['left', 'right'] as Side[]) {
        const p = this.hands[s];
        if (p && now - p.at < LOST_MS) prev[s] = p;
        else delete this.hands[s];
      }
      const found = assignSides(blobs, prev, this.swapHands);
      const body: Record<string, JointFrame> = {};
      for (const s of ['left', 'right'] as Side[]) {
        const p = found[s];
        if (!p) continue;
        this.hands[s] = { ...p, at: now };
        body[`${s}Hand`] = {
          // Rokoko metres: x = player's right, y up (the camera can't tell, so a fixed height), z away from the player.
          position: { x: (p.x - 0.5) * VIEW_M, y: 1.2, z: 0.3 + (0.5 - p.y) * VIEW_M * (h / w) },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        };
      }
      const any = Object.keys(body).length > 0;
      if (any !== seen) onStatus(any ? { state: 'live', message: 'Tracking' } : { state: 'waiting', message: 'No glove in view' });
      seen = any;
      if (any)
        onFrame({
          version: 3,
          fps: 30,
          scene: {
            timestamp: now / 1000,
            actors: [{ name: 'Overhead camera', color: [62, 124, 140], meta: { hasGloves: true, hasLeftGlove: !!found.left, hasRightGlove: !!found.right, hasBody: false, hasFace: false }, dimensions: { totalHeight: 1.8, hipHeight: 0.95 }, body }],
            props: [],
          },
        });
    };
    loop();
  }

  /** Relearn the table (e.g. after moving the camera). */
  relearn() {
    this.tracker?.reset();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.tracker = null;
    this.hands = {};
  }
}
