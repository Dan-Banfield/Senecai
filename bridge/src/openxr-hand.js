// Solved hands from the Rokoko Device SDK -> Rokoko Studio JSON v3 joints.
//
// `rkk-hand-solver --emit-openxr` publishes, per glove, a "joints_openxr" group:
// 26 TRANSFORM streams (FLOAT[7]: x, y, z, qx, qy, qz, qw) named "xr_<joint>",
// relative to "xr_base": right-handed, Y-up, wrist at the origin. Joint
// orientations follow OpenXR (-Z along the bone towards the fingertip, +Y on the
// back of the hand). See https://sdk.rokoko.com/guides/hand-solving/.
//
// We turn those into the Studio-style joints the web app already understands
// (leftHand, leftIndexProximal, ...). The app only uses *relative* rotations
// between joints plus a few positions, so the exact bone-axis convention doesn't
// matter. Handedness does, so we mirror Z into Studio's left-handed Y-up space.

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'little'];

/** OpenXR XrHandJointEXT order. Used if the definition's names are unrecognised. */
export const OPENXR_JOINTS = [
  'palm',
  'wrist',
  'thumb_metacarpal',
  'thumb_proximal',
  'thumb_distal',
  'thumb_tip',
  ...['index', 'middle', 'ring', 'little'].flatMap((f) => ['metacarpal', 'proximal', 'intermediate', 'distal', 'tip'].map((p) => `${f}_${p}`)),
];

/** Studio phalanx <- OpenXR joint, per finger. The thumb has no intermediate joint in OpenXR. */
const STUDIO_FROM_OPENXR = {
  thumb: ['thumb_metacarpal', 'thumb_proximal', 'thumb_distal', 'thumb_tip'],
  index: ['index_proximal', 'index_intermediate', 'index_distal', 'index_tip'],
  middle: ['middle_proximal', 'middle_intermediate', 'middle_distal', 'middle_tip'],
  ring: ['ring_proximal', 'ring_intermediate', 'ring_distal', 'ring_tip'],
  little: ['little_proximal', 'little_intermediate', 'little_distal', 'little_tip'],
};
const STUDIO_PHALANGES = ['Proximal', 'Medial', 'Distal', 'Tip'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** "xr_index_proximal", "XR_HAND_JOINT_INDEX_PROXIMAL_EXT", "pinky_tip" -> "index_proximal" / "little_tip". */
export function normaliseJointName(frame) {
  return String(frame)
    .toLowerCase()
    .replace(/^xr_/, '')
    .replace(/^hand_joint_/, '')
    .replace(/_ext$/, '')
    .replace(/^pinky/, 'little');
}

/**
 * Extracts joint poses from a decoded RGMP data frame of the joints_openxr group.
 * Returns Map<name, { p: [x,y,z], q: [x,y,z,w] }>.
 */
export function jointsFromRgmp(decoded) {
  const joints = new Map();
  const transforms = decoded.group.streams
    .map((s, i) => ({ s, v: decoded.values[i] }))
    .filter(({ s, v }) => s.measure_type === 'TRANSFORM' && v.length >= 7);
  const named = transforms.map(({ s }) => normaliseJointName(s.target_frame ?? ''));
  const recognised = named.filter((n) => OPENXR_JOINTS.includes(n)).length;
  const useOrder = recognised < 20 && transforms.length === OPENXR_JOINTS.length;
  transforms.forEach(({ v }, i) => {
    const name = useOrder ? OPENXR_JOINTS[i] : named[i];
    joints.set(name, { p: [v[0], v[1], v[2]], q: [v[3], v[4], v[5], v[6]] });
  });
  return joints;
}

const r5 = (v) => Math.round(v * 1e5) / 1e5;

/**
 * Writes Studio-style joints for one hand into `body`.
 * Positions are wrist-relative in the SDK, so we place the wrist at `base`
 * (a plausible spot in front of the actor) and keep the joint offsets.
 */
export function addStudioHand(side, joints, body, base = { x: side === 'right' ? 0.15 : -0.15, y: 1.2, z: 0.3 }) {
  const wrist = joints.get('wrist');
  if (!wrist) return false;
  // xr_base (right-handed) -> Studio (left-handed): mirror Z. Rotation quaternions mirror as (-x, -y, z, w).
  const pos = (p) => ({ x: r5(base.x + p[0] - wrist.p[0]), y: r5(base.y + p[1] - wrist.p[1]), z: r5(base.z - (p[2] - wrist.p[2])) });
  const rot = (q) => ({ x: r5(-q[0]), y: r5(-q[1]), z: r5(q[2]), w: r5(q[3]) });
  body[`${side}Hand`] = { position: pos(wrist.p), rotation: rot(wrist.q) };
  for (const finger of FINGERS) {
    STUDIO_FROM_OPENXR[finger].forEach((name, i) => {
      const j = joints.get(name);
      if (j) body[`${side}${cap(finger)}${STUDIO_PHALANGES[i]}`] = { position: pos(j.p), rotation: rot(j.q) };
    });
  }
  return true;
}

/** Builds a Studio JSON v3 frame from solved hands. */
export function buildStudioFrame(hands, timestamp) {
  const body = {};
  const has = { left: false, right: false };
  for (const side of ['left', 'right']) if (hands[side]) has[side] = addStudioHand(side, hands[side], body);
  return {
    version: 3,
    fps: 60,
    scene: {
      timestamp,
      actors: [
        {
          name: 'Rokoko Device SDK',
          color: [200, 121, 65],
          meta: { hasGloves: has.left || has.right, hasLeftGlove: has.left, hasRightGlove: has.right, hasBody: false, hasFace: false },
          dimensions: { totalHeight: 1.8, hipHeight: 0.95 },
          // Not part of Studio's format: tells the app that hand positions are
          // wrist-relative (no Coil Pro), so it should aim from wrist orientation instead.
          senecai: { positions: 'wrist-relative' },
          body,
        },
      ],
      props: [],
    },
  };
}

// --- Synthetic OpenXR hands (for the fake SDK server and tests) ---------------

function qAxisAngle(ax, ay, az, a) {
  const s = Math.sin(a / 2);
  return [ax * s, ay * s, az * s, Math.cos(a / 2)];
}
export function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qRotate(q, v) {
  const p = qMul(qMul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [p[0], p[1], p[2]];
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/**
 * A hand in xr_base: palm down, fingers forward (-Z), wrist at the origin.
 * curl[0] = thumb bend, curl[1..4] = index..little, all 0..1. Returns 26 joints in OpenXR order.
 */
export function synthOpenXrHand(side, curl, thumbRotate = 0, wristQ = [0, 0, 0, 1]) {
  const sgn = side === 'right' ? 1 : -1;
  const out = new Map();
  const put = (name, p, q) => out.set(name, { p: qRotate(wristQ, p), q: qMul(wristQ, q) });
  put('wrist', [0, 0, 0], [0, 0, 0, 1]);
  put('palm', [0, -0.01, -0.05], [0, 0, 0, 1]);

  // Thumb: splayed out to the side, swings under the palm with opposition, then bends.
  let q = qMul(qAxisAngle(0, 0, 1, sgn * thumbRotate * 1.0), qAxisAngle(0, 1, 0, sgn * 0.8));
  let p = [sgn * -0.02, -0.01, -0.02];
  const thumbLen = [0.04, 0.032, 0.025];
  const thumbFlex = [0, 0.9, 1.2];
  ['thumb_metacarpal', 'thumb_proximal', 'thumb_distal', 'thumb_tip'].forEach((name, i) => {
    if (i < 3) q = qMul(q, qAxisAngle(1, 0, 0, -thumbFlex[i] * curl[0]));
    put(name, p, q);
    if (i < 3) p = add(p, qRotate(q, [0, 0, -thumbLen[i]]));
  });

  ['index', 'middle', 'ring', 'little'].forEach((finger, fi) => {
    const x = sgn * (-0.03 + fi * 0.02);
    const c = curl[fi + 1];
    put(`${finger}_metacarpal`, [x, 0, -0.02], [0, 0, 0, 1]);
    let fq = [0, 0, 0, 1];
    let fp = [x, 0, -0.09];
    const len = [0.045, 0.028, 0.022];
    const flex = [1.4, 1.65, 1.05];
    ['proximal', 'intermediate', 'distal', 'tip'].forEach((ph, i) => {
      if (i < 3) fq = qMul(fq, qAxisAngle(1, 0, 0, -flex[i] * c));
      put(`${finger}_${ph}`, fp, fq);
      if (i < 3) fp = add(fp, qRotate(fq, [0, 0, -len[i]]));
    });
  });
  return OPENXR_JOINTS.map((name) => ({ name, ...out.get(name) }));
}
