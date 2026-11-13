// Builds a plausible Rokoko Studio JSON v3 frame for one actor wearing both
// gloves, with fingers doing a "piano roll" wave. Mirrors the field names used
// by Rokoko's official Unity/Blender plugins.

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const PHALANGES = ['Proximal', 'Medial', 'Distal', 'Tip'];

function qAxisAngle(ax, ay, az, angle) {
  const s = Math.sin(angle / 2);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(angle / 2) };
}
function qMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
function qRotate(q, v) {
  const p = qMul(qMul(q, { ...v, w: 0 }), { x: -q.x, y: -q.y, z: -q.z, w: q.w });
  return { x: p.x, y: p.y, z: p.z };
}
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 1e5) / 1e5]));

function hand(side, t, body) {
  const sgn = side === 'right' ? 1 : -1;
  const wristPos = { x: sgn * 0.2 + 0.05 * Math.sin(t), y: 1.2 + 0.03 * Math.sin(t * 1.3), z: 0.3 };
  const wristRot = qAxisAngle(0, 0, 1, 0.15 * Math.sin(t * 0.7));
  body[`${side}Hand`] = { position: round(wristPos), rotation: round(wristRot) };

  FINGERS.forEach((finger, fi) => {
    const curl = 0.5 + 0.5 * Math.sin(t * 3 - fi * 0.8 + (side === 'left' ? Math.PI : 0));
    const isThumb = fi === 0;
    const base = isThumb ? { x: sgn * -0.025, y: 0.02, z: 0.01 } : { x: sgn * (-0.03 + (fi - 1) * 0.02), y: 0.09, z: 0 };
    let rot = isThumb ? qMul(wristRot, qAxisAngle(0, 0, 1, sgn * 0.8)) : wristRot;
    let pos = add(wristPos, qRotate(wristRot, base));
    const lengths = isThumb ? [0.04, 0.032, 0.025] : [0.045, 0.028, 0.022];
    const flex = isThumb ? [0, 0.9, 1.2] : [1.4, 1.65, 1.05];
    PHALANGES.forEach((ph, pi) => {
      if (pi < 3) rot = qMul(rot, qAxisAngle(1, 0, 0, flex[pi] * curl));
      body[`${side}${finger}${ph}`] = { position: round(pos), rotation: round(rot) };
      if (pi < 3) pos = add(pos, qRotate(rot, { x: 0, y: lengths[pi], z: 0 }));
    });
  });
}

export function buildGloveFrame(t) {
  const body = {};
  hand('left', t, body);
  hand('right', t, body);
  return {
    version: 3,
    fps: 60,
    scene: {
      timestamp: t,
      actors: [
        {
          name: 'FakeStudio',
          color: [200, 121, 65],
          meta: { hasGloves: true, hasLeftGlove: true, hasRightGlove: true, hasBody: false, hasFace: false },
          dimensions: { totalHeight: 1.8, hipHeight: 0.95 },
          body,
        },
      ],
      props: [],
    },
  };
}
