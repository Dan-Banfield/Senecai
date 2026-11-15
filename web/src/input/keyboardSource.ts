// Keyboard + mouse emulator, for when there's no camera (or for quick testing).
// Right (working) hand:
//   A S D F G  = curl thumb, index, middle, ring, little (hold)
//   H          = thumb opposition
//   Space      = make a fist
//   Mouse      = move the hand, wheel = depth
// Left (other) hand, resting in front of you:
//   Z          = close / open its fist (toggle)
//   Arrow keys = turn its wrist (left/right, tip up/down)
// Shift + Left/Right is left alone: on the ocarina page it switches the camera view.
// It still emits Rokoko JSON v3 frames, built with forward kinematics.

import { Euler, Quaternion, Vector3 } from 'three';
import { buildFrame } from '../rokoko/build';
import type { RokokoFrame } from '../rokoko/types';
import type { HandSource, SourceStatus } from './types';

const FINGER_KEYS = ['a', 's', 'd', 'f', 'g'];

export const KEYBOARD_HELP = 'A S D F G = thumb…little · Space = fist · H = thumb across palm · mouse = move hand · Z = left fist · arrows = turn left wrist · shift+←/→ = camera view';

export class KeyboardSource implements HandSource {
  readonly kind = 'keyboard' as const;
  private down = new Set<string>();
  private curl = [0, 0, 0, 0, 0];
  private thumbRotate = 0;
  private mouse = { x: 0.5, y: 0.5 };
  private depth = 0;
  private leftFist = false;
  private leftCurl = 0;
  private leftYaw = 0;
  private leftPitch = 0;
  private timer = 0;
  private cleanup: (() => void) | null = null;

  async start(onFrame: (f: RokokoFrame) => void, onStatus: (s: SourceStatus) => void) {
    const typing = (e: Event) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const kd = (e: KeyboardEvent) => {
      if (typing(e)) return;
      // Shift + Left/Right belongs to the ocarina camera; its handler calls preventDefault.
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
      if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.repeat) this.leftFist = !this.leftFist;
      this.down.add(k);
    };
    const ku = (e: KeyboardEvent) => this.down.delete(e.key.toLowerCase());
    const mm = (e: MouseEvent) => (this.mouse = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    const wh = (e: WheelEvent) => (this.depth = Math.max(-1, Math.min(1, this.depth - e.deltaY * 0.001)));
    const blur = () => this.down.clear();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('mousemove', mm);
    window.addEventListener('wheel', wh, { passive: true });
    window.addEventListener('blur', blur);
    this.cleanup = () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('wheel', wh);
      window.removeEventListener('blur', blur);
    };

    onStatus({ state: 'live', message: KEYBOARD_HELP });
    const dt = 1 / 60;
    const ease = (v: number, target: number, speed: number) => v + (target - v) * Math.min(1, speed * dt);
    this.timer = window.setInterval(() => {
      const fist = this.down.has(' ');
      this.curl = this.curl.map((c, i) => ease(c, fist || this.down.has(FINGER_KEYS[i]) ? 1 : 0, 18));
      this.thumbRotate = ease(this.thumbRotate, fist || this.down.has('h') ? 1 : 0, 12);
      this.leftCurl = ease(this.leftCurl, this.leftFist ? 1 : 0, 14);
      const turn = 1.5 * dt;
      if (this.down.has('arrowleft')) this.leftYaw = Math.min(1.4, this.leftYaw + turn);
      if (this.down.has('arrowright')) this.leftYaw = Math.max(-1.4, this.leftYaw - turn);
      if (this.down.has('arrowup')) this.leftPitch = Math.min(1.3, this.leftPitch + turn);
      if (this.down.has('arrowdown')) this.leftPitch = Math.max(-1.3, this.leftPitch - turn);
      const lc = this.leftCurl;
      const frame = buildFrame(
        [
          {
            side: 'right',
            wristPosition: new Vector3((this.mouse.x - 0.5) * 0.5, 1.2 + (0.5 - this.mouse.y) * 0.5, 0.3 + this.depth * 0.25),
            wristRotation: new Quaternion(),
            curl: this.curl as [number, number, number, number, number],
            thumbRotate: this.thumbRotate,
          },
          {
            side: 'left',
            wristPosition: new Vector3(-0.2, 1.15, 0.3),
            wristRotation: new Quaternion().setFromEuler(new Euler(this.leftPitch, this.leftYaw, 0, 'YXZ')),
            curl: [lc, lc, lc, lc, lc],
            thumbRotate: lc,
          },
        ],
        performance.now() / 1000,
        'Keyboard Emulator',
      );
      onFrame(frame);
    }, dt * 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.cleanup?.();
    this.cleanup = null;
    this.down.clear();
  }
}
