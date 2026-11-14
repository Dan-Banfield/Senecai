// Prepares static assets so the app works offline (hackathon wifi...):
//  - MediaPipe's WASM runtime + hand model (falls back to Google's CDN at runtime)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'mediapipe');
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('@mediapipe/tasks-vision'));
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

mkdirSync(out, { recursive: true });
// The WASM must match the installed JS bundle, so re-copy it whenever the package
// version differs from the stamp written by the last copy (or the stamp is missing).
const wasmOut = join(out, 'wasm');
const stampPath = join(wasmOut, '.version');
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const stamped = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : null;
if (stamped !== version) {
  rmSync(wasmOut, { recursive: true, force: true });
  cpSync(join(pkgDir, 'wasm'), wasmOut, { recursive: true });
  writeFileSync(stampPath, `${version}\n`);
  console.log(`mediapipe: copied WASM runtime ${version}${stamped ? ` (was ${stamped})` : ''}`);
}

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
