// Pretends to be the Rokoko Device SDK hand solver: an RGMP v2 server (default
// port 12277) that streams two solved hands with a "piano roll" finger wave.
// Lets you test the whole SDK path on any machine without gloves.
//
//   node src/fake-sdk.js [--port 12277] [--unknown-hands]
//
// Like the real solver, each device advertises a joints_local group before
// joints_openxr, so clients must look groups up by name, not assume index 0.

import net from 'node:net';
import { OPENXR_JOINTS, synthOpenXrHand } from './openxr-hand.js';
import { encodeFrame, MSG_DATA, MSG_DEFINITION } from './rgmp.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const port = Number(opt('port', 12277));
const unknownHands = args.includes('--unknown-hands');

const GLOVES = [
  { id: 1001, side: 'left' },
  { id: 1002, side: 'right' },
];

export function definitionFor(glove, { unknownHand = false } = {}) {
  return {
    protocol_name: 'RGMP',
    protocol_version: '2.0.0',
    device_id: glove.id,
    device_type: 'solved_hand',
    timestamp_epoch: 'device_boot',
    device_info: { friendly_name: `Fake Smartglove ${glove.side}`, hand: unknownHand ? 'unknown' : glove.side },
    static_data: [],
    groups: [
      // Present but never sent by this fake: proves clients pick the group by name.
      { name: 'joints_local', expected_rate_hz: 83.33, streams: OPENXR_JOINTS.map((j) => ({ data_type: 'FLOAT[4]', measure_type: 'ORIENTATION', target_frame: j })) },
      { name: 'joints_openxr', expected_rate_hz: 83.33, streams: OPENXR_JOINTS.map((j) => ({ data_type: 'FLOAT[7]', measure_type: 'TRANSFORM', target_frame: `xr_${j}`, reference_frame: 'xr_base' })) },
    ],
  };
}

export function dataFrameFor(glove, joints, timestampUs, groupId = 1) {
  const buf = Buffer.alloc(16 + joints.length * 28);
  buf.writeUInt32LE(glove.id, 0);
  buf.writeUInt32LE(groupId, 4);
  buf.writeBigUInt64LE(BigInt(Math.round(timestampUs)), 8);
  joints.forEach((j, i) => [...j.p, ...j.q].forEach((v, k) => buf.writeFloatLE(v, 16 + i * 28 + k * 4)));
  return encodeFrame(MSG_DATA, buf);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = net.createServer((sock) => {
    console.log(`fake-sdk: client connected from ${sock.remoteAddress}`);
    for (const g of GLOVES) sock.write(encodeFrame(MSG_DEFINITION, Buffer.from(JSON.stringify(definitionFor(g, { unknownHand: unknownHands })))));
    const t0 = Date.now();
    const timer = setInterval(() => {
      const t = (Date.now() - t0) / 1000;
      for (const g of GLOVES) {
        const phase = g.side === 'left' ? Math.PI : 0;
        const curl = [0, 1, 2, 3, 4].map((i) => 0.5 + 0.5 * Math.sin(t * 3 - i * 0.8 + phase));
        // Gentle wrist yaw wobble (rotation about Y).
        const half = (0.15 * Math.sin(t * 0.7)) / 2;
        const q = [0, Math.sin(half), 0, Math.cos(half)];
        sock.write(dataFrameFor(g, synthOpenXrHand(g.side, curl, 0.3 + 0.3 * Math.sin(t), q), t * 1e6));
      }
    }, 12); // ~83 Hz like Smartgloves
    sock.on('close', () => clearInterval(timer));
    sock.on('error', () => clearInterval(timer));
  });
  server.listen(port, '127.0.0.1', () => console.log(`fake-sdk: RGMP v2 solved hands on tcp://127.0.0.1:${port} (2 gloves, ~83 Hz${unknownHands ? ', hands reported as unknown' : ''})`));
}
