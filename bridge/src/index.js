// Senecai bridge: Rokoko gloves -> browser (WebSocket :14044), from either source:
//
//   Rokoko Device SDK (Linux/macOS/Windows, no Studio needed)
//     rokoko-sdk ──RGMP :12276──> rkk-hand-solver ──RGMP :12277──> bridge ──WS :14044──> web app
//
//   Rokoko Studio (macOS/Windows)
//     Studio "Custom" livestream, JSON v3 ──UDP :14043──> bridge ──WS :14044──> web app
//
// Both are always listened for; whichever is streaming hand data feeds the app
// (if both do, the first keeps it until it has sent no hands for 500 ms; a source
// without hands, e.g. Studio with no gloves, never takes the feed). SDK frames are
// converted to the Studio JSON v3 format, so the web app sees one format.
//
//   node src/index.js [--spawn-sdk] [--no-sdk] [--no-studio] [--sdk-host 127.0.0.1] [--sdk-port 12277]
import dgram from 'node:dgram';
import { WebSocketServer } from 'ws';
import { createArbiter, hasHandData } from './arbiter.js';
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

/** @type {{ stop: (timeoutMs?: number) => Promise<void> } | null} */
let sdkProcess = null;
let shuttingDown = false;

/** Stops the spawned solver (if any) before exiting, so it never outlives the bridge. */
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  await sdkProcess?.stop();
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  // A second signal while waiting for the solver forces the exit (spawn-sdk still SIGTERMs it).
  process.on(sig, () => (shuttingDown ? process.exit(1) : void shutdown(0)));
}

const robot = createRobotOutput();
const wss = new WebSocketServer({ port: WS_PORT });
wss.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE'
    ? `[ws] port ${WS_PORT} already in use — is another bridge running? (set SENECAI_WS_PORT to use another port)`
    : `[ws] server error: ${err.message}`);
  void shutdown(1);
});
const counts = { studio: 0, sdk: 0 };
let lastActors = '';

// Only one source feeds the app at a time; see arbiter.js.
const arbiter = createArbiter({
  timeoutMs: 500,
  onSwitch: (to, from) => console.log(`[bridge] active source: ${to}${from ? ` (was ${from}, no hand data > 500 ms)` : ''}`),
});

function broadcast(source, frame, text) {
  if (!arbiter.offer(source, hasHandData(frame))) return;
  for (const client of wss.clients) if (client.readyState === 1) client.send(text);
}

// --- Rokoko Studio over UDP ---
if (!flag('no-studio')) {
  const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let lastError = '';
  const warn = (error) => {
    if (error !== lastError) console.warn(`[studio] ${error}`);
    lastError = error;
  };
  udp.on('message', (msg) => {
    // A bad datagram must never take the bridge down for every browser.
    try {
      const result = decodeDatagram(msg);
      if (!result.ok) return warn(result.error);
      lastError = '';
      counts.studio++;
      lastActors = result.frame.scene.actors.map((a) => `${a.name}${a.meta?.hasGloves ? ' (gloves)' : ''}`).join(', ');
      broadcast('studio', result.frame, result.text);
    } catch (e) {
      warn(`dropped datagram: ${e.message}`);
    }
  });
  udp.on('error', (err) => console.error(`[studio] UDP ${err.message}`));
  udp.bind(UDP_PORT);
}

// --- Rokoko Device SDK over TCP ---
// Only once the WebSocket port is ours, so a clashing second bridge doesn't start a solver.
if (flag('spawn-sdk')) wss.once('listening', () => (sdkProcess = spawnSdk()));
if (!flag('no-sdk')) {
  connectSdk({
    host: SDK_HOST,
    port: SDK_PORT,
    onFrame: (frame) => {
      counts.sdk++;
      broadcast('sdk', frame, JSON.stringify(frame));
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
  ws.on('error', (err) => console.warn(`[ws] browser socket error: ${err.message}`));
  ws.on('close', () => console.log('[ws] browser disconnected'));
});

setInterval(() => {
  // Received counts per source; only the active one is forwarded.
  const tag = (source) => (counts.studio && counts.sdk ? (arbiter.active === source ? ' [forwarding]' : ' [dropped]') : '');
  const parts = [];
  if (counts.sdk) parts.push(`SDK ${counts.sdk} frames${tag('sdk')}`);
  if (counts.studio) parts.push(`Studio ${counts.studio} frames (${lastActors})${tag('studio')}`);
  if (parts.length) console.log(`[bridge] last 5s: ${parts.join(', ')} -> ${wss.clients.size} browser(s)`);
  counts.studio = counts.sdk = 0;
}, 5000);

console.log(`Senecai bridge
  Rokoko Device SDK : ${flag('no-sdk') ? 'off' : `hand solver at tcp://${SDK_HOST}:${SDK_PORT}${flag('spawn-sdk') ? ' (starting rkk-hand-solver, which runs the glove driver)' : ''}`}
  Rokoko Studio     : ${flag('no-studio') ? 'off' : `udp://0.0.0.0:${UDP_PORT}`}
  browsers          : ws://localhost:${WS_PORT}
  (no gloves? "npm run fake-sdk" or "npm run fake-studio" in another terminal)`);
