// Connects to the Rokoko Device SDK's hand solver (RGMP v2 over TCP, default
// 127.0.0.1:12277), turns solved hands into Studio JSON v3 frames, and hands
// them to `onFrame` at up to 60 Hz. Reconnects with backoff, like Rokoko's own
// ROS 2 bridge (0.5 s doubling to 10 s).

import net from 'node:net';
import { buildStudioFrame, jointsFromRgmp } from './openxr-hand.js';
import { RgmpParser } from './rgmp.js';

const OPENXR_GROUP = 'joints_openxr';
const STALE_MS = 500;

export function connectSdk({ host = '127.0.0.1', port = 12277, onFrame, log = console.log, emitHz = 60 }) {
  const devices = new Map(); // device_id -> { side, joints, lastAt, friendly }
  let socket = null;
  let delay = 500;
  let timer = null;
  let closed = false;
  let dirty = false;
  let warnedNoOpenxr = false;
  let lastState = '';
  const state = (s) => {
    if (s !== lastState) log(`[sdk] ${s}`);
    lastState = s;
  };

  const handFor = (def) => {
    const hand = String(def.device_info?.hand ?? '').toLowerCase();
    return hand === 'left' || hand === 'right' ? hand : 'unknown';
  };

  const parserFor = () =>
    new RgmpParser({
      onDefinition(id, compiled) {
        const def = compiled.def;
        const groups = [...compiled.groups.values()].map((g) => g.name);
        if (!groups.includes(OPENXR_GROUP)) {
          if (!warnedNoOpenxr) log(`[sdk] device ${id} (${def.device_type}) has groups [${groups.join(', ')}] but no "${OPENXR_GROUP}". Start the solver with --emit-openxr (needs SDK 0.10.0+), and make sure this is the solver port (12277), not the raw driver port (12276).`);
          warnedNoOpenxr = true;
          return;
        }
        devices.set(id, { side: handFor(def), joints: null, lastAt: 0, friendly: def.device_info?.friendly_name ?? `device ${id}` });
        log(`[sdk] solved hand: ${devices.get(id).friendly} (${devices.get(id).side} hand, id ${id})`);
      },
      onData(decoded) {
        const dev = devices.get(decoded.deviceId);
        if (!dev || decoded.group?.name !== OPENXR_GROUP) return;
        dev.joints = jointsFromRgmp(decoded);
        dev.lastAt = Date.now();
        dirty = true;
        delay = 500; // data flowing: reset backoff
      },
      onDisconnect(id) {
        const dev = devices.get(id);
        if (dev) log(`[sdk] ${dev.friendly} disconnected`);
        devices.delete(id);
      },
      onError(e) {
        log(`[sdk] ${e.message}`);
      },
    });

  const connect = () => {
    if (closed) return;
    // While retrying, stay quiet until something changes.
    if (!lastState.startsWith('hand solver not reachable')) state(`connecting to hand solver at ${host}:${port}…`);
    const parser = parserFor();
    socket = net.connect({ host, port });
    socket.setTimeout(5000);
    socket.on('connect', () => {
      socket.setTimeout(0);
      state(`connected to hand solver at ${host}:${port}, waiting for gloves`);
    });
    socket.on('data', (chunk) => parser.push(chunk));
    socket.on('timeout', () => socket.destroy(new Error('connect timeout')));
    socket.on('error', () => {}); // reported via 'close'
    socket.on('close', () => {
      devices.clear();
      if (closed) return;
      state(`hand solver not reachable at ${host}:${port} (is rkk-hand-solver running?), retrying`);
      timer = setTimeout(connect, delay);
      delay = Math.min(10000, delay * 2);
    });
  };

  // Merge the latest pose of each glove into one Studio frame.
  const emitter = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    const now = Date.now();
    const live = [...devices.entries()].filter(([, d]) => d.joints && now - d.lastAt < STALE_MS).sort(([a], [b]) => a - b);
    const hands = {};
    // Known sides first; unknown sides fill whatever is free (right first).
    for (const [, d] of live) if (d.side !== 'unknown' && !hands[d.side]) hands[d.side] = d.joints;
    for (const [, d] of live) {
      if (d.side !== 'unknown') continue;
      const free = !hands.right ? 'right' : !hands.left ? 'left' : null;
      if (free) hands[free] = d.joints;
    }
    if (hands.left || hands.right) {
      state(`streaming ${Object.keys(hands).join(' + ')} hand${Object.keys(hands).length > 1 ? 's' : ''} from the Rokoko Device SDK`);
      onFrame(buildStudioFrame(hands, now / 1000));
    }
  }, 1000 / emitHz);

  connect();
  return {
    devices,
    close() {
      closed = true;
      clearTimeout(timer);
      clearInterval(emitter);
      socket?.destroy();
    },
  };
}
