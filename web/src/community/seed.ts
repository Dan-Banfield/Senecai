// Procedurally generated example creations, so the community feels alive in the
// demo. Every seed carries a real, replayable recording, so "learn this" works
// on seeds too. Authors are fictional.

import * as THREE from 'three';
import { HAND_BASE } from '../crafts/kantele/session';
import { STRING_DOF } from '../crafts/kantele/music';
import { wristForTip } from '../crafts/kuksa/session';
import { analyseTarget, CELLS, cellToLocal, coords, DIM, encodeShape, makeTarget, type KuksaParams, DEFAULT_KUKSA } from '../crafts/kuksa/voxels';
import type { RecEvent, RecFrame, Recording } from '../recording/recording';
import type { Creation } from './api';

const daysAgo = (d: number, h = 0) => new Date(Date.now() - (d * 24 + h) * 3600_000).toISOString();
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function kanteleRecording(bpm: number, pattern: (number | number[] | null)[]): Recording {
  const beat = 60000 / bpm;
  const events: RecEvent[] = [];
  pattern.forEach((p, i) => {
    if (p === null) return;
    for (const s of Array.isArray(p) ? p : [p]) events.push({ t: Math.round(400 + i * beat), type: 'pluck', string: s, velocity: 0.7 + ((i * 7) % 3) * 0.1 });
  });
  const duration = 400 + pattern.length * beat + 600;
  const frames: RecFrame[] = [];
  for (let t = 0; t <= duration; t += 33) {
    const dof = [0.05, 0.12, 0.12, 0.12, 0.12, 0.12];
    for (const e of events) {
      if (e.type !== 'pluck') continue;
      // The finger starts curling ~180 ms before the pluck and relaxes after.
      const d = (t - e.t) / 180;
      if (d > -1 && d < 1.4) dof[STRING_DOF[e.string]] = Math.max(dof[STRING_DOF[e.string]], 0.12 + 0.6 * Math.cos((Math.min(d, 1) * Math.PI) / 2) ** 2);
    }
    const sway = Math.sin(t / 700) * 0.04;
    frames.push({ t, hands: [{ side: 'right', dof: dof.map(r3), p: [r3(HAND_BASE.x + sway), r3(HAND_BASE.y), r3(HAND_BASE.z)], q: [0, 0, 0, 1] }] });
  }
  return { version: 1, craft: 'kantele', source: 'seed', durationMs: Math.round(duration), frames, events };
}

function kuksaRecording(params: KuksaParams) {
  const target = makeTarget(params);
  const a = analyseTarget(target);
  const cx = 2 + params.rx;
  const cz = DIM.z / 2;
  // Order the waste like a carver would: outside first (top-down, around the
  // block), then the hollow from the rim inwards.
  const waste: { i: number; key: number }[] = [];
  for (let i = 0; i < CELLS; i++) {
    if (target.data[i]) continue;
    const [x, y, z] = coords(i);
    const ang = Math.atan2(z - cz, x - cx);
    const key = a.cavity[i] ? 1e6 + (DIM.y - y) * 1000 + Math.hypot(x - cx, z - cz) * 10 : (DIM.y - y) * 1000 + (ang + Math.PI) * 100;
    waste.push({ i, key });
  }
  waste.sort((p, q) => p.key - q.key);

  const CHUNK = 26;
  const STEP = 32;
  const events: RecEvent[] = [];
  const frames: RecFrame[] = [];
  let t = 500;
  let yaw = 0.35;
  for (let k = 0; k < waste.length; k += CHUNK) {
    const cells = waste.slice(k, k + CHUNK).map((w) => w.i);
    const c = new THREE.Vector3();
    for (const cell of cells) c.add(new THREE.Vector3(...cellToLocal(...coords(cell))));
    c.divideScalar(cells.length);
    // Turn the block so the area being carved faces the viewer.
    const isCavity = a.cavity[cells[0]];
    const want = isCavity ? yaw : -Math.atan2(c.x, c.z);
    let dy = want - yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    if (Math.abs(dy) > 0.05) {
      yaw += dy * 0.15;
      events.push({ t, type: 'yaw', value: r3(yaw) });
    }
    events.push({ t, type: 'cut', cells });
    const tip = c.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const w = wristForTip(tip, 'right');
    frames.push({ t, hands: [{ side: 'right', dof: [0.5, 0.5, 0.85, 0.85, 0.85, 0.85], p: w.position.toArray().map(r3), q: w.rotation.toArray().map(r3) }] });
    t += STEP;
  }
  const recording: Recording = { version: 1, craft: 'kuksa', source: 'seed', durationMs: t + 300, frames, events };
  return { recording, shape: encodeShape(target) };
}

export function generateSeeds(): Creation[] {
  const k = (id: string, title: string, author: string, description: string, created: string, likes: number, rec: Recording): Creation => ({
    id,
    craft: 'kantele',
    title,
    author,
    description,
    createdAt: created,
    likes,
    recording: rec,
    seeded: true,
  });
  const v = (id: string, title: string, author: string, description: string, created: string, likes: number, params: KuksaParams, score: number): Creation => ({
    id,
    craft: 'kuksa',
    title,
    author,
    description,
    createdAt: created,
    likes,
    score,
    seeded: true,
    ...kuksaRecording(params),
  });

  return [
    k('seed-dawn', 'Päijänne at dawn', 'Aino K.', 'Slow rising arpeggios, like mist lifting off the lake. Good one for practising the ring finger.', daysAgo(0, 3), 41, kanteleRecording(72, [0, 2, 4, 2, 1, 3, 4, 3, 0, 2, 4, 3, 2, 1, 0, null])),
    v('seed-classic', 'Classic kuksa with finger hole', 'Juhani R.', 'The shape my grandfather carved: deep bowl and a short handle with a hole for two fingers. Hollow it in light passes!', daysAgo(0, 9), 63, DEFAULT_KUKSA, 96),
    k('seed-runo', 'Runo for my grandmother', 'Väinö L.', 'A runo-style tune in five beats. She used to sing something like this while weaving.', daysAgo(1, 2), 87, kanteleRecording(92, [0, 1, 2, 2, 3, 2, 1, 1, 0, null, 2, 3, 4, 4, 3, 2, 1, 1, 0, null, 0, 1, 2, 2, 3, 2, 1, 1, 0, null])),
    v('seed-coffee', 'Deep coffee kuksa', 'Inkeri S.', 'Extra-deep bowl for campfire coffee, with a plain tab handle. The hollowing takes patience.', daysAgo(2, 5), 29, { ...DEFAULT_KUKSA, rx: 9, rz: 9, depth: 17, handleLen: 7, hole: false }, 91),
    k('seed-polka', 'Sauna polka', 'Eero M.', 'Bouncy two-finger chords. Try it fast!', daysAgo(3, 1), 54, kanteleRecording(132, [[0, 2], 4, [1, 3], 4, [0, 2], 4, [1, 3], 2, [0, 2], 4, [1, 3], 4, [2, 4], 3, [0, 2], null])),
    v('seed-berry', 'Wide berry-picking cup', 'Lassi P.', 'A shallow, wide cup for bilberries. Easier to hollow, harder to keep the wall even.', daysAgo(4, 7), 18, { ...DEFAULT_KUKSA, rx: 12, rz: 11, depth: 12, handleLen: 6 }, 88),
    k('seed-aurora', 'Revontulet loop', 'Saga N.', 'A looping pattern that shimmers like the northern lights. Hypnotic on the robot hand.', daysAgo(6), 72, kanteleRecording(108, [4, 2, 3, 1, 2, 0, 1, 2, 4, 2, 3, 1, 2, 0, 1, 0])),
  ];
}
