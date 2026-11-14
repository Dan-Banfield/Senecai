// Senecai bridge: Rokoko gloves -> browser (WebSocket :14044), from either source:
//
//   Rokoko Device SDK (Linux/macOS/Windows, no Studio needed)
//     rokoko-sdk ──RGMP :12276──> rkk-hand-solver ──RGMP :12277──> bridge ──WS :14044──> web app
//
//   Rokoko Studio (macOS/Windows)
//     Studio "Custom" livestream, JSON v3 ──UDP :14043──> bridge ──WS :14044──> web app
//
// Both are always listened for; whichever is streaming feeds the app. SDK frames
// are converted to the Studio JSON v3 format, so the web app sees one format.
//
//   node src/index.js [--spawn-sdk] [--no-sdk] [--no-studio] [--sdk-host 127.0.0.1] [--sdk-port 12277]
import dgram from 'node:dgram';
import { WebSocketServer } from 'ws';
import { decodeDatagram } from './decode.js';
import { createRobotOutput } from './robot-output.js';
import { connectSdk } from './sdk-client.js';
import { spawnSdk } from './spawn-sdk.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const UDP_PORT = Number(process.env.ROKOKO_UDP_PORT ?? 14043);
const WS_PORT = Number(process.env.SENECAI_WS_PORT ?? 14044);
const SDK_HOST = opt('sdk-host', process.env.ROKOKO_SDK_HOST ?? '127.0.0.1');
const SDK_PORT = Number(opt('sdk-port', process.env.ROKOKO_SDK_PORT ?? 12277));

const robot = createRobotOutput();
const wss = new WebSocketServer({ port: WS_PORT });
const counts = { studio: 0, sdk: 0 };
let lastActors = '';

function broadcast(text) {
  for (const client of wss.clients) if (client.readyState === 1) client.send(text);
}

// --- Rokoko Studio over UDP ---
if (!flag('no-studio')) {
  const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let lastError = '';
  udp.on('message', (msg) => {
    const result = decodeDatagram(msg);
    if (!result.ok) {
      if (result.error !== lastError) console.warn(`[studio] ${result.error}`);
      lastError = result.error;
      return;
    }
    lastError = '';
    counts.studio++;
    lastActors = result.frame.scene.actors.map((a) => `${a.name}${a.meta?.hasGloves ? ' (gloves)' : ''}`).join(', ');
    broadcast(result.text);
  });
  udp.on('error', (err) => console.error(`[studio] UDP ${err.message}`));
  udp.bind(UDP_PORT);
}

// --- Rokoko Device SDK over TCP ---
if (flag('spawn-sdk')) spawnSdk();
if (!flag('no-sdk')) {
  connectSdk({
    host: SDK_HOST,
    port: SDK_PORT,
    onFrame: (frame) => {
      counts.sdk++;
      broadcast(JSON.stringify(frame));
    },
  });
}

wss.on('connection', (ws, req) => {
  console.log(`[ws] browser connected from ${req.socket.remoteAddress}`);
  ws.send(JSON.stringify({ type: 'senecai-hello', udpPort: UDP_PORT, sdk: `${SDK_HOST}:${SDK_PORT}` }));
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'robot' && Array.isArray(msg.inspire)) robot.send(msg);
    } catch {
      /* ignore malformed */
    }
  });
  ws.on('close', () => console.log('[ws] browser disconnected'));
});

setInterval(() => {
  const parts = [];
  if (counts.sdk) parts.push(`SDK ${counts.sdk} frames`);
  if (counts.studio) parts.push(`Studio ${counts.studio} frames (${lastActors})`);
  if (parts.length) console.log(`[bridge] last 5s: ${parts.join(', ')} -> ${wss.clients.size} browser(s)`);
  counts.studio = counts.sdk = 0;
}, 5000);

console.log(`Senecai bridge
  Rokoko Device SDK : ${flag('no-sdk') ? 'off' : `hand solver at tcp://${SDK_HOST}:${SDK_PORT}${flag('spawn-sdk') ? ' (starting rokoko-sdk + rkk-hand-solver)' : ''}`}
  Rokoko Studio     : ${flag('no-studio') ? 'off' : `udp://0.0.0.0:${UDP_PORT}`}
  browsers          : ws://localhost:${WS_PORT}
  (no gloves? "npm run fake-sdk" or "npm run fake-studio" in another terminal)`);
