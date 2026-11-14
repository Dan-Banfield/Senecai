// Procedurally generated example creations, so the community feels alive in the
// demo. Every seed carries a real, replayable recording, so "learn this" works
// on seeds too. Authors are fictional.

import { HAND_BASE } from '../crafts/kantele/session';
import { STRING_DOF } from '../crafts/kantele/music';
import type { RecEvent, RecFrame, Recording } from '../recording/recording';
import type { Creation } from './api';
import type { GeoPoint } from './places';

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

interface SeedMeta {
  id: string;
  title: string;
  author: string;
  description: string;
  createdAt: string;
  likes: number;
  location: GeoPoint;
  learnedFrom?: string;
}

const at = (place: string, lat: number, lng: number): GeoPoint => ({ place, lat, lng, country: place.split(', ')[1]?.replace('UK', 'United Kingdom') });

export function generateSeeds(): Creation[] {
  const k = (m: SeedMeta, rec: Recording): Creation => ({ ...m, learnedFrom: undefined, craft: 'kantele', recording: rec, seeded: true });

  const runo = [0, 1, 2, 2, 3, 2, 1, 1, 0, null];
  const runoB = [2, 3, 4, 4, 3, 2, 1, 1, 0, null];
  const metas: [SeedMeta, () => Creation][] = [];
  const add = (m: SeedMeta, make: (m: SeedMeta) => Creation) => metas.push([m, () => make(m)]);

  add({ id: 'seed-dawn', title: 'Päijänne at dawn', author: 'Aino K.', description: 'Slow rising arpeggios, like mist lifting off the lake. Good one for practising the ring finger.', createdAt: daysAgo(0, 3), likes: 41, location: at('Jyväskylä, Finland', 62.24, 25.75) }, (m) =>
    k(m, kanteleRecording(72, [0, 2, 4, 2, 1, 3, 4, 3, 0, 2, 4, 3, 2, 1, 0, null])),
  );
  add({ id: 'seed-runo', title: 'Runo for my grandmother', author: 'Väinö L.', description: 'A runo-style tune in five beats. She used to sing something like this while weaving.', createdAt: daysAgo(1, 2), likes: 87, location: at('Joensuu, Finland', 62.6, 29.76) }, (m) =>
    k(m, kanteleRecording(92, [...runo, ...runoB, ...runo])),
  );
  add({ id: 'seed-kyoto', title: 'First kantele, far from home', author: 'Hana S.', description: "Learned Väinö's runo through the ghost hand, then slowed it down. Five strings feel a little like a koto.", createdAt: daysAgo(0, 6), likes: 34, location: at('Kyoto, Japan', 35.01, 135.77), learnedFrom: 'seed-runo' }, (m) =>
    k(m, kanteleRecording(76, [...runo, ...runo])),
  );
  add({ id: 'seed-polka', title: 'Sauna polka', author: 'Eero M.', description: 'Bouncy two-finger chords. Try it fast!', createdAt: daysAgo(3, 1), likes: 54, location: at('Tampere, Finland', 61.5, 23.76) }, (m) =>
    k(m, kanteleRecording(132, [[0, 2], 4, [1, 3], 4, [0, 2], 4, [1, 3], 2, [0, 2], 4, [1, 3], 4, [2, 4], 3, [0, 2], null])),
  );
  add({ id: 'seed-kannel', title: 'Kannel echoes', author: 'Mari T.', description: "Tuned to the same five notes as my grandmother's kannel. The kantele and kannel are cousins, and the robot hand doesn't mind which.", createdAt: daysAgo(2, 1), likes: 38, location: at('Tallinn, Estonia', 59.44, 24.75) }, (m) =>
    k(m, kanteleRecording(84, [0, 1, 2, 1, 0, null, 2, 3, 4, 3, 2, null, 4, 3, 2, 1, 0, null])),
  );
  add({ id: 'seed-lisbon', title: 'Fado on five strings', author: 'Inês R.', description: "Started from Aino's dawn piece and let it drift towards fado. Saudade, but Finnish.", createdAt: daysAgo(3, 4), likes: 27, location: at('Lisbon, Portugal', 38.72, -9.14), learnedFrom: 'seed-dawn' }, (m) =>
    k(m, kanteleRecording(66, [4, 3, 2, 3, 1, null, 0, 2, 1, 0, null, 4, 2, 3, 1, 0, null])),
  );
  add({ id: 'seed-aurora', title: 'Revontulet loop', author: 'Saga N.', description: 'A looping pattern that shimmers like the northern lights. Hypnotic on the robot hand.', createdAt: daysAgo(6), likes: 72, location: at('Tromsø, Norway', 69.65, 18.96) }, (m) =>
    k(m, kanteleRecording(108, [4, 2, 3, 1, 2, 0, 1, 2, 4, 2, 3, 1, 2, 0, 1, 0])),
  );

  const made = metas.map(([, make]) => make());
  const byId = new Map(made.map((c) => [c.id, c]));
  metas.forEach(([m], i) => {
    const src = m.learnedFrom ? byId.get(m.learnedFrom) : undefined;
    if (src) made[i].learnedFrom = { id: src.id, title: src.title, author: src.author };
  });
  return made;
}
