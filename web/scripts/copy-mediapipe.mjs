// Copies MediaPipe's WASM runtime into public/ and downloads the hand model once,
// so the webcam emulator works offline (hackathon wifi...). If the download
// fails, the app falls back to Google's CDN at runtime.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'mediapipe');
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('@mediapipe/tasks-vision'));
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
