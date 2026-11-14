// Prepares static assets so the app works offline (hackathon wifi...):
//  - MediaPipe's WASM runtime + hand model (falls back to Google's CDN at runtime)
//  - Earth textures for the globe, copied from the three-globe package
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'mediapipe');
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('@mediapipe/tasks-vision'));
const globeImgDir = join(dirname(require.resolve('three-globe')), '..', 'example', 'img');
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

mkdirSync(out, { recursive: true });
if (!existsSync(join(out, 'wasm'))) cpSync(join(pkgDir, 'wasm'), join(out, 'wasm'), { recursive: true });

const modelPath = join(out, 'hand_landmarker.task');
if (!existsSync(modelPath)) {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
    console.log('mediapipe: downloaded hand model');
  } catch (e) {
    console.warn(`mediapipe: could not download hand model (${e.message}); will use CDN at runtime`);
  }
}

const globeOut = join(here, '..', 'public', 'globe');
mkdirSync(globeOut, { recursive: true });
for (const f of ['earth-night.jpg', 'earth-topology.png']) {
  if (!existsSync(join(globeOut, f))) cpSync(join(globeImgDir, f), join(globeOut, f));
}
