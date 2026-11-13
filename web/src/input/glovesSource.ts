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
      ws.onopen = () => onStatus({ state: 'waiting', message: 'Bridge connected, waiting for Rokoko Studio to stream' });
      ws.onmessage = (ev) => {
        let msg: unknown;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (!isRokokoFrame(msg)) return;
        if (Date.now() - this.lastFrame > 1000) onStatus({ state: 'live', message: `Streaming from Rokoko Studio` });
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
        onStatus({ state: 'waiting', message: 'Bridge connected, but Rokoko Studio stopped streaming' });
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
