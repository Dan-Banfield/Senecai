// The piano scene: an upright piano with a two-and-a-half-octave keyboard,
// the score of the song on the music desk, and both robot hands. Keys pivot at
// the back like real ones, by however far a fingertip has pushed them.

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RobotHand } from '../../robot/RobotHand';
import type { Side } from '../../rokoko/types';
import { BLACK_H, KEYBOARD_WIDTH, KEYS, SONG, WHITE_L, type PianoKey } from './keys';
import { FINGER_Z, usePianoUi, type PianoSession } from './session';

const LACQUER = '#141518';

function CameraRig() {
  const { camera } = useThree();
  useEffect(() => {
    // The player's view, from above and behind the hands.
    camera.position.set(0, 6.6, 4.4);
    camera.lookAt(0, 0.1, -0.15);
  }, [camera]);
  return null;
}

function Reflections() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.5;
    return () => {
      scene.environment = null;
      env.dispose();
      pm.dispose();
    };
  }, [gl, scene]);
  return null;
}

function Ticker({ session }: { session: PianoSession }) {
  useFrame((_, delta) => session.tick(delta * 1000));
  return null;
}

/** One key, pivoting about its back edge by however far it is pushed down. */
function Key({ k, i, session }: { k: PianoKey; i: number; session: PianoSession }) {
  const pivot = useRef<THREE.Group>(null);
  const mat = useMemo(
    () =>
      k.black
        ? new THREE.MeshPhysicalMaterial({ color: '#17181b', roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.3 })
        : new THREE.MeshPhysicalMaterial({ color: '#f3efe6', roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
    [k.black],
  );
  const len = k.zFront - k.zBack;
  const reach = k.black ? len - 0.05 : FINGER_Z - k.zBack;
  useFrame(({ clock }) => {
    const g = pivot.current;
    if (!g) return;
    g.rotation.x = session.keys.depth[i] / reach;
    const target = session.target === k.midi;
    const glow = target ? 0.55 + 0.25 * Math.sin(clock.elapsedTime * 5) : session.keys.down[i] ? 0.25 : 0;
    mat.emissive.set(target ? '#3fbf6a' : '#e8b872');
    mat.emissiveIntensity = glow;
  });
  const h = k.black ? 0.2 : 0.22;
  return (
    <group ref={pivot} position={[k.x, 0, k.zBack]}>
      <mesh material={mat} position={[0, k.top - h / 2, len / 2]} castShadow receiveShadow>
        <boxGeometry args={[k.w - (k.black ? 0 : 0.012), h, len - (k.black ? 0 : 0.008)]} />
      </mesh>
    </group>
  );
}

/** The score of the song, drawn on the music desk; the note to play next is highlighted. */
function useScoreTexture() {
  const { canvas, tex } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 560;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return { canvas, tex };
  }, []);
  useEffect(() => {
    const draw = ({ step, phase }: { step: number; phase: string }) => {
      const c = canvas.getContext('2d')!;
      c.fillStyle = '#f5efdf';
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.fillStyle = '#2d2620';
      c.font = 'italic 44px Cormorant Garamond, Georgia, serif';
      c.fillText('Mary Had a Little Lamb', 70, 70);
      const gap = 30;
      const bottom = 300;
      const left = 190;
      const right = canvas.width - 60;
      c.strokeStyle = '#2d2620';
      c.lineWidth = 3;
      for (let l = 0; l < 5; l++) {
        c.beginPath();
        c.moveTo(70, bottom - l * gap);
        c.lineTo(right, bottom - l * gap);
        c.stroke();
      }
      c.font = '170px serif';
      c.fillText('𝄞', 74, bottom + 24);
      const total = SONG.reduce((s, [, b]) => s + b, 0);
      const per = (right - left - 40) / total;
      const stepOf: Record<number, number> = { 60: -2, 62: -1, 64: 0, 65: 1, 67: 2 };
      let beat = 0;
      SONG.forEach(([midi, beats, lyric], i) => {
        const x = left + beat * per + 24;
        const y = bottom - stepOf[midi] * (gap / 2);
        const now = phase !== 'finished' && i === step;
        const colour = now ? '#2f8a4c' : i < step ? '#9c9387' : '#2d2620';
        c.strokeStyle = c.fillStyle = colour;
        if (midi === 60) {
          c.beginPath();
          c.moveTo(x - 30, y);
          c.lineTo(x + 30, y);
          c.stroke();
        }
        c.beginPath();
        c.ellipse(x, y, 17, 12, -0.35, 0, Math.PI * 2);
        if (beats >= 2) {
          c.lineWidth = 4;
          c.stroke();
          c.lineWidth = 3;
        } else c.fill();
        if (beats < 4) {
          c.beginPath();
          c.moveTo(x + 15, y - 4);
          c.lineTo(x + 15, y - 100);
          c.stroke();
        }
        c.font = `${now ? 'bold ' : ''}25px Georgia, serif`;
        c.textAlign = 'center';
        c.fillText(lyric, x, bottom + 110);
        c.textAlign = 'left';
        if (now) {
          c.beginPath();
          c.arc(x, y, 30, 0, Math.PI * 2);
          c.stroke();
        }
        beat += beats;
        if (beat % 4 === 0 && i < SONG.length - 1) {
          c.strokeStyle = '#2d2620';
          c.beginPath();
          c.moveTo(left + beat * per + 4, bottom);
          c.lineTo(left + beat * per + 4, bottom - 4 * gap);
          c.stroke();
        }
      });
      tex.needsUpdate = true;
    };
    draw(usePianoUi.getState());
    return usePianoUi.subscribe((s, p) => (s.step !== p.step || s.phase !== p.phase) && draw(s));
  }, [canvas, tex]);
  return tex;
}

function PianoBody() {
  const lacquer = useMemo(() => new THREE.MeshPhysicalMaterial({ color: LACQUER, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12 }), []);
  const felt = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7b1f24', roughness: 0.95 }), []);
  const score = useScoreTexture();
  const w = KEYBOARD_WIDTH;
  return (
    <group>
      {/* Key bed under the keys */}
      <mesh material={lacquer} position={[0, -0.32, 0.05]} receiveShadow>
        <boxGeometry args={[w + 0.5, 0.18, WHITE_L + 0.5]} />
      </mesh>
      {/* Key slip in front, and the cheek blocks at each end */}
      <mesh material={lacquer} position={[0, -0.12, WHITE_L / 2 + 0.07]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.5, 0.2, 0.12]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={lacquer} position={[s * (w / 2 + 0.13), 0.02, 0.05]} castShadow>
          <boxGeometry args={[0.24, 0.5, WHITE_L + 0.5]} />
        </mesh>
      ))}
      {/* Red felt strip behind the keys, then the fallboard */}
      <mesh material={felt} position={[0, BLACK_H + 0.02, -WHITE_L / 2 - 0.03]}>
        <boxGeometry args={[w + 0.02, 0.06, 0.05]} />
      </mesh>
      <mesh material={lacquer} position={[0, 0.32, -WHITE_L / 2 - 0.12]} castShadow>
        <boxGeometry args={[w + 0.5, 0.62, 0.14]} />
      </mesh>
      {/* Upright case behind, with a music desk holding the score */}
      <mesh material={lacquer} position={[0, 1.55, -WHITE_L / 2 - 0.55]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.5, 3.1, 0.7]} />
      </mesh>
      <mesh material={lacquer} position={[0, 0.72, -WHITE_L / 2 - 0.08]}>
        <boxGeometry args={[w * 0.82, 0.05, 0.22]} />
      </mesh>
      <mesh position={[0, 1.22, -WHITE_L / 2 - 0.12]} rotation={[-0.18, 0, 0]}>
        <planeGeometry args={[2.85, 0.78]} />
        <meshStandardMaterial map={score} roughness={0.9} />
      </mesh>
      {/* Legs and floor */}
      {[-1, 1].map((s) => (
        <mesh key={s} material={lacquer} position={[s * (w / 2 + 0.1), -1.6, 0.25]}>
          <cylinderGeometry args={[0.07, 0.09, 2.4, 16]} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.8, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#3a2b20" roughness={0.8} />
      </mesh>
    </group>
  );
}

function Hands({ session }: { session: PianoSession }) {
  return (
    <>
      {(['left', 'right'] as Side[]).map((side) => (
        <RobotHand key={side} side={side} getPose={() => session.hands[side].pose} />
      ))}
    </>
  );
}

export function PianoStage({ session }: { session: PianoSession }) {
  return (
    <Canvas shadows="percentage" camera={{ fov: 42, near: 0.1, far: 80 }} dpr={[1, 2]}>
      <color attach="background" args={['#1a1512']} />
      <fog attach="fog" args={['#1a1512', 9, 22]} />
      <CameraRig />
      <Reflections />
      <Ticker session={session} />
      <hemisphereLight args={['#f6e7cf', '#1b1512', 0.55]} />
      <directionalLight position={[2, 7, 4]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-4} />
      <pointLight position={[-3, 3, 3]} intensity={6} color="#ffd9a8" distance={12} />
      <PianoBody />
      {KEYS.map((k, i) => (
        <Key key={k.midi} k={k} i={i} session={session} />
      ))}
      <Hands session={session} />
    </Canvas>
  );
}
