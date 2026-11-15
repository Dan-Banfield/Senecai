// The ocarina scene: the 12-hole alto model (web/public/crafts/ocarina.stl)
// held flute-style by both robot hands. The wrists never move; each digit is
// posed so its pad lands on its real hole when covered (stageGeometry.ts).
// Covered holes glow, and the clay warms faintly while a note sounds.
//
// Everything per frame comes from getView(), read inside useFrame (never React
// state), sampled once per frame and shared by the hands, holes and body.

import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, type JSX } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RobotHand, type RobotPose } from '../../robot/RobotHand';
import type { Dof6 } from '../../robot/retarget';
import type { Side } from '../../rokoko/types';
import { HOLD_POSES, holdPose, HOLE_NORMALS, HOLE_POSITIONS, HOLE_RADII, MODEL_POSITION, MODEL_ROTATION, MODEL_SCALE, MODEL_URL } from './stageGeometry';
import { HOLES, type OcarinaView } from './types';

const BACKGROUND = '#efe3c6';
const COVERED = new THREE.Color('#5fbf6e');
const SIDES: Side[] = ['left', 'right'];
/** Where the camera looks: the middle of the instrument, a touch towards the player. */
const TARGET = new THREE.Vector3(0, -0.15, 0.05);

type ViewSampler = () => OcarinaView;

/** One getView() per rendered frame, however many components ask for it. */
function useViewSampler(getView: () => OcarinaView): ViewSampler {
  const latest = useRef(getView);
  useEffect(() => {
    latest.current = getView;
  }, [getView]);
  const clock = useThree((s) => s.clock);
  return useMemo(() => {
    let stamp = NaN;
    let view: OcarinaView | undefined;
    return () => {
      if (!view || clock.elapsedTime !== stamp) {
        stamp = clock.elapsedTime;
        view = latest.current();
      }
      return view;
    };
  }, [clock]);
}

function CameraRig() {
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  useEffect(() => {
    // Looking down over the player's shoulder onto the finger holes.
    camera.position.set(0.2, 3.7, 1.55);
    camera.lookAt(TARGET);
    if (camera instanceof THREE.PerspectiveCamera) {
      // Keep both hands (about 2.4 units across) in frame on narrow screens.
      const aspect = width / Math.max(1, height);
      const dist = camera.position.distanceTo(TARGET);
      camera.fov = Math.max(38, THREE.MathUtils.radToDeg(2 * Math.atan(1.25 / dist / aspect)));
      camera.updateProjectionMatrix();
    }
  }, [camera, width, height]);
  return null;
}

function Reflections() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.45;
    return () => {
      scene.environment = null;
      env.dispose();
      pm.dispose();
    };
  }, [gl, scene]);
  return null;
}

/** Orientation whose +Z is `normal`. */
function surfaceFrame(normal: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
}

/** A soft disc over one hole that glows green while it is covered. */
function HoleGlow({ index, sample }: { index: number; sample: ViewSampler }) {
  const { position, rotation } = useMemo(
    () => ({ position: HOLE_POSITIONS[index].clone().addScaledVector(HOLE_NORMALS[index], 0.004), rotation: surfaceFrame(HOLE_NORMALS[index]) }),
    [index],
  );
  const r = HOLE_RADII[index];
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: COVERED, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const glow = useRef(0);
  useFrame((_, delta) => {
    glow.current = THREE.MathUtils.damp(glow.current, sample().holes[index] ? 1 : 0, 18, delta);
    mat.opacity = 0.12 + 0.68 * glow.current;
  });
  return (
    <mesh position={position} quaternion={rotation} material={mat} renderOrder={1}>
      <ringGeometry args={[r * 1.05, r * 1.6, 40]} />
    </mesh>
  );
}

/** The STL, merged so its normals come out smooth. */
function useOcarinaGeometry(): THREE.BufferGeometry {
  const raw = useLoader(STLLoader, MODEL_URL);
  const geo = useMemo(() => {
    const g = raw.clone();
    g.deleteAttribute('normal');
    const merged = mergeVertices(g, 1e-3);
    merged.computeVertexNormals();
    g.dispose();
    return merged;
  }, [raw]);
  useEffect(() => () => geo.dispose(), [geo]);
  return geo;
}

function Ocarina({ sample }: { sample: ViewSampler }) {
  const geometry = useOcarinaGeometry();
  const clay = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#b5643b',
        roughness: 0.42,
        clearcoat: 0.6,
        clearcoatRoughness: 0.3,
        emissive: new THREE.Color('#ff8a3d'),
        emissiveIntensity: 0,
      }),
    [],
  );
  useEffect(() => () => clay.dispose(), [clay]);
  const sounding = useRef(0);
  useFrame(({ clock }, delta) => {
    sounding.current = THREE.MathUtils.damp(sounding.current, sample().midi !== null ? 1 : 0, 10, delta);
    const s = sounding.current;
    clay.emissiveIntensity = s * (0.05 + 0.025 * Math.sin(clock.elapsedTime * 6));
  });
  return (
    <group>
      <mesh geometry={geometry} material={clay} position={MODEL_POSITION} quaternion={MODEL_ROTATION} scale={MODEL_SCALE} castShadow receiveShadow />
      {HOLES.map((h, i) => (
        <HoleGlow key={h.id} index={i} sample={sample} />
      ))}
    </group>
  );
}

function Hands({ sample }: { sample: ViewSampler }) {
  // One reusable pose per side; holdPose writes the digits' shape into it each frame.
  const poses = useMemo(() => {
    const make = (side: Side): RobotPose => ({ dof: [0, 0, 0, 0, 0, 0] as Dof6, position: HOLD_POSES[side].position, rotation: HOLD_POSES[side].rotation });
    return { left: make('left'), right: make('right') };
  }, []);
  const getters = useMemo(
    () =>
      Object.fromEntries(
        SIDES.map((side) => [
          side,
          () => {
            const view = sample();
            const dof = view.dof[side];
            return dof ? holdPose(side, dof, view.holes, poses[side]) : undefined;
          },
        ]),
      ) as Record<Side, () => RobotPose | undefined>,
    [sample, poses],
  );
  return (
    <>
      {SIDES.map((side) => (
        <RobotHand key={side} side={side} getPose={getters[side]} />
      ))}
    </>
  );
}

function Scene({ getView }: { getView: () => OcarinaView }) {
  const sample = useViewSampler(getView);
  return (
    <>
      <color attach="background" args={[BACKGROUND]} />
      <fog attach="fog" args={[BACKGROUND, 5, 12]} />
      <CameraRig />
      <Reflections />
      <hemisphereLight args={['#fff6e6', '#c9b48d', 0.7]} />
      <directionalLight
        position={[1.6, 4.5, 2.6]}
        intensity={2.3}
        color="#fff3e2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={2}
        shadow-camera-bottom={-2}
        shadow-camera-near={0.5}
        shadow-camera-far={10}
      />
      <pointLight position={[-2.2, 1.6, 1.8]} intensity={4} color="#ffd6a3" distance={8} />
      <pointLight position={[1.2, 1.2, -2.4]} intensity={3} color="#9fc6d4" distance={7} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.7, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#e5d6b4" roughness={0.92} />
      </mesh>
      <Suspense fallback={null}>
        <Ocarina sample={sample} />
      </Suspense>
      <Hands sample={sample} />
    </>
  );
}

export function OcarinaStage({ getView }: { getView: () => OcarinaView }): JSX.Element {
  return (
    <Canvas shadows="percentage" dpr={[1, 2]} camera={{ fov: 38, near: 0.05, far: 40, position: [0.2, 3.7, 1.55] }}>
      <Scene getView={getView} />
    </Canvas>
  );
}
