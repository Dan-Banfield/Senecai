import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RobotHand } from '../../robot/RobotHand';
import { installAudioUnlock } from './audio';
import { STRINGS } from './music';
import { NOTE_SPEED, STRING_Y, type KanteleSession } from './session';

const STRING_NEAR = 1.7;
const STRING_FAR = -4.6;
const NOTE_POOL = 32;
const NOTE_COLORS = ['#e9b872', '#9ad1c3', '#f2ede4', '#b7c4e8', '#e8a0a0'];
// Off-screen to the front-right, so the arm never crosses the strings.
const ARM_ANCHOR = new THREE.Vector3(5.5, 3.2, 5.5);

function CameraRig() {
  const { camera } = useThree();
  useEffect(() => {
    // Three-quarter view from above-right, so the fingers and strings are both visible.
    camera.position.set(2.5, 4.6, 4.3);
    camera.lookAt(-0.4, 0.1, -1.1);
  }, [camera]);
  return null;
}

function KanteleBody({ mirror }: { mirror: number }) {
  const geom = useMemo(() => {
    // Wing-shaped soundbox, drawn in the XY plane (y = -z), then laid flat.
    const s = new THREE.Shape();
    s.moveTo(-1.5, -STRING_NEAR - 0.25);
    s.lineTo(0.75, -STRING_NEAR - 0.1);
    s.quadraticCurveTo(0.9, 0, 0.7, -STRING_FAR + 0.2);
    s.quadraticCurveTo(0.2, -STRING_FAR + 1.0, -0.6, -STRING_FAR + 0.35);
    s.quadraticCurveTo(-1.35, -1.5, -1.5, -STRING_NEAR - 0.25);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 });
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#b07a4a', roughness: 0.55, metalness: 0.05 }), []);
  const top = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d7a86e', roughness: 0.5 }), []);
  return (
    <group scale={[mirror, 1, 1]} position={[0, STRING_Y - 0.5, 0]}>
      <mesh geometry={geom} material={wood} receiveShadow castShadow />
      {/* Soundboard inlay */}
      <mesh material={top} position={[-0.35, 0.39, -1.3]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1.7, 4.6]} />
      </mesh>
      {/* Carved sun motif */}
      <mesh position={[-0.35, 0.4, -2.3]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.18, 0.24, 24]} />
        <meshStandardMaterial color="#7a4b28" />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} position={[-0.35 + Math.cos((i / 8) * Math.PI * 2) * 0.33, 0.4, -2.3 + Math.sin((i / 8) * Math.PI * 2) * 0.33]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.04, 10]} />
          <meshStandardMaterial color="#7a4b28" />
        </mesh>
      ))}
      {/* Metal bar (varras) at the far end */}
      <mesh position={[-0.35, 0.5, STRING_FAR + 0.15]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.035, 0.035, 2.1, 12]} />
        <meshStandardMaterial color="#8d969c" metalness={0.9} roughness={0.25} />
      </mesh>
    </group>
  );
}

function Strings({ session }: { session: KanteleSession }) {
  const strings = useRef<(THREE.Mesh | null)[]>([]);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const pins = useRef<(THREE.Mesh | null)[]>([]);
  const notes = useRef<(THREE.Mesh | null)[]>([]);
  const mats = useMemo(() => STRINGS.map(() => new THREE.MeshStandardMaterial({ color: '#d8d2c4', metalness: 0.9, roughness: 0.2, emissive: '#e9b872', emissiveIntensity: 0 })), []);
  const ringMats = useMemo(() => NOTE_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35 })), []);
  const noteMats = useMemo(() => NOTE_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9 })), []);
  const hitMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#9fe3a7', emissive: '#9fe3a7', emissiveIntensity: 1.2, transparent: true }), []);
  const missMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e05b5b', emissive: '#e05b5b', emissiveIntensity: 0.6, transparent: true, opacity: 0.6 }), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (let s = 0; s < 5; s++) {
      const st = session.strings[s];
      const m = strings.current[s];
      if (m) {
        m.position.x = session.stringX[s] + Math.sin(t * 95 + s) * st.amp * 0.018;
        mats[s].emissiveIntensity = st.glow * 1.4;
      }
      const r = rings.current[s];
      if (r) {
        r.position.set(session.stringX[s], STRING_Y, session.hitZ[s]);
        // Brighten the ring if a note on this string is close.
        let near = 0;
        for (const n of session.notes) {
          if (n.string !== s || n.result) continue;
          const dt = Math.abs(n.t - session.songTime);
          if (dt < 600) near = Math.max(near, 1 - dt / 600);
        }
        ringMats[s].opacity = 0.25 + near * 0.6 + st.glow * 0.3;
        r.scale.setScalar(1 + st.glow * 0.4);
      }
      const p = pins.current[s];
      if (p) p.position.set(session.stringX[s], STRING_Y + 0.02, STRING_FAR + 0.45);
    }
    // Notes travel along their string towards the hit ring.
    let k = 0;
    for (const n of session.notes) {
      if (k >= NOTE_POOL) break;
      const ahead = n.t - session.songTime;
      if (ahead > 2600 || ahead < -400) continue;
      if (n.result && ahead < -250) continue;
      const mesh = notes.current[k++];
      if (!mesh) continue;
      mesh.visible = true;
      const z = session.hitZ[n.string] - (ahead / 1000) * NOTE_SPEED;
      mesh.position.set(session.stringX[n.string], STRING_Y + 0.06, Math.min(z, session.hitZ[n.string] + 0.4));
      mesh.material = n.result === 'miss' ? missMat : n.result ? hitMat : noteMats[n.string];
      mesh.scale.setScalar(n.result && n.result !== 'miss' ? 1.6 : 1);
    }
    for (; k < NOTE_POOL; k++) if (notes.current[k]) notes.current[k]!.visible = false;
  });

  return (
    <group>
      {STRINGS.map((_, s) => (
        <group key={s}>
          <mesh ref={(el) => void (strings.current[s] = el)} material={mats[s]} position={[0, STRING_Y, (STRING_NEAR + STRING_FAR) / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.012 + (4 - s) * 0.003, 0.012 + (4 - s) * 0.003, STRING_NEAR - STRING_FAR, 6]} />
          </mesh>
          <mesh ref={(el) => void (rings.current[s] = el)} material={ringMats[s]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.07, 0.11, 24]} />
          </mesh>
          <mesh ref={(el) => void (pins.current[s] = el)}>
            <cylinderGeometry args={[0.035, 0.035, 0.14, 10]} />
            <meshStandardMaterial color="#5a3a22" />
          </mesh>
        </group>
      ))}
      {Array.from({ length: NOTE_POOL }, (_, i) => (
        <mesh key={i} ref={(el) => void (notes.current[i] = el)} visible={false}>
          <sphereGeometry args={[0.07, 16, 12]} />
        </mesh>
      ))}
    </group>
  );
}

function Ticker({ session }: { session: KanteleSession }) {
  useFrame((_, delta) => session.tick(Math.min(250, delta * 1000)));
  return null;
}

export function KanteleStage({ session, side = 'right' }: { session: KanteleSession; side?: 'left' | 'right' }) {
  const mirror = side === 'left' ? -1 : 1;
  // Free play has no Start button, so unlock audio on the first click/key anywhere.
  useEffect(() => installAudioUnlock(), []);
  return (
    <Canvas shadows="percentage" camera={{ fov: 42, near: 0.1, far: 60 }} dpr={[1, 2]}>
      <color attach="background" args={['#14191b']} />
      <fog attach="fog" args={['#14191b', 9, 18]} />
      <CameraRig />
      <Ticker session={session} />
      <hemisphereLight args={['#f6e7cf', '#1b2326', 0.7]} />
      <directionalLight position={[3, 6, 3]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-2, 2, -3]} intensity={6} color="#3e7c8c" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, STRING_Y - 0.55, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#2a2420" roughness={0.9} />
      </mesh>
      <KanteleBody mirror={mirror} />
      <Strings session={session} />
      <RobotHand side={side} getPose={() => session.ghostPose} ghost />
      <RobotHand side={side} getPose={() => session.livePose} anchor={ARM_ANCHOR} />
    </Canvas>
  );
}
