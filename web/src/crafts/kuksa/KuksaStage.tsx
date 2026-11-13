import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RobotHand } from '../../robot/RobotHand';
import { HAND_SCALE, useKuksaUi, type KuksaSession } from './session';
import { CELLS, cellToLocal, DIM, idx, VOXEL, type VoxelGrid } from './voxels';

const VIEWS = {
  side: { pos: new THREE.Vector3(0.6, 3.4, 9.2), look: new THREE.Vector3(0, -0.3, 0) },
  top: { pos: new THREE.Vector3(0, 9.6, 2.6), look: new THREE.Vector3(0, 0, 0) },
};

function CameraRig() {
  const { camera } = useThree();
  const look = useRef(VIEWS.side.look.clone());
  useFrame((_, dt) => {
    const v = VIEWS[useKuksaUi.getState().view];
    const k = 1 - Math.exp(-dt * 3);
    camera.position.lerp(v.pos, k);
    look.current.lerp(v.look, k);
    camera.lookAt(look.current);
  });
  return null;
}

const BARK = new THREE.Color('#6e5440');
const BIRCH = new THREE.Color('#ecd8ad');
const WASTE = new THREE.Color('#b9875a');

function exposed(g: VoxelGrid, x: number, y: number, z: number) {
  return !g.get(x + 1, y, z) || !g.get(x - 1, y, z) || !g.get(x, y + 1, z) || !g.get(x, y - 1, z) || !g.get(x, y, z + 1) || !g.get(x, y, z - 1);
}

function Voxels({ session }: { session: KuksaSession }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  const last = useRef<{ grid: VoxelGrid | null; version: number; guide: boolean }>({ grid: null, version: -1, guide: true });
  const noise = useMemo(() => Float32Array.from({ length: CELLS }, () => Math.random()), []);
  const geom = useMemo(() => new THREE.BoxGeometry(VOXEL * 0.98, VOXEL * 0.98, VOXEL * 0.98), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.75 }), []);

  useFrame(() => {
    if (group.current) group.current.rotation.y = session.yaw;
    const m = mesh.current;
    if (!m) return;
    const g = session.grid;
    const guide = useKuksaUi.getState().guide && !!session.target;
    const l = last.current;
    if (l.grid === g && l.version === g.version && l.guide === guide) return;
    last.current = { grid: g, version: g.version, guide };

    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    let n = 0;
    for (let z = 0; z < DIM.z; z++)
      for (let y = 0; y < DIM.y; y++)
        for (let x = 0; x < DIM.x; x++) {
          const i = idx(x, y, z);
          if (!g.data[i] || !exposed(g, x, y, z)) continue;
          const [px, py, pz] = cellToLocal(x, y, z);
          mtx.makeTranslation(px, py, pz);
          m.setMatrixAt(n, mtx);
          const surface = x === 0 || z === 0 || y === 0 || x === DIM.x - 1 || z === DIM.z - 1 || y === DIM.y - 1;
          const waste = guide && session.target && !session.target.data[i];
          col.copy(surface && y !== DIM.y - 1 ? BARK : waste ? WASTE : BIRCH);
          // Grain: gentle banding by height plus per-voxel noise.
          const grain = 0.92 + 0.06 * Math.sin(y * 1.7 + x * 0.25) + 0.06 * noise[i];
          col.multiplyScalar(grain);
          m.setColorAt(n, col);
          n++;
        }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[geom, mat, CELLS]} castShadow receiveShadow />
    </group>
  );
}

/** X-ray outline of the target cup, drawn through the wood so you can see what to keep. */
function TargetGhost({ session }: { session: KuksaSession }) {
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geom = useMemo(() => new THREE.BoxGeometry(VOXEL, VOXEL, VOXEL), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7fd1e8', transparent: true, opacity: 0.09, depthTest: false, depthWrite: false }), []);
  const built = useRef<VoxelGrid | null>(null);
  useFrame(() => {
    const g = group.current;
    const m = mesh.current;
    const t = session.target;
    if (!g || !m) return;
    g.rotation.y = session.yaw;
    g.visible = !!t && useKuksaUi.getState().guide && useKuksaUi.getState().phase === 'carving';
    if (!t || built.current === t) return;
    built.current = t;
    const mtx = new THREE.Matrix4();
    let n = 0;
    for (let z = 0; z < DIM.z; z++)
      for (let y = 0; y < DIM.y; y++)
        for (let x = 0; x < DIM.x; x++) {
          if (!t.data[idx(x, y, z)] || !exposed(t, x, y, z)) continue;
          m.setMatrixAt(n++, mtx.makeTranslation(...cellToLocal(x, y, z)));
        }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[geom, mat, CELLS]} renderOrder={5} />
    </group>
  );
}

function Chips({ session }: { session: KuksaSession }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geom = useMemo(() => new THREE.BoxGeometry(0.05, 0.02, 0.07), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e7cf9f', roughness: 0.8 }), []);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    session.chips.forEach((c, i) => {
      q.setFromEuler(new THREE.Euler(c.life * 9, c.life * 7, 0));
      mtx.compose(c.p, q, new THREE.Vector3(1, 1, 1));
      m.setMatrixAt(i, mtx);
    });
    m.count = session.chips.length;
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geom, mat, 120]} />;
}

function TipMarker({ session }: { session: KuksaSession }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthTest: false }), []);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    m.visible = !!session.livePose && session.tipOnWood && session.mode.kind !== 'replay';
    m.position.copy(session.tip);
    mat.color.set(useKuksaUi.getState().engaged ? '#9fe3a7' : '#ffffff');
  });
  return (
    <mesh ref={ref} material={mat} renderOrder={10}>
      <sphereGeometry args={[0.04, 12, 8]} />
    </mesh>
  );
}

/** Puukko in the robot's palm frame (right hand, scale 1). */
function Puukko({ ghost }: { ghost?: boolean }) {
  const handle = ghost ? { color: '#7fd1e8', transparent: true, opacity: 0.25 } : { color: '#c9a47a', roughness: 0.6 };
  const blade = ghost ? { color: '#7fd1e8', transparent: true, opacity: 0.25 } : { color: '#c9d1d6', metalness: 0.95, roughness: 0.2 };
  return (
    <group position={[0, -0.33, -0.6]}>
      <mesh position={[-0.3, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.1, 0.12, 0.62, 12]} />
        <meshStandardMaterial {...handle} />
      </mesh>
      <mesh position={[-0.63, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.13, 0.13, 0.05, 12]} />
        <meshStandardMaterial color={ghost ? '#7fd1e8' : '#8a5a33'} transparent={ghost} opacity={ghost ? 0.25 : 1} />
      </mesh>
      <mesh position={[-0.96, 0.01, 0]}>
        <boxGeometry args={[0.62, 0.14, 0.03]} />
        <meshStandardMaterial {...blade} />
      </mesh>
      <mesh position={[-1.3, -0.01, 0]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.1, 0.1, 0.028]} />
        <meshStandardMaterial {...blade} />
      </mesh>
    </group>
  );
}

function Ticker({ session }: { session: KuksaSession }) {
  const { camera } = useThree();
  useFrame((_, delta) => session.tick(Math.min(250, delta * 1000), camera));
  return null;
}

export function KuksaStage({ session }: { session: KuksaSession }) {
  return (
    <Canvas shadows="percentage" camera={{ fov: 40, near: 0.1, far: 60, position: VIEWS.side.pos.toArray() }} dpr={[1, 2]}>
      <color attach="background" args={['#14191b']} />
      <fog attach="fog" args={['#14191b', 10, 20]} />
      <CameraRig />
      <Ticker session={session} />
      <hemisphereLight args={['#f6e7cf', '#1b2326', 0.8]} />
      <directionalLight position={[3, 7, 4]} intensity={1.7} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-3, 2, -2]} intensity={5} color="#3e7c8c" />
      {/* Chopping-block stump */}
      <mesh position={[0, -1.2 - 0.5, 0]} receiveShadow>
        <cylinderGeometry args={[2.6, 2.8, 1, 32]} />
        <meshStandardMaterial color="#5b4636" roughness={0.9} />
      </mesh>
      <mesh position={[0, -1.19, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[0.2, 2.6, 48, 6]} />
        <meshStandardMaterial color="#a8865f" roughness={0.85} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.2, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#2a2420" roughness={0.95} />
      </mesh>
      {/* Block is centred at the origin; the session's aiming maths relies on it. */}
      <Voxels session={session} />
      <TargetGhost session={session} />
      <Chips session={session} />
      <TipMarker session={session} />
      {session.mode.kind === 'lesson' && session.mode.fromCreation && (
        <RobotHand side="right" ghost scale={HAND_SCALE} getPose={() => session.ghostPose}>
          <Puukko ghost />
        </RobotHand>
      )}
      <RobotHand side={session.side} scale={HAND_SCALE} getPose={() => session.livePose}>
        <Puukko />
      </RobotHand>
    </Canvas>
  );
}

