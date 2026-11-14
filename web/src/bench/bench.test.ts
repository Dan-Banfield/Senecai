import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RobotHandCommand } from '../robot/retarget';
import type { Side } from '../rokoko/types';
import { Bench, biteOf, r3, type InteractCtx, type Op } from './core';
import { BENCH_IDS, benchFor } from './crafts';
import { shave } from './crafts/kit';
import { ForgeBar } from './materials/forge';
import { surfaceNets } from './materials/mesh';
import { VoxelBlock, type VC } from './materials/voxel';
import { BenchPlayer, type BenchRecording } from './recording';
import { BenchSession, useBenchUi } from './session';

// The session reads hands from the input pipeline and keys from window; stand both in.
const input = vi.hoisted(() => {
  (globalThis as { window?: EventTarget }).window ??= new EventTarget();
  return { dominant: 'right' as 'left' | 'right', commands: {} as Partial<Record<'left' | 'right', unknown>> };
});
vi.mock('../input/pipeline', () => {
  const primarySide = () => (input.commands[input.dominant] ? input.dominant : input.dominant === 'right' ? 'left' : 'right');
  return {
    usePipeline: { getState: () => ({ kind: 'test' }) },
    primaryCommand: () => input.commands[primarySide()],
    secondaryCommand: () => input.commands[primarySide() === 'right' ? 'left' : 'right'],
  };
});

const rec = (craft: BenchRecording['craft'], opsPerFrame: Op[][]): BenchRecording => ({
  version: 2,
  craft,
  source: 'test',
  durationMs: opsPerFrame.length * 100,
  frames: opsPerFrame.map((ops, i) => ({ t: i * 100, hands: [], ops })),
});

const block = () => new VoxelBlock('w', { nx: 24, ny: 12, nz: 12, size: 0.05, wood: '#fff' });

/** Height of the top surface at column (x, z), found by a ray straight down. */
function topAt(b: VoxelBlock, x: number, z: number) {
  const t = b.rayEntry([x, b.spec.ny + 4, z], [0, -1, 0], 0, b.spec.ny + 8);
  return t === null ? null : b.spec.ny + 4 - t;
}

/** Just enough of an interaction context to drive the knife from a test. */
function knifeCtx(b: Bench, grip: number) {
  const ctx = {
    b,
    squeeze: true,
    grip,
    mem: {},
    aim: { hit: { type: 'table' } },
    emit: (op: Op) => b.apply(op),
    say: () => {},
  };
  return ctx as unknown as InteractCtx & { aim: { hit: unknown } };
}

describe('the puukko bench', () => {
  it.each(BENCH_IDS)('%s starts on stage 1 with nothing done', (id) => {
    const b = new Bench(benchFor(id));
    expect(b.def.stages.length).toBeGreaterThan(1);
    // A stage already complete at the start would be skipped instantly.
    expect(b.def.stages[0].progress(b)).toBeLessThan(1);
    expect(b.def.score(b)).toBeLessThan(0.5);
    for (const wp of b.workpieces.keys()) expect(b.state.place[wp]).toBeTruthy();
  });

  it.each(BENCH_IDS)('%s tools rest on the table and stations exist for placements', (id) => {
    const def = benchFor(id);
    for (const t of def.tools) expect(t.len).toBeGreaterThan(0);
    for (const at of Object.values(def.start.place)) expect(def.stations.some((s) => s.id === at)).toBe(true);
    for (const h of Object.values(def.hold ?? {})) expect(def.stations.some((s) => s.id === h.home)).toBe(true);
  });

  it('the handle can be picked up into the off hand and set back down', () => {
    const b = new Bench(benchFor('puukko'));
    b.apply({ w: '$', k: 'place', wp: 'handle', at: 'held:left' });
    expect(b.heldBy('left')).toBe('handle');
    expect(b.isHeld('handle')).toBe(true);
    expect(b.placedAt('handle')).toBeNull();
    b.apply({ w: '$', k: 'place', wp: 'handle', at: 'vise' });
    expect(b.heldBy('left')).toBeNull();
    expect(b.placedAt('handle')).toBe('vise');
  });
});

describe('replay', () => {
  it('rebuilds the same handle frame by frame, and seeking matches playing through', () => {
    const def = benchFor('puukko');
    const live = new Bench(def);
    const handle = live.wp<VoxelBlock>('handle');
    const { nx, ny, nz } = handle.spec;
    const frames: Op[][] = [];
    for (let k = 0; k < 40; k++) {
      const x = 4 + (k / 40) * (nx - 8);
      const ops: Op[] = [{ w: 'handle', k: 'shave', a: [x, ny + 1.4, nz / 2], b: [x + 1.2, ny + 1.2, nz / 2 + 0.6], r: 2.6 }];
      if (k === 2) ops.push({ w: '$', k: 'place', wp: 'handle', at: 'held:left' });
      if (k % 5 === 0) ops.push({ w: '$', k: 'roll', wp: 'handle', v: k * 0.1 });
      if (k % 9 === 0) ops.push({ w: 'handle', k: 'carve', cells: handle.carveCells(handle.cellCenter(handle.idx(Math.floor(x), 0, 0)), 1.5) });
      ops.forEach((o) => live.apply(o));
      frames.push(ops);
    }
    const r = rec('puukko', frames);

    const replay = new Bench(def);
    const player = new BenchPlayer(r, replay, 500);
    player.advance(r.durationMs);
    expect(replay.wp<VoxelBlock>('handle').dens).toEqual(handle.dens);
    expect(replay.wp<VoxelBlock>('handle').solid).toEqual(handle.solid);
    expect(replay.state.roll.handle).toBe(live.state.roll.handle);
    expect(replay.state.place.handle).toBe('held:left');

    // Seek back to the middle, then compare with a fresh bench played to the same time.
    player.seek(2250);
    const ref = new Bench(def);
    new BenchPlayer(r, ref, 1e9).advance(2250);
    expect(replay.wp<VoxelBlock>('handle').dens).toEqual(ref.wp<VoxelBlock>('handle').dens);
    expect(replay.wp<VoxelBlock>('handle').solid).toEqual(ref.wp<VoxelBlock>('handle').solid);
  });

  it('snapshots restore independent copies', () => {
    const b = new Bench(benchFor('puukko'));
    const snap = b.snapshot();
    b.apply({ w: 'blade', k: 'temp', v: 1 });
    b.apply({ w: 'blade', k: 'strike', u: 0.6, s: 1, e: false });
    b.apply({ w: 'handle', k: 'shave', a: [10, 18, 8], b: [20, 18, 8], r: 2.6 });
    b.restore(snap);
    expect(b.wp<ForgeBar>('blade').temp).toBe(0);
    expect(b.wp<ForgeBar>('blade').strikes).toBe(0);
    expect(b.wp<VoxelBlock>('handle').dens.every((d) => d === 1)).toBe(true);
  });
});

describe('forging', () => {
  it('hot steel thins and lengthens under the hammer; cold steel does not move', () => {
    const bar = new ForgeBar('b');
    const before = { len: bar.length, match: bar.shapeMatch().overall };
    bar.apply({ w: 'b', k: 'strike', u: 0.6, s: 1, e: false });
    expect(bar.length).toBeCloseTo(before.len, 6);
    bar.apply({ w: 'b', k: 'temp', v: 1 });
    for (let k = 0; k < 30; k++) bar.apply({ w: 'b', k: 'strike', u: 0.35 + (k % 7) * 0.1, s: 1, e: false });
    for (let k = 0; k < 8; k++) bar.apply({ w: 'b', k: 'strike', u: 0.95, s: 1, e: true });
    expect(bar.length).toBeGreaterThan(before.len * 1.15);
    expect(bar.shapeMatch().overall).toBeGreaterThan(before.match + 0.3);
  });
});

describe('carving wood', () => {
  it('a shave takes off less than a voxel when it is shallow, leaving a smooth surface', () => {
    const b = block();
    const { ny, nz } = b.spec;
    // Ball of radius 3 whose surface dips 0.4 voxels below the top face.
    b.apply({ w: 'w', k: 'shave', a: [6, ny + 2.6, nz / 2], b: [18, ny + 2.6, nz / 2], r: 3 });
    expect(b.solid.every((s) => s === 1)).toBe(true);
    const top = topAt(b, 12, nz / 2)!;
    expect(top).toBeGreaterThan(ny - 0.6);
    expect(top).toBeLessThan(ny - 0.2);
  });

  it('a preview reports exactly what applying the shave cuts through', () => {
    const b = block();
    const a: VC = [4, 13, 6];
    const c: VC = [20, 11.5, 7];
    const { changed, cut } = b.shavePreview(a, c, 2.5);
    const before = b.solid.slice();
    b.apply({ w: 'w', k: 'shave', a, b: c, r: 2.5 });
    expect(changed).toBeGreaterThan(0);
    const gone = [...before.keys()].filter((i) => before[i] && !b.solid[i]);
    expect(gone.sort((x, y) => x - y)).toEqual([...cut].sort((x, y) => x - y));
  });

  it('finds the surface and its outward normal', () => {
    const b = block();
    const { ny } = b.spec;
    expect(topAt(b, 12, 6)).toBeCloseTo(ny, 1);
    const n = b.normalAt([12, ny, 6])!;
    expect(n.y).toBeGreaterThan(0.95);
  });

  it('one pass of the knife cuts to an even depth instead of digging in, and a light grip cuts shallower', () => {
    const depthAfterPass = (grip: number) => {
      const bench = new Bench(benchFor('puukko'));
      const h = bench.wp<VoxelBlock>('handle');
      const { nx, ny, nz } = h.spec;
      const ctx = knifeCtx(bench, grip);
      // Draw the blade along the top of the blank, looking straight down at it.
      for (let x = 8; x <= nx - 8; x += 0.4) {
        const y = topAt(h, x, nz / 2 + 2)!;
        ctx.aim.hit = { type: 'workpiece', id: 'handle', local: h.fromVoxel([x, y, nz / 2 + 2]), dir: new THREE.Vector3(0, -1, 0) };
        shave(ctx, h, { r: 2.6, light: 0.3, deep: 1.7 });
      }
      const depths = [12, 20, 28, 36].map((x) => ny - topAt(h, x, nz / 2 + 2)!);
      return { min: Math.min(...depths), max: Math.max(...depths) };
    };
    const deep = depthAfterPass(1);
    expect(deep.min).toBeGreaterThan(1.3);
    expect(deep.max).toBeLessThan(2.1);
    const light = depthAfterPass(0.7);
    expect(light.max).toBeLessThan(deep.min);
    expect(biteOf(0.6)).toBe(0);
    expect(biteOf(1)).toBe(1);
  });
});

describe('surface nets', () => {
  it('meshes an uncut block as a closed surface the size of the block', () => {
    const b = block();
    const net = surfaceNets(b.spec.nx, b.spec.ny, b.spec.nz, b.spec.size, b.dens);
    const edges = new Map<string, number>();
    for (let i = 0; i < net.indices.length; i += 3) {
      const t = [net.indices[i], net.indices[i + 1], net.indices[i + 2]];
      for (let k = 0; k < 3; k++) {
        const a = t[k];
        const c = t[(k + 1) % 3];
        const key = a < c ? `${a}-${c}` : `${c}-${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    // Watertight: every edge is shared by exactly two triangles.
    expect([...edges.values()].every((n) => n === 2)).toBe(true);
    const box = new THREE.Box3().setFromArray(net.positions);
    const e = b.extent;
    expect(box.max.x - box.min.x).toBeCloseTo(e.x, 5);
    expect(box.max.y - box.min.y).toBeCloseTo(e.y, 5);
    expect(box.min.y).toBeCloseTo(0, 5);
  });
});

describe('puukko handle turning', () => {
  const turnCtx = (b: Bench, ops: Op[]) =>
    ({
      b,
      mem: {},
      emit: (op: Op) => {
        b.apply(op);
        ops.push(op);
      },
      say: () => {},
    }) as unknown as InteractCtx;

  it('changes the yaw only through ops, and a turn of 0 flushes the remainder', () => {
    const def = benchFor('puukko');
    const live = new Bench(def);
    live.apply({ w: '$', k: 'place', wp: 'blade', at: 'forge' }); // so turns go to the handle
    const ops: Op[] = [];
    const ctx = turnCtx(live, ops);
    const replay = new Bench(def);
    replay.apply({ w: '$', k: 'place', wp: 'blade', at: 'forge' });
    let total = live.state.yaw.handle;
    const deltas = [0.004, 0.003, 0.0071, -0.002, 0.026, 0.0009, 0.0013, 0.0042, -0.0105, 0.0033, 0.0061];
    for (const d of deltas) {
      const n = ops.length;
      def.turn!(ctx, d);
      total += d;
      for (const op of ops.slice(n)) replay.apply(op);
      // Live never runs ahead of what the recording would show.
      expect(replay.state.yaw.handle).toBe(live.state.yaw.handle);
    }
    expect(live.state.yaw.handle).not.toBe(r3(total)); // a remainder is pending
    def.turn!(ctx, 0);
    const fresh = new Bench(def);
    for (const op of [{ w: '$', k: 'place', wp: 'blade', at: 'forge' }, ...ops]) fresh.apply(op);
    expect(live.state.yaw.handle).toBe(r3(total));
    expect(fresh.state.yaw.handle).toBe(live.state.yaw.handle);
  });

  it('picks up from a yaw set by another op instead of jumping back', () => {
    const b = new Bench(benchFor('puukko'));
    b.apply({ w: '$', k: 'place', wp: 'blade', at: 'forge' });
    const ops: Op[] = [];
    const ctx = turnCtx(b, ops);
    b.def.turn!(ctx, 0.05);
    b.apply({ w: '$', k: 'yaw', wp: 'handle', v: 2 }); // swap ends
    b.def.turn!(ctx, 0.05);
    expect(b.state.yaw.handle).toBe(2.05);
  });
});

describe('the bench session', () => {
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 100);
  camera.position.set(0, 9.4, 10.8);
  camera.lookAt(0, 0.5, 0.5);
  camera.updateMatrixWorld();

  const hand = (side: Side, grip: number, x = 0): RobotHandCommand => ({
    side,
    dof: [grip, grip, grip, grip, grip, grip],
    raw: [0, 0, 0, 0, 0, 0],
    position: new THREE.Vector3(x, 0, 0),
    rotation: new THREE.Quaternion(),
    grip,
  });
  const ticks = (s: BenchSession, n: number, dtMs = 16) => {
    for (let i = 0; i < n; i++) s.tick(dtMs, camera);
  };
  const start = () => {
    const s = new BenchSession(benchFor('puukko'), { kind: 'free' });
    s.activate();
    return s;
  };
  const priv = (s: BenchSession) => s as unknown as { squeezing: boolean };

  beforeEach(() => {
    input.dominant = 'right';
    input.commands = {};
  });

  it('keeps heating the bar in the forge with no hand in view', () => {
    const s = start();
    s.emit({ w: '$', k: 'place', wp: 'blade', at: 'forge' });
    ticks(s, 60);
    expect(s.bench.wp<ForgeBar>('blade').temp).toBeGreaterThan(0.1);
  });

  it('does not hand the tongs to the other hand while they carry the bar', () => {
    const s = start();
    s.hands.right.tool = 'tongs';
    s.emit({ w: '$', k: 'place', wp: 'blade', at: 'carried:right' });
    input.commands = { left: hand('left', 0) };
    ticks(s, 3);
    expect(s.primary).toBe('right');
    expect(s.hands.right.tool).toBe('tongs');
    expect(s.hands.left.tool).toBeNull();
    expect(s.bench.state.place.blade).toBe('carried:right');
    expect(s.hands.right.pose).toBeUndefined();
    expect(s.hands.left.pose).toBeDefined(); // still the off hand
  });

  it('keeps holding the birch in the off hand when the working hand drops out', () => {
    const s = start();
    s.hands.right.tool = 'knife';
    s.emit({ w: '$', k: 'place', wp: 'handle', at: 'held:left' });
    input.commands = { left: hand('left', 0.9) };
    ticks(s, 60);
    expect(s.primary).toBe('right');
    expect(s.hands.right.tool).toBe('knife');
    expect(s.bench.state.place.handle).toBe('held:left');
  });

  it('a closed hand taking over the tool does not count as a fresh squeeze until it opens', () => {
    const s = start();
    s.hands.right.tool = 'hammer';
    input.commands = { right: hand('right', 1) };
    ticks(s, 2);
    expect(priv(s).squeezing).toBe(true);
    input.commands = { left: hand('left', 1) };
    ticks(s, 2);
    expect(s.primary).toBe('left');
    expect(s.hands.left.tool).toBe('hammer');
    expect(s.hands.right.tool).toBeNull();
    expect(priv(s).squeezing).toBe(false);
    input.commands = { left: hand('left', 0.2) };
    ticks(s, 1);
    input.commands = { left: hand('left', 1) };
    ticks(s, 1);
    expect(priv(s).squeezing).toBe(true);
  });

  it('records the exact handle angle when Q / E turning stops', () => {
    const s = start();
    s.emit({ w: '$', k: 'place', wp: 'blade', at: 'forge' }); // turns go to the handle
    input.commands = { right: hand('right', 0) };
    const key = (type: string, k: string) => window.dispatchEvent(Object.assign(new Event(type), { key: k }));
    const before = s.bench.state.yaw.handle;
    key('keydown', 'e');
    ticks(s, 7, 5); // 0.008 rad a tick: smaller than one op step
    key('keyup', 'e');
    ticks(s, 2, 5);
    expect(s.bench.state.yaw.handle).toBe(r3(before + 7 * 1.6 * 0.005));
    s.finish();
    const rec = useBenchUi.getState().lastRecording!;
    const replay = new Bench(benchFor('puukko'));
    new BenchPlayer(rec, replay).advance(rec.durationMs + 1);
    expect(replay.state.yaw.handle).toBe(s.bench.state.yaw.handle);
  });
});
