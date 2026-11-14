// Procedural models for tools and stations. A tool is drawn in its own frame:
// the grip at the origin, the working tip at (0, -len, 0), in hand units.

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { StationDef, ToolDef } from '../core';
import { anvilBody, hammerHead, PUUKKO_HANDLE, puukkoBlade, roundedBox, stump, tongRein, turnedHandle } from './shapes';
import { endGrainTexture, woodTexture } from './wood';

const BIRCH = '#e3c995';
const BRASS = '#c9a24a';

type MatProps = { color: string; metalness?: number; roughness?: number; emissive?: string; emissiveIntensity?: number; transparent?: boolean; opacity?: number; map?: THREE.Texture };

/** Polished steel, forged iron, and wood with grain, for the better-made tools. */
const Steel = ({ ghost }: { ghost?: boolean }) => <M color="#d5dbdf" metalness={0.95} roughness={0.18} ghost={ghost} />;
const Iron = ({ ghost }: { ghost?: boolean }) => <M color="#3b4044" metalness={0.85} roughness={0.38} ghost={ghost} />;
const Brass = ({ ghost }: { ghost?: boolean }) => <M color={BRASS} metalness={0.9} roughness={0.28} ghost={ghost} />;
function Grain({ ghost, base, dark, seed = 1 }: { ghost?: boolean; base: string; dark: string; seed?: number }) {
  const map = useMemo(() => woodTexture(base, dark, seed), [base, dark, seed]);
  return <M color="#ffffff" map={map} roughness={0.55} ghost={ghost} />;
}


function M({ ghost, ...p }: MatProps & { ghost?: boolean }) {
  if (ghost) return <meshStandardMaterial color="#7fd1e8" transparent opacity={0.25} depthWrite={false} />;
  return <meshStandardMaterial roughness={0.6} {...p} />;
}

/** A tool in its own frame. */
export function ToolModel({ def, ghost }: { def: ToolDef; ghost?: boolean }) {
  const L = def.len;
  const g = ghost;
  switch (def.model) {
    case 'knife':
      // Puukko: barrel-shaped birch handle, brass bolster and cap, a blade with a dropping point.
      return (
        <group>
          <mesh geometry={turnedHandle('puukko', PUUKKO_HANDLE)} castShadow>
            <Grain ghost={g} base={BIRCH} dark="#a07a4c" seed={2} />
          </mesh>
          <mesh position={[0, -0.3, 0]} scale={[0.82, 1, 1]} castShadow>
            <cylinderGeometry args={[0.07, 0.08, 0.06, 20]} />
            <Brass ghost={g} />
          </mesh>
          <mesh position={[0, 0.345, 0]} scale={[0.82, 1, 1]}>
            <cylinderGeometry args={[0.045, 0.062, 0.03, 20]} />
            <Brass ghost={g} />
          </mesh>
          <mesh geometry={puukkoBlade(L - 0.33)} position={[0, -0.33, 0]} castShadow>
            <Steel ghost={g} />
          </mesh>
        </group>
      );
    case 'hammer':
      return (
        <group>
          <mesh
            geometry={turnedHandle('hammer', [
              [0, 0.3],
              [0.042, 0.3],
              [0.056, 0.24],
              [0.05, 0.0],
              [0.038, -0.45],
              [0.044, -L + 0.2],
              [0.05, -L + 0.12],
              [0, -L + 0.12],
            ])}
            castShadow
          >
            <Grain ghost={g} base="#c9a46a" dark="#8a6a3e" seed={4} />
          </mesh>
          <mesh geometry={hammerHead()} position={[0, -L + 0.1, 0]} castShadow>
            <Iron ghost={g} />
          </mesh>
        </group>
      );
    case 'tongs':
      return (
        <group>
          <mesh geometry={tongRein(L, 1)} castShadow>
            <Iron ghost={g} />
          </mesh>
          <mesh geometry={tongRein(L, -1)} castShadow>
            <Iron ghost={g} />
          </mesh>
          <mesh position={[0, -L + 0.28, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.032, 0.032, 0.07, 12]} />
            <Iron ghost={g} />
          </mesh>
        </group>
      );
    case 'whetstone':
      return (
        <group>
          <mesh geometry={roundedBox(0.16, L, 0.5, 0.035)} position={[0, -L / 2, 0]} castShadow>
            <M color="#7b8387" roughness={0.95} ghost={g} />
          </mesh>
          <mesh position={[0.081, -L / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[0.44, L * 0.86]} />
            <M color="#5f676b" roughness={0.6} ghost={g} />
          </mesh>
        </group>
      );
  }
}

/** A chopping-block stump: bark round the side, end grain with growth rings on top. */
function BarkStump({ r, h, pickRef }: { r: number; h: number; pickRef?: (o: THREE.Object3D | null) => void }) {
  const bark = useMemo(() => {
    const t = woodTexture('#5a4535', '#211912', 7).clone();
    t.needsUpdate = true;
    t.repeat.set(5, 1);
    return t;
  }, []);
  const top = useMemo(() => endGrainTexture('#b48f62', '#6a4e33'), []);
  return (
    <>
      <mesh ref={pickRef} geometry={stump(r, h)} castShadow receiveShadow>
        <meshStandardMaterial map={bark} roughness={0.97} />
      </mesh>
      <mesh position={[0, h + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[r * 1.0, 40]} />
        <meshStandardMaterial map={top} roughness={0.85} />
      </mesh>
    </>
  );
}

/** A bed of coals: lumps glowing from deep red to yellow, flickering. */
function Coals({ width, depth, y }: { width: number; depth: number; y: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = 46;
  const geom = useMemo(() => new THREE.IcosahedronGeometry(0.085, 0), []);
  const lumps = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const r = (k: number) => {
          const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
          return v - Math.floor(v);
        };
        return { x: (r(1) - 0.5) * width, z: (r(2) - 0.5) * depth, s: 0.7 + r(3) * 0.8, rot: r(4) * 6, heat: r(5), phase: r(6) * 6 };
      }),
    [width, depth],
  );
  const mat = useMemo(() => new THREE.MeshBasicMaterial(), []);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const mtx = new THREE.Matrix4();
    const c = new THREE.Color();
    lumps.forEach((l, i) => {
      if (!m.userData.placed) m.setMatrixAt(i, mtx.compose(new THREE.Vector3(l.x, y, l.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(l.rot, l.rot * 1.3, 0)), new THREE.Vector3(l.s, l.s * 0.7, l.s)));
      const h = THREE.MathUtils.clamp(l.heat * 0.8 + 0.2 * Math.sin(clock.elapsedTime * 2.2 + l.phase), 0, 1);
      c.setHSL(0.02 + 0.09 * h, 1, 0.08 + 0.42 * h * h);
      m.setColorAt(i, c);
    });
    m.userData.placed = true;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geom, mat, n]} />;
}

/** Glow that flickers, for fires and furnaces. */
function Flicker({ base, color, position, distance = 4 }: { base: number; color: string; position: [number, number, number]; distance?: number }) {
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (light.current) light.current.intensity = base * (0.85 + 0.15 * Math.sin(clock.elapsedTime * 11) * Math.sin(clock.elapsedTime * 3.7));
  });
  return <pointLight ref={light} color={color} position={position} intensity={base} distance={distance} />;
}

const Glow = ({ color, intensity = 1.6 }: { color: string; intensity?: number }) => <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} />;

/** A station, drawn at its position. Returns meshes that can be registered for picking via `pickRef`. */
export function StationModel({ def, pickRef }: { def: StationDef; pickRef: (o: THREE.Object3D | null) => void }) {
  const [x, y, z] = def.pos;
  const rest = def.rest ?? 0;
  switch (def.model) {
    case 'forge':
      return (
        <group position={[x, y, z]}>
          <mesh ref={pickRef} geometry={roundedBox(1.9, rest - 0.1, 1.6, 0.06)} position={[0, rest / 2 - 0.05, 0]} castShadow receiveShadow>
            <meshStandardMaterial color="#7a4a38" roughness={0.95} />
          </mesh>
          <mesh position={[0, rest - 0.08, 0]}>
            <boxGeometry args={[1.4, 0.1, 1.1]} />
            <Glow color="#ff5a14" intensity={1.6} />
          </mesh>
          <Coals width={1.3} depth={1.0} y={rest - 0.03} />
          {/* Sheet-iron hood and chimney */}
          <mesh position={[0, rest + 1.75, -0.1]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <cylinderGeometry args={[0.28, 1.05, 0.7, 4, 1, true]} />
            <meshStandardMaterial color="#2f3336" metalness={0.6} roughness={0.55} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, rest + 2.6, -0.1]}>
            <cylinderGeometry args={[0.2, 0.2, 1.1, 14]} />
            <meshStandardMaterial color="#2f3336" metalness={0.6} roughness={0.55} />
          </mesh>
          <Flicker base={9} color="#ff7a2a" position={[0, rest + 0.6, 0]} />
        </group>
      );
    case 'anvil':
      return (
        <group position={[x, y, z]}>
          <BarkStump r={0.58} h={0.6} />
          <mesh ref={pickRef} geometry={anvilBody(0.6, rest)} castShadow receiveShadow>
            <meshStandardMaterial color="#383d41" metalness={0.75} roughness={0.42} />
          </mesh>
          {/* Polished face, horn and hardy hole */}
          <mesh position={[0.04, rest + 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[1.36, 0.52]} />
            <meshStandardMaterial color="#8f989e" metalness={0.92} roughness={0.2} />
          </mesh>
          <mesh position={[-0.97, rest - 0.1, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <coneGeometry args={[0.13, 0.64, 24]} />
            <meshStandardMaterial color="#383d41" metalness={0.75} roughness={0.42} />
          </mesh>
          <mesh position={[0.6, rest + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.08, 0.08]} />
            <meshBasicMaterial color="#0d0f10" />
          </mesh>
        </group>
      );
    case 'bucket':
      return (
        <group position={[x, y, z]}>
          <mesh ref={pickRef} position={[0, 0.3, 0]} castShadow>
            <cylinderGeometry args={[0.62, 0.52, 0.6, 20, 1, true]} />
            <meshStandardMaterial color={def.color ? '#6a6f73' : '#7a5a3a'} side={THREE.DoubleSide} roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.6, 20]} />
            <meshStandardMaterial color={def.color ?? '#3e6f80'} roughness={def.color ? 0.6 : 0.1} metalness={0.1} />
          </mesh>
        </group>
      );
    case 'block': {
      const r = Math.min(1.7, def.radius * 0.75);
      return (
        <group position={[x, y, z]}>
          <BarkStump r={r} h={rest} pickRef={pickRef} />
        </group>
      );
    }
  }
}
