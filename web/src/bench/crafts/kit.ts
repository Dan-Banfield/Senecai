// Shared craft moves: shaving wood with a knife, heating and cooling.

import * as THREE from 'three';
import { biteOf, type InteractCtx, type ToolDef } from '../core';
import type { VC, VoxelBlock } from '../materials/voxel';

/** Front edge of the table, where tools rest. */
export const FRONT = 2.55;

export function tool(t: ToolDef): ToolDef {
  return { pitch: 0.4, lift: 0.28, ...t };
}

/** The aim, if it is on workpiece `id`. */
export function onWp(ctx: InteractCtx, id: string) {
  const h = ctx.aim.hit;
  return h.type === 'workpiece' && h.id === id ? h : null;
}

export interface ShaveOpts {
  /** Roundness of the cutting edge, in voxels: bigger makes wider, flatter facets. */
  r: number;
  /** Depth of cut (voxels below the surface) with the lightest squeeze, and with a full fist. */
  light: number;
  deep: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Shave the wood with a knife. While squeezing, the edge follows the hand
 * across the surface and takes a continuous shaving along the path, as deep
 * as the grip says: a light squeeze skims a curl thinner than a voxel, a full
 * fist bites deep. Holding the knife still cuts nothing; it has to travel.
 * Works on the piece wherever it is, including turning in the other hand,
 * because the stroke is tracked in the piece's own frame.
 * Returns the cells cut through (so crafts can warn about cutting into the keep).
 */
export function shave(ctx: InteractCtx, block: VoxelBlock, o: ShaveOpts): number[] | null {
  const key = `shave:${block.id}`;
  const h = onWp(ctx, block.id);
  if (!ctx.squeeze) ctx.mem[key] = null;
  if (!ctx.squeeze || !h) return null;
  // One squeeze is one pass. Its depth is measured from the wood as it was when the
  // pass began, so the cut doesn't feed on itself and dig in; the next pass goes deeper.
  let stroke = ctx.mem[key] as { c: VC | null; before: Float32Array } | null;
  if (!stroke) ctx.mem[key] = stroke = { c: null, before: block.dens.slice() };
  const v = block.toVoxel(h.local);
  const dir: VC = [h.dir.x, h.dir.y, h.dir.z];
  const t = block.rayEntry(v, dir, -8, 0.4, stroke.before);
  const p: VC = t === null ? v : [v[0] + dir[0] * t, v[1] + dir[1] * t, v[2] + dir[2] * t];
  const n = block.normalAt(p, stroke.before) ?? block.normalAt(v) ?? h.dir.clone().negate();
  const depth = o.light + (o.deep - o.light) * biteOf(ctx.grip);
  const lift = o.r - depth;
  const c: VC = [p[0] + n.x * lift, p[1] + n.y * lift, p[2] + n.z * lift];
  const last = stroke.c;
  const gap = last ? Math.hypot(c[0] - last[0], c[1] - last[1], c[2] - last[2]) : Infinity;
  // The blade must travel (half a voxel) before it cuts again, so a hand held still does nothing.
  if (last && gap < 0.5) return null;
  const a: VC = last && gap < Math.max(4, o.r * 2) ? last : c;
  stroke.c = c;
  const op = { a: a.map(r2) as VC, b: c.map(r2) as VC, r: r2(o.r) };
  const { changed, cut } = block.shavePreview(op.a, op.b, op.r);
  if (!changed) return null;
  ctx.emit({ w: block.id, k: 'shave', ...op });
  return cut;
}

/** Warn when a cut bites into the part that should stay. */
export function warnOvercut(ctx: InteractCtx, block: VoxelBlock, cells: number[] | null, text: string) {
  const t = block.spec.target;
  if (!cells || !t || !cells.some((c) => t[c])) return;
  const at = (ctx.mem.overcutAt as number) ?? 0;
  if (performance.now() - at < 1600) return;
  ctx.mem.overcutAt = performance.now();
  ctx.say(text, 'warn');
}

/**
 * Integrate a temperature and emit it as an absolute value whenever it has
 * moved enough, so replays reproduce it exactly.
 */
export function heat(ctx: InteractCtx, wp: string, current: number, rate: number, opName = 'temp') {
  const key = `heat:${wp}`;
  const t = THREE.MathUtils.clamp(((ctx.mem[key] as number | undefined) ?? current) + rate * ctx.dt, 0, 1);
  ctx.mem[key] = t;
  if (Math.abs(t - current) > 0.02 || (t === 0 && current > 0) || (t === 1 && current < 1)) ctx.emit({ w: wp, k: opName, v: Math.round(t * 1000) / 1000 });
}

/** Reset the integrator when an op sets the temperature directly (quench, gather). */
export function resetHeat(ctx: InteractCtx, wp: string, v: number) {
  ctx.mem[`heat:${wp}`] = v;
}

/** True at most `hz` times a second for this key: throttles continuous actions. */
export function every(ctx: InteractCtx, key: string, hz: number) {
  const now = performance.now();
  const last = (ctx.mem[`every:${key}`] as number | undefined) ?? 0;
  if (now - last < 1000 / hz) return false;
  ctx.mem[`every:${key}`] = now;
  return true;
}
