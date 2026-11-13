// Senecai bridge: Rokoko Studio (UDP) -> browser (WebSocket).
//
//   Rokoko Studio  --UDP :14043-->  bridge  --WS :14044-->  Senecai web app
//
// In Rokoko Studio: Livestream -> Custom -> JSON v3, forward IP = the machine
// running this bridge, port 14043. Studio runs on macOS/Windows; the bridge can
// run on the same Mac or on any machine on the LAN.
import dgram from 'node:dgram';
import { WebSocketServer } from 'ws';
import { decodeDatagram } from './decode.js';
import { createRobotOutput } from './robot-output.js';

const UDP_PORT = Number(process.env.ROKOKO_UDP_PORT ?? 14043);
const WS_PORT = Number(process.env.SENECAI_WS_PORT ?? 14044);

const robot = createRobotOutput();
const wss = new WebSocketServer({ port: WS_PORT });
const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });

let frames = 0;
let lastError = '';
let lastCompression = '';
let lastActors = '';

udp.on('message', (msg) => {
  const result = decodeDatagram(msg);
  if (!result.ok) {
    if (result.error !== lastError) console.warn(`[udp] ${result.error}`);
    lastError = result.error;
    return;
  }
  lastError = '';
  frames++;
  lastCompression = result.compression;
  lastActors = result.frame.scene.actors
    .map((a) => `${a.name}${a.meta?.hasGloves ? ' (gloves)' : ''}`)
    .join(', ');
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(result.text);
  }
});

udp.on('error', (err) => {
  console.error(`[udp] ${err.message}`);
  process.exit(1);
});

wss.on('connection', (ws, req) => {
  console.log(`[ws] browser connected from ${req.socket.remoteAddress}`);
  ws.send(JSON.stringify({ type: 'senecai-hello', udpPort: UDP_PORT }));
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
  if (frames > 0) {
    console.log(`[udp] ${frames} frames/5s (${lastCompression}) actors: ${lastActors} -> ${wss.clients.size} browser(s)`);
  }
  frames = 0;
}, 5000);

udp.bind(UDP_PORT, () => {
  console.log(`Senecai bridge
  listening for Rokoko Studio on udp://0.0.0.0:${UDP_PORT}
  serving browsers on        ws://localhost:${WS_PORT}
  (no gloves? run "npm run fake-studio" in another terminal)`);
});
