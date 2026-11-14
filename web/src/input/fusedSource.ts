// Rokoko gloves + webcam. Smartgloves measure fingers and wrist rotation very
// well but can't tell where the hand is in space (that needs a Coil Pro); the
// webcam is the opposite. So the gloves drive the fingers and the wrist's
// orientation, and the webcam only says where each hand is.
//
// Every glove frame is passed on with each hand's joints moved, as a whole, to
// where the camera last saw that hand. Nothing else about the glove data
// changes, so finger bends and wrist turns are exactly the gloves'. The frame
// is marked as carrying real positions, so the robot hands follow your hands
// around rather than aiming by wrist angle.

import type { JointFrame, RokokoFrame, Side } from '../rokoko/types';
import { GlovesSource } from './glovesSource';
import type { HandSource, SourceStatus } from './types';
import { WebcamSource } from './webcamSource';

type P = { x: number; y: number; z: number };

/**
 * A glove frame with each hand moved, as a whole, to where the camera last saw
 * it (`seen`, wrist positions in Rokoko metres). Rotations are untouched. The
 * frame is marked as carrying real positions.
 */
export function placeHands(f: RokokoFrame, seen: Partial<Record<Side, { p: P }>>): RokokoFrame | null {
  const actor = f.scene.actors[0];
  if (!actor?.body) return null;
  const body: Record<string, JointFrame> = {};
  for (const [name, j] of Object.entries(actor.body)) if (j) body[name] = { position: { ...j.position }, rotation: j.rotation };
  for (const side of ['left', 'right'] as Side[]) {
    const wrist = body[`${side}Hand`];
    const cam = seen[side];
    if (!wrist || !cam) continue;
    const dx = cam.p.x - wrist.position.x;
    const dy = cam.p.y - wrist.position.y;
    const dz = cam.p.z - wrist.position.z;
    for (const [name, j] of Object.entries(body))
      if (name.startsWith(side)) {
        j.position.x += dx;
        j.position.y += dy;
        j.position.z += dz;
      }
  }
  // Keep the gloves' orientation convention, but these positions are real now.
  return { ...f, scene: { ...f.scene, actors: [{ ...actor, body, senecai: { ...actor.senecai, positions: 'tracked' } }, ...f.scene.actors.slice(1)] } };
}

export class FusedSource implements HandSource {
  readonly kind = 'fused' as const;
  readonly gloves: GlovesSource;
  readonly webcam = new WebcamSource();
  /** Where the camera last saw each hand (Rokoko metres), and when. */
  private seen: Partial<Record<Side, { p: P; at: number }>> = {};
  private status = { gloves: 'Connecting to the gloves…', camera: 'Starting the camera…', live: false };

  constructor(bridgeUrl: string, swapHands = false) {
    this.gloves = new GlovesSource(bridgeUrl);
    this.webcam.swapHands = swapHands;
  }

  async start(onFrame: (f: RokokoFrame) => void, onStatus: (s: SourceStatus) => void) {
    const report = () => {
      const now = performance.now();
      const cam = (['left', 'right'] as Side[]).filter((s) => now - (this.seen[s]?.at ?? -1e9) < 600);
      const camText = cam.length ? `camera sees ${cam.map((s) => (s === 'left' ? 'L' : 'R')).join('+')}` : this.status.camera;
      onStatus({ state: this.status.live ? 'live' : 'waiting', message: `${this.status.gloves} · ${camText}` });
    };

    const onCamera = (f: RokokoFrame) => {
      const body = f.scene.actors[0]?.body ?? {};
      const now = performance.now();
      for (const side of ['left', 'right'] as Side[]) {
        const wrist = body[`${side}Hand`];
        if (wrist) this.seen[side] = { p: { ...wrist.position }, at: now };
      }
    };

    const onGloves = (f: RokokoFrame) => {
      const placed = placeHands(f, this.seen);
      if (placed) onFrame(placed);
    };

    await Promise.all([
      this.gloves.start(onGloves, (s) => {
        this.status.gloves = s.state === 'live' ? 'Gloves streaming' : s.message;
        this.status.live = s.state === 'live';
        report();
      }),
      this.webcam
        .start(onCamera, (s) => {
          this.status.camera = s.state === 'live' ? 'camera tracking' : s.message;
          report();
        })
        .catch((e) => {
          this.status.camera = `Camera unavailable (${e instanceof Error ? e.message : e}); hands won't move around`;
          report();
        }),
    ]);
  }

  stop() {
    this.gloves.stop();
    this.webcam.stop();
    this.seen = {};
  }
}
