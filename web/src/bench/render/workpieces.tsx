// Renderers for each material. Every view watches its workpiece's version and
// rebuilds the mesh when an op changes it, so the object updates frame by
// frame, live or in replay.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';
import { ForgeBar, SEGMENTS } from '../materials/forge';
import { surfaceNets } from '../materials/mesh';
import { VoxelBlock, type VC } from '../materials/voxel';
import { useBenchUi, type BenchSession } from '../session';
import { woodMaterial } from './wood';

type Props = { session: BenchSession; id: string };

/** Outer frame that follows the workpiece around the bench, easing it between places (hand to block). */
function WpFrame({ session, id, children, orient }: Props & { children: ReactNode; orient?: (g: THREE.Group) => void }) {
  const g = useRef<THREE.Group>(null);
  const move = useMemo(() => ({ place: '', t: 1, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), p: new THREE.Vector3(), q: new THREE.Quaternion() }), []);
  useFrame((_, dt) => {
    const grp = g.current;
    if (!grp) return;
    const vis = session.wpTransform(id, move.p, move.q);
    const place = session.bench.state.place[id] ?? '';
    if (place !== move.place) {
      // Carried pieces follow the tool tip exactly; others glide to their new spot.
      if (move.place && grp.visible && !place.startsWith('carried')) {
        move.pos.copy(grp.position);
        move.quat.copy(grp.quaternion);
        move.t = 0;
      }
      move.place = place;
    }
    if (move.t < 1) {
      move.t = Math.min(1, move.t + dt / 0.28);
      const k = 1 - (1 - move.t) ** 3;
      grp.position.lerpVectors(move.pos, move.p, k);
      grp.quaternion.slerpQuaternions(move.quat, move.q, k);
    } else {
      grp.position.copy(move.p);
      grp.quaternion.copy(move.q);
    }
    grp.visible = vis;
    orient?.(grp);
  });
  return <group ref={g}>{children}</group>;
}

function usePick(session: BenchSession, ref: RefObject<THREE.Object3D | null>, id: string, frame?: RefObject<THREE.Object3D | null>, part?: string) {
  useEffect(() => {
    const o = ref.current;
    if (!o) return;
    return session.register(o, { type: 'workpiece', id, part }, frame?.current ?? undefined);
  }, [session, ref, id, frame, part]);
}

/** Calls `rebuild` whenever the workpiece (or anything in `extra`) changes. */
function useRebuild<T>(session: BenchSession, id: string, rebuild: (wp: T) => void, extra: () => unknown = () => 0) {
  const last = useRef<{ wp: unknown; v: number; x: unknown }>({ wp: null, v: -1, x: null });
  useFrame(() => {
    const wp = session.bench.workpieces.get(id) as unknown as (T & { version: number }) | undefined;
    if (!wp) return;
    const x = extra();
    const l = last.current;
    if (l.wp === wp && l.v === wp.version && l.x === x) return;
    last.current = { wp, v: wp.version, x };
    rebuild(wp);
  });
}

const guideOn = () => useBenchUi.getState().guide;

// ---------------------------------------------------------------- voxels

const CARVE_STAGES = new Set(['handle']);

function VoxelView({ session, id }: Props) {
  const wp0 = session.bench.wp<VoxelBlock>(id);
  const { size, nx, ny, nz } = wp0.spec;
  const mesh = useRef<THREE.Mesh>(null);
  const ghost = useRef<THREE.Mesh>(null);
  const frame = useRef<THREE.Group>(null);
  const mat = useMemo(() => {
    const g = wp0.spec.grain ?? { axis: [1, 0, 0] as VC, freq: 10 };
    return woodMaterial({ axis: g.axis, centre: g.centre ?? [0, (ny * size) / 2, 0], freq: g.freq, swirl: g.swirl, contrast: g.contrast });
  }, [wp0, ny, size]);
  const ghostMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7fd1e8', transparent: true, opacity: 0.13, depthTest: false, depthWrite: false }), []);
  usePick(session, mesh, id, frame);

  useRebuild<VoxelBlock>(
    session,
    id,
    (b) => {
      const m = mesh.current;
      if (!m) return;
      const guide = guideOn() && !!b.spec.target;
      const carving = CARVE_STAGES.has(session.stage?.id ?? '');
      const wood = new THREE.Color(b.spec.wood);
      const bark = new THREE.Color(b.spec.bark ?? b.spec.wood);
      const waste = wood.clone().lerp(new THREE.Color('#8a5a33'), 0.42);
      const net = surfaceNets(nx, ny, nz, size, b.dens);
      const colours = new Float32Array(net.vertexCount * 3);
      const grain = new Float32Array(net.vertexCount).fill(1);
      const col = new THREE.Color();
      const sum = new THREE.Color();
      // Each vertex takes the average colour of the solid cells around it.
      const cellColour = (i: number) => {
        const [x, y, z] = b.coords(i);
        const outer = x === 0 || z === 0 || y === 0 || x === nx - 1 || z === nz - 1 || y === ny - 1;
        // Untouched outside of the blank: bark or the sawn face. Anything cut shows fresh wood.
        return col.copy(outer && b.spec.bark && b.dens[i] > 0.999 ? bark : guide && carving && !b.spec.target![i] ? waste : wood);
      };
      for (let v = 0; v < net.vertexCount; v++) {
        sum.setRGB(0, 0, 0);
        let k = 0;
        for (let c = 0; c < 8; c++) {
          const i = net.corners[v * 8 + c];
          if (i < 0) continue;
          const cc = cellColour(i);
          sum.r += cc.r;
          sum.g += cc.g;
          sum.b += cc.b;
          k++;
        }
        if (k) {
          colours[v * 3] = sum.r / k;
          colours[v * 3 + 1] = sum.g / k;
          colours[v * 3 + 2] = sum.b / k;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(net.positions, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      g.setAttribute('grain', new THREE.BufferAttribute(grain, 1));
      g.setIndex(new THREE.BufferAttribute(net.indices, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      g.computeBoundingBox();
      m.geometry.dispose();
      m.geometry = g;

      const gm = ghost.current;
      if (gm) {
        gm.visible = guide && carving;
        if (gm.visible && gm.userData.built !== b.spec.target) {
          gm.userData.built = b.spec.target;
          const t = surfaceNets(nx, ny, nz, size, b.spec.target!);
          const tg = new THREE.BufferGeometry();
          tg.setAttribute('position', new THREE.BufferAttribute(t.positions, 3));
          tg.setIndex(new THREE.BufferAttribute(t.indices, 1));
          tg.computeVertexNormals();
          gm.geometry.dispose();
          gm.geometry = tg;
        }
      }
    },
    () => `${guideOn()}-${session.stage?.id}`,
  );

  return (
    <WpFrame session={session} id={id}>
      <group ref={frame}>
        <mesh ref={mesh} material={mat} castShadow receiveShadow />
        <mesh ref={ghost} material={ghostMat} renderOrder={5} />
      </group>
    </WpFrame>
  );
}

// ---------------------------------------------------------------- forged steel

function heatColour(t: number) {
  if (t < 0.3) return new THREE.Color(0, 0, 0);
  const k = (t - 0.3) / 0.7;
  return new THREE.Color().setHSL(0.02 + 0.12 * k, 1, 0.35 + 0.25 * k).multiplyScalar(0.4 + 1.6 * k);
}

function ForgeView({ session, id }: Props) {
  const mesh = useRef<THREE.Mesh>(null);
  const frame = useRef<THREE.Group>(null);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.42, side: THREE.DoubleSide }), []);
  usePick(session, mesh, id, frame);

  useRebuild<ForgeBar>(session, id, (bar) => {
    const m = mesh.current;
    const f = frame.current;
    if (!m || !f) return;
    f.position.x = -bar.length / 2;
    const steel = new THREE.Color(bar.hardened ? '#6d747b' : '#4a4f55');
    const bright = new THREE.Color('#dfe5e8');
    // Cross-sections at each segment boundary (values averaged across neighbours).
    const rings: { x: number; pts: [number, number][]; bevel: number }[] = [];
    let x = 0;
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = Math.max(0, i - 1);
      const c = Math.min(SEGMENTS - 1, i);
      const w = (bar.w[a] + bar.w[c]) / 2;
      const t = (bar.t[a] + bar.t[c]) / 2;
      const bv = (bar.bevel[a] + bar.bevel[c]) / 2;
      const bw = w * 0.42 * bv;
      const te = t * (1 - 0.85 * bv);
      rings.push({
        x,
        bevel: bv,
        pts: [
          [t / 2, w / 2],
          [-t / 2, w / 2],
          [-te / 2, -w / 2 + bw],
          [0, -w / 2],
          [te / 2, -w / 2 + bw],
        ],
      });
      if (i < SEGMENTS) x += bar.len[i];
    }
    const pos: number[] = [];
    const cols: number[] = [];
    const colourOf = (k: number, bv: number) => (k >= 2 && bv > 0.05 ? steel.clone().lerp(bright, Math.min(1, bv * 1.3)) : steel);
    const push = (rx: number, p: [number, number], c: THREE.Color) => {
      pos.push(rx, p[0], p[1]);
      cols.push(c.r, c.g, c.b);
    };
    for (let i = 0; i < rings.length - 1; i++) {
      const A = rings[i];
      const B = rings[i + 1];
      for (let k = 0; k < 5; k++) {
        const k2 = (k + 1) % 5;
        const ca = colourOf(k, A.bevel);
        const cb = colourOf(k, B.bevel);
        // Wound so the normals face outwards.
        push(A.x, A.pts[k], ca);
        push(B.x, B.pts[k2], cb);
        push(B.x, B.pts[k], cb);
        push(A.x, A.pts[k], ca);
        push(A.x, A.pts[k2], ca);
        push(B.x, B.pts[k2], cb);
      }
    }
    for (const [R, flip] of [
      [rings[0], true],
      [rings[rings.length - 1], false],
    ] as const) {
      for (let k = 1; k < 4; k++) {
        const tri = flip ? [0, k + 1, k] : [0, k, k + 1];
        for (const j of tri) push(R.x, R.pts[j], steel);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    m.geometry.dispose();
    m.geometry = g;
    mat.emissive.copy(heatColour(bar.temp));
  });

  return (
    <WpFrame session={session} id={id}>
      <group ref={frame}>
        <mesh ref={mesh} material={mat} castShadow />
      </group>
    </WpFrame>
  );
}

// ---------------------------------------------------------------- dispatch

export function WorkpieceView({ session, id }: Props) {
  const kind = session.bench.wp(id).kind;
  switch (kind) {
    case 'voxel':
      return <VoxelView session={session} id={id} />;
    case 'forge':
      return <ForgeView session={session} id={id} />;
  }
}
