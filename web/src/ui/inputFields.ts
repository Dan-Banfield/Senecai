// What the hand-input drawer shows for each source: its row (icon + one-line blurb),
// its setup notes (folded away), and which settings it actually uses.

import { KEYBOARD_HELP } from '../input/keyboardSource';
import type { SourceKind } from '../input/types';
import type { IconName } from './icons';

export type InputField = 'camera' | 'rotation' | 'swapHands' | 'bridgeUrl';

export const SOURCE_ORDER: SourceKind[] = ['webcam', 'fused', 'gloves', 'keyboard'];

export const SOURCE_INFO: Record<SourceKind, { icon: IconName; blurb: string; setup: string }> = {
  webcam: {
    icon: 'camera',
    blurb: 'Hand tracking from your webcam. No hardware.',
    setup: 'Emulates the gloves with MediaPipe hand tracking and sends the same Rokoko JSON v3 frames.',
  },
  fused: {
    icon: 'gloveCam',
    blurb: 'Gloves for fingers, an overhead camera for position.',
    setup:
      'The gloves drive your fingers and wrist; a camera looking down at the table tracks where the gloves are. Run `npm run bridge:sdk` and point a second camera at the table.',
  },
  gloves: {
    icon: 'glove',
    blurb: 'Real gloves, streamed through the local bridge.',
    setup:
      'Rokoko Device SDK or Studio → `npm run bridge` (or `npm run bridge:sdk`) → here. Without a Coil Pro the gloves cannot track where your hands are, so you aim by tilting your wrist.',
  },
  keyboard: {
    icon: 'keys',
    blurb: 'Keys curl fingers, the mouse moves the hand.',
    setup: KEYBOARD_HELP,
  },
};

const FIELDS: Record<SourceKind, InputField[]> = {
  webcam: ['camera', 'swapHands'],
  fused: ['camera', 'rotation', 'swapHands', 'bridgeUrl'],
  gloves: ['bridgeUrl'],
  keyboard: [],
};

/** The source-specific settings to show for `kind` (none when nothing is picked). */
export function sourceFields(kind: SourceKind | null): InputField[] {
  return kind ? FIELDS[kind] : [];
}
