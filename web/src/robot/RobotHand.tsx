// Procedural robot hand modelled on the Inspire RH56 layout: four fingers and
// a thumb. Shown one to one with your hand when the pose carries its shape
// (every finger bone as measured; see handShape.ts); otherwise driven by the 6
// actuator values, with each finger's three links coupled.
//
// Canonical pose: palm facing down (-Y), fingers pointing away from the viewer
// (-Z), right-hand thumb on the -X side. A left hand is the mirror image.

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Side } from '../rokoko/types';
import type { HandShape } from './handShape';
import type { Dof6 } from './retarget';

export interface RobotPose {
  dof: Dof6;
  /** World position of the wrist. */
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  /** The human hand's exact finger shape: when present, the fingers show it as is. */
  shape?: HandShape;
}

interface Props {
  side: Side;
  getPose: () => RobotPose | undefined;
  ghost?: boolean;
  /** Draw an arm from the wrist up to this world point. */
  anchor?: THREE.Vector3;
  /** Receives fingertip objects [thumb, index, middle, ring, little] for world-position queries. */
  tipsRef?: React.MutableRefObject<THREE.Object3D[]>;
  /** Rendered in the palm frame (e.g. a held tool). */
  children?: ReactNode;
  scale?: number;
}

export const FINGER_X = [-0.3, -0.1, 0.1, 0.3];
/**
 * Knuckle positions (index..little). Like a human hand they form an arch: the
 * middle knuckle furthest forward, the little finger's lower and further back,
 * so the same joint angles put the robot's fingertips where a hand's would be.
 */
export const FINGER_BASE: [number, number, number][] = [
  [-0.3, 0, -0.53],
  [-0.1, 0.005, -0.55],
  [0.1, -0.012, -0.52],
  [0.3, -0.05, -0.46],
];
export const FINGER_LEN: [number, number][] = [
  [0.42, 0.34],
  [0.46, 0.36],
  [0.43, 0.34],
  [0.36, 0.28],
];
/** A finger's three links: proximal, middle and distal (the last two share the old distal length). */
export const fingerLinks = (i: number): [number, number, number] => [FINGER_LEN[i][0], FINGER_LEN[i][1] * 0.58, FINGER_LEN[i][1] * 0.42];
/** With only actuator values, how much each link bends per unit of curl. */
export const CURL_GAIN: [number, number, number] = [1.45, 1.1, 0.8];
/** Thumb: mounted under the palm's index side, angled forwards like a human thumb. */
export const THUMB_BASE: [number, number, number] = [-0.38, -0.06, -0.25];
export const THUMB_YAW = 0.5;
export const THUMB_LEN: [number, number] = [0.42, 0.34];

function useMaterials(ghost: boolean) {
  return useMemo(() => {
    if (ghost) {
      const g = new THREE.MeshStandardMaterial({ color: '#7fd1e8', transparent: true, opacity: 0.28, depthWrite: false, emissive: '#3e7c8c', emissiveIntensity: 0.6 });
      return { shell: g, joint: g, pad: g, accent: g };
    }
    return {
      shell: new THREE.MeshStandardMaterial({ color: '#d9d4cc', metalness: 0.35, roughness: 0.4 }),
      joint: new THREE.MeshStandardMaterial({ color: '#2f6b3a', metalness: 0.8, roughness: 0.3 }),
      pad: new THREE.MeshStandardMaterial({ color: '#2a2e31', metalness: 0.1, roughness: 0.85 }),
      accent: new THREE.MeshStandardMaterial({ color: '#3a4146', metalness: 0.6, roughness: 0.35 }),
    };
  }, [ghost]);
}

function Link({ length, width, mat, padMat, tip }: { length: number; width: number; mat: THREE.Material; padMat: THREE.Material; tip?: boolean }) {
  return (
    <group>
      <mesh material={mat} position={[0, 0, -length / 2]} castShadow>
        <boxGeometry args={[width, width * 0.9, length * 0.92]} />
      </mesh>
      <mesh material={padMat} position={[0, -width * 0.42, -length / 2]}>
        <boxGeometry args={[width * 0.8, width * 0.15, length * 0.7]} />
      </mesh>
      {tip && (
        <mesh material={padMat} position={[0, 0, -length]}>
          <sphereGeometry args={[width * 0.52, 16, 12]} />
        </mesh>
      )}
    </group>
  );
}

export function RobotHand({ side, getPose, ghost = false, anchor, tipsRef, children, scale = 1 }: Props) {
  const m = useMaterials(ghost);
  const root = useRef<THREE.Group>(null);
  const prox = useRef<(THREE.Group | null)[]>([]);
  const dist = useRef<(THREE.Group | null)[]>([]);
  const thumbRot = useRef<THREE.Group>(null);
  const thumb1 = useRef<THREE.Group>(null);
  const thumb2 = useRef<THREE.Group>(null);
  const thumbYaw = useRef<THREE.Group>(null);
  const mid = useRef<(THREE.Group | null)[]>([]);
  const tips = useRef<(THREE.Object3D | null)[]>([]);
  const arm = useRef<THREE.Mesh>(null);
  const armTop = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const pose = getPose();
    const g = root.current;
    if (!g) return;
    g.visible = !!pose;
    if (arm.current) arm.current.visible = !!pose;
    if (!pose) return;
    g.position.copy(pose.position);
    g.quaternion.copy(pose.rotation);
    const d = pose.dof;
    const s = pose.shape;
    for (let i = 0; i < 4; i++) {
      const links = [prox.current[i], mid.current[i], dist.current[i]];
      if (s) links.forEach((l, k) => l?.quaternion.copy(s.fingers[i][k]));
      else links.forEach((l, k) => l?.rotation.set(-d[i + 2] * CURL_GAIN[k], 0, 0));
    }
    if (s) {
      thumbRot.current?.quaternion.copy(s.thumb[0]);
      thumbYaw.current?.rotation.set(0, 0, 0);
      thumb1.current?.rotation.set(0, 0, 0);
      thumb2.current?.quaternion.copy(s.thumb[1]);
    } else {
      thumbRot.current?.rotation.set(0, 0, d[0] * 1.15);
      thumbYaw.current?.rotation.set(0, THUMB_YAW, 0);
      thumb1.current?.rotation.set(-d[1] * 1.0, 0, 0);
      thumb2.current?.rotation.set(-d[1] * 1.4, 0, 0);
    }
    if (tipsRef) tipsRef.current = tips.current.filter(Boolean) as THREE.Object3D[];

    if (anchor && arm.current) {
      armTop.set(0, 0.15, 0.55).multiplyScalar(scale).applyQuaternion(g.quaternion).add(g.position);
      const mid = armTop.clone().add(anchor).multiplyScalar(0.5);
      const dir = anchor.clone().sub(armTop);
      arm.current.position.copy(mid);
      arm.current.scale.set(1, dir.length(), 1);
      arm.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    }
  });

  const mirror = side === 'left' ? -1 : 1;
  return (
    <>
      <group ref={root} scale={[mirror * scale, scale, scale]}>
        {/* Wrist flange + forearm stub */}
        <mesh material={m.joint} position={[0, 0.02, 0.62]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.26, 0.26, 0.12, 24]} />
        </mesh>
        <mesh material={m.accent} position={[0, 0.02, 0.85]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.22, 0.24, 0.4, 24]} />
        </mesh>
        {/* Palm */}
        <mesh material={m.shell} castShadow>
          <boxGeometry args={[0.86, 0.26, 1.06]} />
        </mesh>
        <mesh material={m.pad} position={[0, -0.14, -0.05]}>
          <boxGeometry args={[0.74, 0.04, 0.8]} />
        </mesh>
        <mesh material={m.accent} position={[0, 0.135, 0.05]}>
          <boxGeometry args={[0.5, 0.02, 0.6]} />
        </mesh>
        {/* Fingers */}
        {FINGER_BASE.map((base, i) => (
          <group key={i} position={base}>
            <mesh material={m.joint} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.07, 0.07, 0.17, 16]} />
            </mesh>
            <group ref={(el) => void (prox.current[i] = el)}>
              <Link length={FINGER_LEN[i][0]} width={0.15} mat={m.shell} padMat={m.pad} />
              <group position={[0, 0, -fingerLinks(i)[0]]}>
                <mesh material={m.joint} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.062, 0.062, 0.15, 16]} />
                </mesh>
                <group ref={(el) => void (mid.current[i] = el)}>
                  <Link length={fingerLinks(i)[1]} width={0.14} mat={m.shell} padMat={m.pad} />
                  <group position={[0, 0, -fingerLinks(i)[1]]}>
                    <mesh material={m.joint} rotation={[0, 0, Math.PI / 2]}>
                      <cylinderGeometry args={[0.058, 0.058, 0.14, 16]} />
                    </mesh>
                    <group ref={(el) => void (dist.current[i] = el)}>
                      <Link length={fingerLinks(i)[2]} width={0.13} mat={m.shell} padMat={m.pad} tip />
                      <object3D ref={(el) => void (tips.current[i + 1] = el)} position={[0, -0.05, -fingerLinks(i)[2]]} />
                    </group>
                  </group>
                </group>
              </group>
            </group>
          </group>
        ))}
        {/* Thumb: rotate about the palm's long axis, then bend */}
        <group position={THUMB_BASE}>
          <group ref={thumbRot}>
            <mesh material={m.joint}>
              <sphereGeometry args={[0.1, 16, 12]} />
            </mesh>
            <group ref={thumbYaw} rotation={[0, THUMB_YAW, 0]}>
              <group ref={thumb1}>
                <Link length={THUMB_LEN[0]} width={0.16} mat={m.shell} padMat={m.pad} />
                <group position={[0, 0, -THUMB_LEN[0]]}>
                  <mesh material={m.joint} rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[0.068, 0.068, 0.16, 16]} />
                  </mesh>
                  <group ref={thumb2}>
                    <Link length={THUMB_LEN[1]} width={0.14} mat={m.shell} padMat={m.pad} tip />
                    <object3D ref={(el) => void (tips.current[0] = el)} position={[0, -0.05, -THUMB_LEN[1]]} />
                  </group>
                </group>
              </group>
            </group>
          </group>
        </group>
        {children}
      </group>
      {anchor && (
        <mesh ref={arm} material={m.accent}>
          <cylinderGeometry args={[0.12 * scale, 0.16 * scale, 1, 16]} />
        </mesh>
      )}
    </>
  );
}
