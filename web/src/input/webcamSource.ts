// Webcam glove emulator: MediaPipe hand tracking -> Rokoko JSON v3 frames.
//
// For each tracked hand we rebuild what Rokoko Studio would stream for a glove:
// a `<side>Hand` joint plus Proximal/Medial/Distal/Tip for every finger, each
// with a position and an absolute orientation. The hand frame comes from the
// middle metacarpal and the palm normal; each phalanx frame from its bone
// direction plus a fixed lateral (flex) axis, so the relative joint rotations
// encode real finger flexion, just as they do in Studio's data.
//
// Best tracking pose: hand raised, palm facing the camera. That pose is also
// the "neutral" robot wrist orientation (identity), so no calibration is needed
// to get started.

import { FilesetResolver, HandLandmarker, type HandLandmarkerResult, type Landmark, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { basisQuaternion } from '../rokoko/build';
import { FINGERS, PHALANGES, fingerJoint, handJoint, type JointFrame, type RokokoFrame, type Side } from '../rokoko/types';
import type { HandSource, SourceStatus } from './types';

const LOCAL_WASM = '/mediapipe/wasm';
const LOCAL_MODEL = '/mediapipe/hand_landmarker.task';
const CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const CDN_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// MediaPipe landmark indices per finger: [base, joint1, joint2, tip].
const CHAINS: Record<(typeof FINGERS)[number], [number, number, number, number]> = {
  Thumb: [1, 2, 3, 4],
  Index: [5, 6, 7, 8],
  Middle: [9, 10, 11, 12],
  Ring: [13, 14, 15, 16],
  Little: [17, 18, 19, 20],
};

/** MediaPipe world space (x right in image, y down, z away from camera) -> Rokoko (x = user's right, y up, z towards camera). */
const toRokoko = (l: Landmark) => new Vector3(-l.x, -l.y, -l.z);

/**
 * Orientation whose +Y points along `forward` and +X along (orthogonalised)
 * `lateral`, with +Z = X × Y, matching basisQuaternion's handedness. Flexion
 * rotates a bone about the lateral axis, so unlike a palm-normal reference it
 * never becomes parallel to the bone and the frame cannot flip past 90°.
 */
function lateralQuaternion(forward: Vector3, lateral: Vector3): Quaternion {
  const y = forward.clone().normalize();
  const x = lateral.clone().addScaledVector(y, -lateral.dot(y)).normalize();
  const z = new Vector3().crossVectors(x, y);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

/** Thumb rest splay in the palm plane (radians), matching build.ts. */
const THUMB_SPLAY = 0.8;

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
const jf = (p: Vector3, q: { x: number; y: number; z: number; w: number }): JointFrame => ({
  position: { x: r5(p.x), y: r5(p.y), z: r5(p.z) },
  rotation: { x: r5(q.x), y: r5(q.y), z: r5(q.z), w: r5(q.w) },
});

export function landmarksToJoints(side: Side, world: Landmark[], image: NormalizedLandmark[], body: Record<string, JointFrame>) {
  // Wrist position in "Rokoko metres": image position for x/y, apparent hand size for depth.
  const palmIdx = [0, 5, 9, 13, 17];
  const cx = palmIdx.reduce((s, i) => s + image[i].x, 0) / palmIdx.length;
  const cy = palmIdx.reduce((s, i) => s + image[i].y, 0) / palmIdx.length;
  const size = Math.hypot(image[9].x - image[0].x, image[9].y - image[0].y);
  const wristPos = new Vector3((0.5 - cx) * 0.8, 1.2 + (0.5 - cy) * 0.6, 0.3 + (size - 0.2) * 1.0);

  const pts = world.map(toRokoko);
  const origin = pts[0].clone();
  const at = (i: number) => wristPos.clone().add(pts[i].clone().sub(origin));

  const a = pts[5].clone().sub(pts[0]);
  const b = pts[17].clone().sub(pts[0]);
  const normal = side === 'right' ? new Vector3().crossVectors(b, a) : new Vector3().crossVectors(a, b);
  const handQ = basisQuaternion(pts[9].clone().sub(pts[0]), normal);
  body[handJoint(side)] = jf(wristPos, handQ);

  // Flex axes. Fingers: the hand's +X, i.e. the index->little knuckle line
  // (pts[17]-pts[5], sign flipped for the left hand) made perpendicular to the
  // middle metacarpal, so a straight finger has exactly the hand's orientation.
  // Thumb: that axis turned by the rest splay within the palm plane, i.e.
  // perpendicular to a relaxed thumb. A thumb bone would have to point along
  // the palm towards the little-finger knuckles (or back past the wrist) to
  // line up with it, which keeps the thumb clear of the L-pose (thumb along
  // the knuckle line) that a plain hand-X reference would degenerate on.
  const handX = new Vector3(1, 0, 0).applyQuaternion(handQ);
  const handY = new Vector3(0, 1, 0).applyQuaternion(handQ);
  const sgn = side === 'right' ? 1 : -1;
  const thumbX = handX.clone().multiplyScalar(Math.cos(THUMB_SPLAY)).addScaledVector(handY, sgn * Math.sin(THUMB_SPLAY));

  for (const finger of FINGERS) {
    const chain = CHAINS[finger];
    const lateral = finger === 'Thumb' ? thumbX : handX;
    let lastQ = handQ;
    PHALANGES.forEach((ph, i) => {
      if (i < 3) lastQ = lateralQuaternion(pts[chain[i + 1]].clone().sub(pts[chain[i]]), lateral);
      body[fingerJoint(side, finger, ph)] = jf(at(chain[i]), lastQ);
    });
  }
}

/** Opens the camera `cameraId` (a MediaDeviceInfo.deviceId), or the default one if that's empty or gone. */
export async function openCamera(cameraId: string, size = { width: 640, height: 480 }): Promise<MediaStream> {
  const fallback = () => navigator.mediaDevices.getUserMedia({ video: { ...size, facingMode: 'user' }, audio: false });
  if (!cameraId) return fallback();
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { ...size, deviceId: { exact: cameraId } }, audio: false });
  } catch (e) {
    // The chosen camera is unplugged (or its id changed): use the default one rather than nothing.
    if (e instanceof DOMException && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) return fallback();
    throw e;
  }
}

export class WebcamSource implements HandSource {
  readonly kind = 'webcam' as const;
  readonly video = document.createElement('video');
  lastResult: HandLandmarkerResult | null = null;
  swapHands = false;
  /** Which camera to use (a MediaDeviceInfo.deviceId); empty means the browser's default. */
  cameraId = '';
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private running = false;

  async start(onFrame: (f: RokokoFrame) => void, onStatus: (s: SourceStatus) => void) {
    this.running = true;
    onStatus({ state: 'starting', message: 'Loading hand tracker…' });
    const lm = await this.createLandmarker();
    if (!this.running) {
      lm.close();
      return;
    }
    this.landmarker = lm;

    onStatus({ state: 'starting', message: 'Waiting for camera permission…' });
    this.stream = await openCamera(this.cameraId);
    if (!this.running) return this.stop();
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    onStatus({ state: 'waiting', message: 'Show your hand to the camera, palm facing it' });

    let lastVideoTime = -1;
    let seen = false;
    const loop = () => {
      if (!this.running || !this.landmarker) return;
      this.raf = requestAnimationFrame(loop);
      if (this.video.readyState < 2 || this.video.currentTime === lastVideoTime) return;
      lastVideoTime = this.video.currentTime;
      const now = performance.now();
      const res = this.landmarker.detectForVideo(this.video, now);
      this.lastResult = res;

      const body: Record<string, JointFrame> = {};
      const present = new Set<Side>();
      res.landmarks.forEach((image, i) => {
        const label = res.handedness[i]?.[0]?.categoryName;
        let side: Side = label === 'Left' ? 'left' : 'right';
        if (this.swapHands) side = side === 'left' ? 'right' : 'left';
        if (present.has(side)) return;
        present.add(side);
        landmarksToJoints(side, res.worldLandmarks[i], image, body);
      });
      if (present.size && !seen) onStatus({ state: 'live', message: 'Tracking' });
      if (!present.size && seen) onStatus({ state: 'waiting', message: 'No hand in view' });
      seen = present.size > 0;

      onFrame({
        version: 3,
        fps: 30,
        scene: {
          timestamp: now / 1000,
          actors: [
            {
              name: 'Webcam Emulator',
              color: [62, 124, 140],
              meta: { hasGloves: present.size > 0, hasLeftGlove: present.has('left'), hasRightGlove: present.has('right'), hasBody: false, hasFace: false },
              dimensions: { totalHeight: 1.8, hipHeight: 0.95 },
              body,
            },
          ],
          props: [],
        },
      });
    };
    loop();
  }

  private async createLandmarker(): Promise<HandLandmarker> {
    const make = async (wasm: string, model: string) =>
      HandLandmarker.createFromOptions(await FilesetResolver.forVisionTasks(wasm), {
        baseOptions: { modelAssetPath: model, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });
    try {
      return await make(LOCAL_WASM, LOCAL_MODEL);
    } catch (e) {
      console.warn('Local MediaPipe assets failed, trying CDN', e);
      return make(CDN_WASM, CDN_MODEL);
    }
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.lastResult = null;
  }
}
