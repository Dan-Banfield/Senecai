// Puukko: the Finnish belt knife. Heat the bar in the forge, hammer out the
// blade on the anvil (flat blows draw it out, edge blows shape the point),
// quench it to harden, sharpen it on the whetstone, carve a birch handle and
// fit the blade into it.

import { r3, type Bench, type CraftBench, type InteractCtx } from '../core';
import { ForgeBar, TANG, WORKING_HEAT } from '../materials/forge';
import { makeMask, VoxelBlock } from '../materials/voxel';
import { every, FRONT, heat, onWp, resetHeat, shave, tool, warnOvercut } from './kit';

/** The birch handle blank, in voxels, and the voxel size. */
const H = { nx: 48, ny: 17, nz: 17 };
const HS = 0.045;
const blade = (b: Bench) => b.wp<ForgeBar>('blade');
const handle = (b: Bench) => b.wp<VoxelBlock>('handle');
const EDGE = Math.PI / 2;
/** Smallest handle turn (radians) worth an op while turning. */
const YAW_STEP = 0.01;

function handleTarget() {
  return makeMask(H, (x, y, z) => {
    const v = (x + 0.5) / H.nx;
    // Fuller in the middle of the grip, a slight swell at the butt.
    const prof = 0.74 + 0.2 * Math.sin(Math.PI * v) + (v < 0.12 ? 0.1 * (1 - v / 0.12) : 0);
    // Oval, taller than it is wide, so the knife sits the right way up in the hand.
    // The blank leaves a couple of voxels of waste even where the handle is fullest.
    const ry = 6.6 * prof;
    const rz = 5.6 * prof;
    return ((y + 0.5 - H.ny / 2) / ry) ** 2 + ((z + 0.5 - H.nz / 2) / rz) ** 2 <= 1 ? 1 : 0;
  });
}

function toggleEdge(ctx: InteractCtx) {
  const on = Math.abs((ctx.b.state.roll.blade ?? 0) - EDGE) < 0.1;
  ctx.emit({ w: '$', k: 'roll', wp: 'blade', v: on ? 0 : EDGE });
  ctx.say(on ? 'Bar flat: blows thin and spread the blade.' : 'Bar on edge: blows narrow it and shape the point.', 'info');
}

export const puukkoBench: CraftBench = {
  id: 'puukko',
  title: 'Puukko',
  subtitle: 'the Finnish belt knife · puukko',
  intro: 'Forge, harden and sharpen a blade, then carve a birch handle for it, the way Kauhava smiths have for over a century.',
  views: {
    main: { pos: [0, 9.4, 10.8], look: [0, 0.5, 0.5] },
    // Close in on the hands while the birch is held: small hand movements, fine cuts.
    hands: { pos: [3.3, 5.9, 5.1], look: [3.05, 1.75, 1.35] },
  },
  tools: [
    tool({ id: 'tongs', name: 'Tongs', model: 'tongs', home: [-2.2, 0.05, FRONT], len: 1.45, pitch: 0.55, carries: ['blade'], use: 'Squeeze on the bar to pick it up; squeeze over the forge, anvil or bucket to set it down.' }),
    tool({ id: 'hammer', name: 'Hammer', model: 'hammer', home: [1.4, 0.05, FRONT + 0.1], len: 0.95, pitch: 0.15, lift: 0.75, use: 'Squeeze to strike the hot bar. Twist your other hand (or press R) to turn the bar on its edge.' }),
    tool({ id: 'stone', name: 'Whetstone', model: 'whetstone', home: [2.7, 0.05, FRONT + 0.1], len: 0.45, pitch: 0.2, lift: 0.2, use: 'Squeeze and stroke along the blade to grind the edge.' }),
    tool({ id: 'knife', name: 'Carving knife', model: 'knife', home: [4.5, 0.05, 2.05], len: 1.0, pitch: 0.55, use: 'Squeeze and draw the blade across the birch: a light grip skims, a full fist bites deep.' }),
  ],
  stations: [
    { id: 'forge', name: 'Forge', model: 'forge', pos: [-4.4, 0, -1.4], radius: 1.1, rest: 0.98, hint: 'set the bar in the coals to heat it' },
    { id: 'anvil', name: 'Anvil', model: 'anvil', pos: [0, 0, -0.2], radius: 1.3, rest: 1.12 },
    { id: 'bucket', name: 'Quench bucket', model: 'bucket', pos: [-4.4, 0, 1.5], radius: 0.75, rest: 0.55, hint: 'plunge the glowing blade here to harden it' },
    { id: 'vise', name: 'Carving block', model: 'block', pos: [3.7, 0, -1.2], radius: 1.4, rest: 0.45 },
  ],
  workpieces: () => {
    const h = new VoxelBlock('handle', {
      ...H,
      size: HS,
      wood: '#ead3a4',
      bark: '#cfb07e',
      target: handleTarget(),
      // Split from a log, so the pith is off below the blank and the rings run along it in arcs.
      grain: { axis: [1, 0, 0], centre: [0, -0.9, 0.35], freq: 15, swirl: 0.25, contrast: 0.2 },
    });
    return [new ForgeBar('blade'), h];
  },
  start: { place: { blade: 'anvil', handle: 'vise' }, yaw: { blade: 0, handle: -0.3 } },
  hold: { handle: { grip: [-(H.nx * HS) / 2 + 0.32, (H.ny * HS) / 2, 0], at: [2.3, 1.9, 1.5], home: 'vise', view: 'hands' } },
  // While the bar is on the anvil the off hand's fist turns it; the birch waits.
  canHold: (b) => !(b.placedAt('blade') === 'anvil' && b.state.stage <= 3),
  turnTarget: (b) => (b.placedAt('blade') === 'anvil' && b.state.stage <= 3 ? 'blade' : 'handle'),
  turn(ctx, delta) {
    const b = ctx.b;
    if (b.placedAt('blade') === 'anvil' && b.state.stage <= 3) {
      // Twisting the off hand flips the bar between flat and on edge.
      const acc = ((ctx.mem.twist as number) ?? 0) + delta;
      ctx.mem.twist = Math.abs(acc) > 0.45 ? 0 : acc;
      if (Math.abs(acc) > 0.45) toggleEdge(ctx);
      return;
    }
    // The yaw only ever changes through the op, so live and replay agree frame by frame.
    // Small turns build up in `acc` until they are worth an op; a turn of 0 (sent when
    // turning stops) flushes whatever is left, so the recording ends on the exact angle.
    const cur = b.state.yaw.handle ?? 0;
    let m = ctx.mem.yawHandle as { sent: number; acc: number } | undefined;
    // Re-sync if something else set the yaw since (swap ends, a restart).
    if (!m || m.sent !== cur) ctx.mem.yawHandle = m = { sent: cur, acc: cur };
    m.acc += delta;
    const v = r3(m.acc);
    if (v !== cur && (delta === 0 || Math.abs(v - cur) > YAW_STEP)) {
      m.sent = v;
      ctx.emit({ w: '$', k: 'yaw', wp: 'handle', v });
    }
  },
  onKey(ctx, key) {
    if (key === 'r' && ctx.b.placedAt('blade')) toggleEdge(ctx);
  },
  stages: [
    {
      id: 'heat',
      title: 'Heat the bar',
      text: 'Pick up the tongs, squeeze on the steel bar to grab it, and set it in the forge (squeeze over the coals). Wait until it glows yellow.',
      tools: ['tongs'],
      stations: ['forge'],
      progress: (b) => blade(b).temp / 0.85,
    },
    {
      id: 'forge',
      title: 'Forge the blade',
      text: 'Bring the hot bar back to the anvil, swap to the hammer and strike along it: flat blows draw the blade out and thin it. Turn it on edge (other hand twist, or R) to shape the point. Reheat when the glow fades.',
      tools: ['hammer', 'tongs'],
      stations: ['anvil', 'forge'],
      progress: (b) => blade(b).shapeMatch().overall / 0.72,
    },
    {
      id: 'quench',
      title: 'Harden it',
      text: 'Heat the blade until it glows again, then carry it with the tongs and plunge it into the bucket.',
      tools: ['tongs'],
      stations: ['forge', 'bucket'],
      progress: (b) => (blade(b).hardened ? 1 : Math.min(0.9, blade(b).temp / 0.6)),
    },
    {
      id: 'sharpen',
      title: 'Sharpen the edge',
      text: 'Lay the blade on the anvil, take the whetstone and stroke it along the edge, tip to heel.',
      tools: ['stone'],
      progress: (b) => blade(b).sharpness() / 0.6,
    },
    {
      id: 'handle',
      title: 'Carve the handle',
      text: 'Pick up the carving knife. Then make a fist with your other hand (Z on a keyboard) to pick up the birch blank and hold it. Squeeze and draw the blade across the wood to take shavings: a light grip skims, a full fist bites deep. Knock the corners off first, then round it to the outline, turning it in your hand (or Q / E). V swaps ends.',
      tools: ['knife'],
      stations: ['vise'],
      progress: (b) => handle(b).carveProgress().waste / 0.6,
    },
    {
      id: 'fit',
      title: 'Fit the blade',
      text: 'Pick up the blade with the tongs and squeeze over the handle to drive the tang home.',
      tools: ['tongs'],
      stations: ['vise'],
      progress: (b) => (b.state.attached.blade ? 1 : 0),
    },
  ],
  attachPose(b) {
    const bar = blade(b);
    let tang = 0;
    for (let i = 0; i < TANG; i++) tang += bar.len[i];
    // Handle frame: long axis X, bottom centre at origin. The blade's frame is at
    // the middle of the bar; push the tang into the handle's front end, edge down.
    return { pos: [H.nx * HS * 0.5 - tang * 0.95 + bar.length / 2, H.ny * HS * 0.5, 0], roll: -EDGE };
  },
  interact(ctx) {
    const b = ctx.b;
    const bar = blade(b);
    const id = ctx.tool?.id;
    if (id === 'hammer' && ctx.pressed) {
      const h = onWp(ctx, 'blade');
      if (!h) return;
      if (b.placedAt('blade') !== 'anvil') return ctx.say('Lay the bar on the anvil to forge it.', 'warn');
      if (bar.temp < WORKING_HEAT * 0.8) return ctx.say('The steel is too cold to move. Reheat it in the forge.', 'warn');
      const u = Math.max(0, Math.min(1, h.local.x / bar.length));
      const edge = Math.abs((b.state.roll.blade ?? 0) - EDGE) < 0.1;
      ctx.emit({ w: 'blade', k: 'strike', u: Math.round(u * 1000) / 1000, s: Math.round((0.75 + 0.25 * ctx.grip) * 100) / 100, e: edge });
    } else if (id === 'stone' && ctx.squeeze) {
      const h = onWp(ctx, 'blade');
      if (!h) return;
      if (b.placedAt('blade') !== 'anvil') return ctx.say('Lay the blade on the anvil to sharpen it.', 'warn');
      if (bar.temp > 0.3) return ctx.say('Let it cool before sharpening.', 'warn');
      const u = h.local.x / bar.length;
      const last = (ctx.mem.grindU as number | undefined) ?? -1;
      if (Math.abs(u - last) > 0.025 && every(ctx, 'grind', 14)) {
        ctx.mem.grindU = u;
        ctx.emit({ w: 'blade', k: 'grind', u: Math.round(u * 1000) / 1000, s: bar.hardened ? 0.5 : 0.35 });
      }
    } else if (id === 'knife') {
      warnOvercut(ctx, handle(b), shave(ctx, handle(b), { r: 2.6, light: 0.3, deep: 1.7 }), 'Careful, that cut into the handle shape. Lighten your grip near the line.');
    } else if (id === 'tongs' && ctx.pressed && b.carriedBy(ctx.side) === 'blade' && (ctx.aim.station === 'vise' || onWp(ctx, 'handle'))) {
      if (handle(b).carveProgress().waste < 0.3) return ctx.say('Carve the handle first.', 'warn');
      if (bar.temp > 0.3) return ctx.say('Let the blade cool first.', 'warn');
      ctx.emit({ w: '$', k: 'attach', wp: 'blade', to: 'handle' });
      ctx.say('The tang is home. A puukko!', 'good');
    }
  },
  simulate(ctx) {
    const b = ctx.b;
    const bar = blade(b);
    const at = b.state.place.blade;
    if (at === 'bucket') {
      if (bar.temp > 0.05) {
        const ok = bar.temp > 0.55;
        ctx.emit({ w: 'blade', k: 'quench', ok });
        resetHeat(ctx, 'blade', 0);
        ctx.say(ok ? 'Hiss! The blade is hardened.' : 'Too cold to harden. Reheat it to a glow and try again.', ok ? 'good' : 'warn');
      }
      return;
    }
    const rate = at === 'forge' ? 0.22 : at === 'anvil' ? -0.03 : at === 'attached' ? -0.1 : -0.02;
    if ((rate > 0 && bar.temp < 1) || (rate < 0 && bar.temp > 0)) heat(ctx, 'blade', bar.temp, rate);
  },
  describe(b, aim) {
    if (aim.hit.type === 'workpiece' && aim.hit.id === 'blade') {
      const t = blade(b).temp;
      const glow = t > 0.85 ? 'yellow heat' : t > 0.6 ? 'orange heat' : t > WORKING_HEAT ? 'cherry red, still workable' : t > 0.2 ? 'too cold to forge' : 'cold steel';
      return `Steel bar: ${glow}`;
    }
    return null;
  },
  meters(b) {
    const bar = blade(b);
    const s = bar.shapeMatch();
    return [
      { label: 'Heat', value: bar.temp, warn: bar.temp < WORKING_HEAT && b.state.stage === 1 },
      { label: 'Shape', value: s.overall },
      { label: 'Hardened', value: bar.hardened ? 1 : 0 },
      { label: 'Edge', value: bar.sharpness() },
      { label: 'Handle', value: handle(b).carveProgress().waste },
    ];
  },
  score(b) {
    const bar = blade(b);
    const h = handle(b).carveProgress();
    return bar.shapeMatch().overall * 0.35 + (bar.hardened ? 0.15 : 0) + Math.min(1, bar.sharpness() / 0.6) * 0.15 + Math.max(0, h.waste - h.lost * 3) * 0.2 + (b.state.attached.blade ? 0.15 : 0);
  },
};

