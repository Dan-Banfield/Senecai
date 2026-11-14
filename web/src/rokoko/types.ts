// Rokoko Studio live stream, JSON v3.
//
// Field names follow Rokoko's official Unity (JsonLiveSerializerV3.cs) and
// Blender (live_data_manager.py) plugins. Studio's space is Y-up, left-handed
// (Unity convention). Joint rotations are absolute orientations, not deltas
// from the parent, so we only ever use *relative* rotations between joints. That
// makes the maths independent of Studio's reference T-pose.

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export interface JointFrame {
  position: Vec3;
  rotation: Quat;
}

export const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const;
export type Finger = (typeof FINGERS)[number];
export const PHALANGES = ['Proximal', 'Medial', 'Distal', 'Tip'] as const;
export type Phalanx = (typeof PHALANGES)[number];
export type Side = 'left' | 'right';
export const SIDES: Side[] = ['left', 'right'];

export interface ActorMeta {
  hasGloves: boolean;
  hasLeftGlove: boolean;
  hasRightGlove: boolean;
  hasBody: boolean;
  hasFace: boolean;
}

export interface ActorFrame {
  name: string;
  color?: number[];
  meta: ActorMeta;
  dimensions?: { totalHeight: number; hipHeight: number };
  body: Partial<Record<string, JointFrame>>;
  /**
   * Senecai extension, added by our bridge for Rokoko Device SDK frames (Studio never sends it).
   * "wrist-relative": hand positions carry no world position (no Coil Pro).
   */
  senecai?: { positions?: string };
}

export interface RokokoFrame {
  version: number | string;
  fps: number;
  scene: {
    timestamp: number;
    actors: ActorFrame[];
    props: unknown[];
  };
}

export const handJoint = (side: Side) => `${side}Hand`;
export const fingerJoint = (side: Side, finger: Finger, phalanx: Phalanx) => `${side}${finger}${phalanx}`;

export function isRokokoFrame(x: unknown): x is RokokoFrame {
  const f = x as RokokoFrame;
  return !!f && typeof f === 'object' && !!f.scene && Array.isArray(f.scene.actors);
}
