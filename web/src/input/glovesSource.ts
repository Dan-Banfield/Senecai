// Real Rokoko Smartgloves: Rokoko Studio -> UDP -> bridge -> this WebSocket.
// The frames arrive exactly as Studio sent them (decompressed by the bridge).

import { isRokokoFrame, type RokokoFrame } from '../rokoko/types';
import type { HandSource, SourceStatus } from './types';

export const DEFAULT_BRIDGE_URL = 'ws://localhost:14044';

export class GlovesSource implements HandSource {
  readonly kind = 'gloves' as const;
  private ws: WebSocket | null = null;
  private running = false;
  private retry = 0;
  private watchdog = 0;
  private lastFrame = 0;

  constructor(public url = DEFAULT_BRIDGE_URL) {}

  async start(onFrame: (f: RokokoFrame) => void, onStatus: (s: SourceStatus) => void) {
    this.running = true;
    const connect = () => {
      if (!this.running) return;
      onStatus({ state: 'starting', message: `Connecting to bridge at ${this.url}…` });
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => onStatus({ state: 'waiting', message: 'Bridge connected, waiting for gloves (Rokoko Device SDK or Studio)' });
      ws.onmessage = (ev) => {
        let msg: unknown;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (!isRokokoFrame(msg)) return;
        if (Date.now() - this.lastFrame > 1000) {
          const actor = msg.scene.actors[0]?.name ?? '';
          onStatus({ state: 'live', message: actor === 'Rokoko Device SDK' ? 'Streaming from the Rokoko Device SDK' : `Streaming from Rokoko Studio (${actor || 'no actor'})` });
        }
        this.lastFrame = Date.now();
        onFrame(msg);
      };
      ws.onclose = () => {
        if (!this.running) return;
        onStatus({ state: 'error', message: 'Bridge not reachable. Is "npm run bridge" running? Retrying…' });
        this.retry = window.setTimeout(connect, 2000);
      };
    };
    connect();
    this.watchdog = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && this.lastFrame && Date.now() - this.lastFrame > 1500) {
        onStatus({ state: 'waiting', message: 'Bridge connected, but the gloves stopped streaming' });
        this.lastFrame = 0;
      }
    }, 500);
  }

  stop() {
    this.running = false;
    clearTimeout(this.retry);
    clearInterval(this.watchdog);
    this.ws?.close();
    this.ws = null;
  }
}
