// Pretends to be Rokoko Studio: streams synthetic JSON v3 glove frames over UDP
// to the bridge, so the whole gloves path can be tested without hardware.
//
//   node src/fake-studio.js [--host 127.0.0.1] [--port 14043] [--lz4]
import dgram from 'node:dgram';
import lz4 from 'lz4js';
import { buildGloveFrame } from './synthetic-frame.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const host = opt('host', '127.0.0.1');
const port = Number(opt('port', 14043));
const useLz4 = args.includes('--lz4');

const sock = dgram.createSocket('udp4');
const start = Date.now();

setInterval(() => {
  const t = (Date.now() - start) / 1000;
  const json = JSON.stringify(buildGloveFrame(t));
  const payload = useLz4 ? Buffer.from(lz4.compress(Buffer.from(json))) : Buffer.from(json);
  sock.send(payload, port, host);
}, 1000 / 60);

console.log(`fake-studio: streaming JSON v3 glove frames to udp://${host}:${port} at 60 fps${useLz4 ? ' (LZ4 frame)' : ''}`);
