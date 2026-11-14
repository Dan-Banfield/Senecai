// The workbench scene: a table with stations, resting tools, the workpieces,
// both robot hands (with whatever they hold), and little effects.

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RobotHand } from '../../robot/RobotHand';
import type { Side } from '../../rokoko/types';
import type { StationDef, ToolDef } from '../core';
import { GRIP, HAND_SCALE } from '../pose';
import { useBenchUi, type BenchSession } from '../session';
import { StationModel, ToolModel } from './models';
import { WorkpieceView } from './workpieces';

function CameraRig({ session }: { session: BenchSession }) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(...session.def.views.main.look));
  useFrame((_, dt) => {
    const v = session.def.views[useBenchUi.getState().view] ?? session.def.views.main;
    const k = 1 - Math.exp(-dt * 3);
    camera.position.lerp(new THREE.Vector3(...v.pos), k);
    look.current.lerp(new THREE.Vector3(...v.look), k);
    camera.lookAt(look.current);
  });
  return null;
}

/** Soft studio reflections, so steel and brass look like metal rather than grey plastic. */
function Reflections() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.4;
    return () => {
      scene.environment = null;
      env.dispose();
      pm.dispose();
    };
  }, [gl, scene]);
  return null;
}

function Ticker({ session }: { session: BenchSession }) {
  const { camera } = useThree();
  useFrame((_, delta) => session.tick(Math.min(250, delta * 1000), camera));
  return null;
}

function Table() {
  return (
    <group>
      <mesh position={[0, -0.16, 0]} receiveShadow castShadow>
        <boxGeometry args={[14.5, 0.32, 8.4]} />
        <meshStandardMaterial color="#6e5440" roughness={0.85} />
      </mesh>
      {[
        [-6.6, -3.6],
        [6.6, -3.6],
        [-6.6, 3.6],
        [6.6, 3.6],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, -1.9, z]}>
          <boxGeometry args={[0.4, 3.2, 0.4]} />
          <meshStandardMaterial color="#5b4636" roughness={0.9} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.5, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#2a2420" roughness={0.95} />
      </mesh>
    </group>
  );
}

function Ring({ at, radius, colour, pulse }: { at: [number, number, number]; radius: number; colour: string; pulse?: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current && pulse) (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.25 * Math.sin(clock.elapsedTime * 4);
  });
  return (
    <mesh ref={ref} position={[at[0], at[1] + 0.012, at[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius * 0.86, radius, 40]} />
      <meshBasicMaterial color={colour} transparent opacity={0.6} depthWrite={false} />
    </mesh>
  );
}

/** Highlight state for a tool or station: hovered, or wanted by the current stage. */
function useHighlight(session: BenchSession, kind: 'tool' | 'station', id: string) {
  const [h, setH] = useState<'hover' | 'stage' | null>(null);
  useFrame(() => {
    const aim = session.aim;
    const hover = kind === 'tool' ? aim?.tool === id : aim?.station === id;
    const st = session.stage;
    const wanted = session.mode.kind !== 'replay' && useBenchUi.getState().guide && !!(kind === 'tool' ? st?.tools : st?.stations)?.includes(id);
    const next = hover ? 'hover' : wanted ? 'stage' : null;
    if (next !== h) setH(next);
  });
  return h;
}

function Station({ session, def }: { session: BenchSession; def: StationDef }) {
  const [obj, setObj] = useState<THREE.Object3D | null>(null);
  useEffect(() => (obj ? session.register(obj, { type: 'station', id: def.id }) : undefined), [obj, session, def.id]);
  const h = useHighlight(session, 'station', def.id);
  const ring = Math.min(def.radius, 1.5);
  return (
    <>
      <StationModel def={def} pickRef={setObj} />
      {h && <Ring at={[def.pos[0], 0, def.pos[2]]} radius={ring} colour={h === 'hover' ? '#9fe3a7' : '#7fd1e8'} pulse={h === 'stage'} />}
    </>
  );
}

function RestingTool({ session, def }: { session: BenchSession; def: ToolDef }) {
  const g = useRef<THREE.Group>(null);
  const h = useHighlight(session, 'tool', def.id);
  useFrame(() => {
    if (g.current) g.current.visible = session.isResting(def.id);
  });
  const yaw = def.homeYaw ?? 0;
  // Lie the tool on the table, pointing right, centred on its home spot.
  const half = (def.len * HAND_SCALE) / 2;
  return (
    <>
      <group ref={g} position={[def.home[0] - Math.cos(yaw) * half, def.home[1] + 0.07, def.home[2] + Math.sin(yaw) * half]} rotation={[0, yaw, Math.PI / 2]} scale={HAND_SCALE}>
        <ToolModel def={def} />
      </group>
      {h && <Ring at={[def.home[0], def.home[1], def.home[2]]} radius={0.5} colour={h === 'hover' ? '#9fe3a7' : '#7fd1e8'} pulse={h === 'stage'} />}
    </>
  );
}

function HeldTool({ session, side, ghost }: { session: BenchSession; side: Side; ghost?: boolean }) {
  const [tool, setTool] = useState<string | null>(null);
  useFrame(() => {
    const h = ghost ? session.ghosts[side] : session.hands[side];
    if (h.tool !== tool) setTool(h.tool);
  });
  const def = tool ? session.bench.tool(tool) : null;
  if (!def) return null;
  return (
    <group position={GRIP.toArray()} rotation={[def.pitch ?? 0.35, 0, 0]}>
      <ToolModel def={def} ghost={ghost} />
    </group>
  );
}

function Hands({ session }: { session: BenchSession }) {
  const ghost = session.mode.kind === 'learn' && !!session.mode.from;
  return (
    <>
      {(['left', 'right'] as Side[]).map((side) => (
        <RobotHand key={side} side={side} scale={HAND_SCALE} getPose={() => session.hands[side].pose}>
          <HeldTool session={session} side={side} />
        </RobotHand>
      ))}
      {ghost &&
        (['left', 'right'] as Side[]).map((side) => (
          <RobotHand key={`g-${side}`} side={side} ghost scale={HAND_SCALE} getPose={() => session.ghosts[side].pose}>
            <HeldTool session={session} side={side} ghost />
          </RobotHand>
        ))}
    </>
  );
}

function Particles({ session }: { session: BenchSession }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geom = useMemo(() => new THREE.BoxGeometry(1, 0.5, 1.3), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.7, emissiveIntensity: 0.4 }), []);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    session.particles.forEach((p, i) => {
      q.setFromEuler(new THREE.Euler(p.life * 9, p.life * 7, 0));
      const s = p.size * (p.gravity < 0 ? 1 + (1 - p.life / p.max) * 3 : 1);
      mtx.compose(p.p, q, new THREE.Vector3(s, s, s));
      m.setMatrixAt(i, mtx);
      m.setColorAt(i, p.color);
    });
    m.count = session.particles.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geom, mat, 240]} frustumCulled={false} />;
}

function AimMarker({ session }: { session: BenchSession }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthTest: false }), []);
  useFrame(() => {
    const m = ref.current;
    const aim = session.aim;
    if (!m) return;
    m.visible = !!aim && session.mode.kind !== 'replay';
    if (!aim) return;
    m.position.copy(aim.point).addScaledVector(aim.normal, 0.02);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), aim.normal);
    mat.color.set(useBenchUi.getState().squeezing ? '#9fe3a7' : '#ffffff');
  });
  return (
    <mesh ref={ref} material={mat} renderOrder={10}>
      <ringGeometry args={[0.05, 0.085, 24]} />
    </mesh>
  );
}

export function BenchStage({ session }: { session: BenchSession }) {
  const def = session.def;
  const wps = useMemo(() => [...session.bench.workpieces.keys()], [session]);
  return (
    <Canvas
      shadows="percentage"
      camera={{ fov: 40, near: 0.1, far: 80, position: def.views.main.pos }}
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true }}
      onCreated={({ gl }) => (session.canvas = gl.domElement)}
    >
      <color attach="background" args={['#14191b']} />
      <fog attach="fog" args={['#14191b', 18, 34]} />
      <CameraRig session={session} />
      <Ticker session={session} />
      <Reflections />
      <hemisphereLight args={['#f6e7cf', '#1b2326', 0.65]} />
      <directionalLight
        position={[4, 10, 6]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
      />
      <pointLight position={[-5, 4, 4]} intensity={5} color="#7fd1e8" distance={14} />
      <Table />
      {def.stations.map((st) => (
        <Station key={st.id} session={session} def={st} />
      ))}
      {def.tools.map((t) => (
        <RestingTool key={t.id} session={session} def={t} />
      ))}
      {wps.map((id) => (
        <WorkpieceView key={id} session={session} id={id} />
      ))}
      <Hands session={session} />
      <Particles session={session} />
      <AimMarker session={session} />
    </Canvas>
  );
}
