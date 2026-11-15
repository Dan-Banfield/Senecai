import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CAMERA_TARGET,
  CAMERA_VIEWS,
  cameraKeyStep,
  cycleView,
  DEFAULT_VIEW,
  easeInOut,
  fitFov,
  INSTRUMENT_TILT,
  parseView,
  VIEW_ORDER,
  type CameraKeyEvent,
} from './cameraViews';

const key = (k: string, extra: Partial<CameraKeyEvent> = {}): CameraKeyEvent => ({
  key: k,
  shiftKey: false,
  repeat: false,
  target: null,
  ...extra,
});

const pos = (id: keyof typeof CAMERA_VIEWS) => new THREE.Vector3(...CAMERA_VIEWS[id].position);
const elevationDeg = (id: keyof typeof CAMERA_VIEWS) => {
  const p = pos(id);
  return THREE.MathUtils.radToDeg(Math.asin((p.y - CAMERA_TARGET.y) / p.distanceTo(CAMERA_TARGET)));
};

describe('cycleView', () => {
  it('steps forward through front -> top -> side and wraps', () => {
    expect(cycleView('front', 1)).toBe('top');
    expect(cycleView('top', 1)).toBe('side');
    expect(cycleView('side', 1)).toBe('front');
  });

  it('steps backward and wraps', () => {
    expect(cycleView('front', -1)).toBe('side');
    expect(cycleView('side', -1)).toBe('top');
    expect(cycleView('top', -1)).toBe('front');
  });

  it('returns to the start after a full cycle either way', () => {
    for (const id of VIEW_ORDER) {
      let a = id;
      let b = id;
      for (let i = 0; i < VIEW_ORDER.length; i++) {
        a = cycleView(a, 1);
        b = cycleView(b, -1);
      }
      expect(a).toBe(id);
      expect(b).toBe(id);
    }
  });
});

describe('parseView', () => {
  it('keeps valid ids', () => {
    for (const id of VIEW_ORDER) expect(parseView(id)).toBe(id);
  });

  it('falls back to the default for anything else', () => {
    expect(DEFAULT_VIEW).toBe('top');
    for (const v of ['bogus', '', 'Top', undefined, null, 0, 1, {}, ['top']]) expect(parseView(v)).toBe(DEFAULT_VIEW);
  });
});

describe('fitFov', () => {
  it('never goes below 38 deg', () => {
    for (const d of [2, 4, 8]) for (const a of [0.5, 1, 1.6, 3]) expect(fitFov(d, a)).toBeGreaterThanOrEqual(38);
    expect(fitFov(4, 1.6)).toBe(38);
  });

  it('widens on narrow aspects', () => {
    expect(fitFov(4, 0.4)).toBeGreaterThan(fitFov(4, 0.6));
    expect(fitFov(4, 0.4)).toBeGreaterThan(38);
  });
});

describe('easeInOut', () => {
  it('hits its endpoints and clamps', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });

  it('is monotonic and eases at both ends', () => {
    let prev = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeInOut(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
  });
});

describe('cameraKeyStep', () => {
  it('maps plain Left/Right for non-keyboard sources', () => {
    for (const src of ['webcam', 'gloves', 'fused', null] as const) {
      expect(cameraKeyStep(key('ArrowRight'), src)).toBe(1);
      expect(cameraKeyStep(key('ArrowLeft'), src)).toBe(-1);
    }
  });

  it('accepts Shift+arrows for non-keyboard sources', () => {
    expect(cameraKeyStep(key('ArrowRight', { shiftKey: true }), 'webcam')).toBe(1);
    expect(cameraKeyStep(key('ArrowLeft', { shiftKey: true }), 'webcam')).toBe(-1);
  });

  it('leaves plain arrows to the keyboard source and needs Shift', () => {
    expect(cameraKeyStep(key('ArrowRight'), 'keyboard')).toBeNull();
    expect(cameraKeyStep(key('ArrowLeft'), 'keyboard')).toBeNull();
    expect(cameraKeyStep(key('ArrowRight', { shiftKey: true }), 'keyboard')).toBe(1);
    expect(cameraKeyStep(key('ArrowLeft', { shiftKey: true }), 'keyboard')).toBe(-1);
  });

  it('ignores Up/Down and other keys', () => {
    for (const k of ['ArrowUp', 'ArrowDown', 'a', 'Enter', ' ']) {
      expect(cameraKeyStep(key(k), 'webcam')).toBeNull();
      expect(cameraKeyStep(key(k, { shiftKey: true }), 'keyboard')).toBeNull();
    }
  });

  it('ignores key repeat', () => {
    expect(cameraKeyStep(key('ArrowRight', { repeat: true }), 'webcam')).toBeNull();
    expect(cameraKeyStep(key('ArrowLeft', { repeat: true, shiftKey: true }), 'keyboard')).toBeNull();
  });

  it('ignores Ctrl/Meta/Alt combos', () => {
    expect(cameraKeyStep(key('ArrowRight', { ctrlKey: true }), 'webcam')).toBeNull();
    expect(cameraKeyStep(key('ArrowRight', { metaKey: true }), 'webcam')).toBeNull();
    expect(cameraKeyStep(key('ArrowLeft', { altKey: true }), 'webcam')).toBeNull();
    expect(cameraKeyStep(key('ArrowLeft', { altKey: true, shiftKey: true }), 'keyboard')).toBeNull();
  });

  it('ignores keys typed into editable fields', () => {
    const inField = { closest: (sel: string) => (sel.includes('input') && sel.includes('select') ? {} : null) };
    expect(cameraKeyStep(key('ArrowRight', { target: inField }), 'webcam')).toBeNull();
    expect(cameraKeyStep(key('ArrowLeft', { target: { isContentEditable: true } }), 'gloves')).toBeNull();
  });

  it('accepts targets outside editable fields', () => {
    expect(cameraKeyStep(key('ArrowRight', { target: null }), 'webcam')).toBe(1);
    expect(cameraKeyStep(key('ArrowRight', { target: { closest: () => null, isContentEditable: false } }), 'webcam')).toBe(1);
    expect(cameraKeyStep(key('ArrowLeft', { target: {} }), null)).toBe(-1);
  });
});

describe('CAMERA_VIEWS', () => {
  it('places top high, looking down at about 60 deg', () => {
    expect(elevationDeg('top')).toBeGreaterThan(50);
    expect(elevationDeg('top')).toBeLessThan(70);
  });

  it('rolls only the top view, by half a turn', () => {
    expect(CAMERA_VIEWS.top.roll).toBeCloseTo(Math.PI);
    expect(CAMERA_VIEWS.front.roll).toBe(0);
    expect(CAMERA_VIEWS.side.roll).toBe(0);
  });

  it('tilts the instrument so its holes face the front camera', () => {
    const holes = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), INSTRUMENT_TILT);
    const toFront = pos('front').sub(CAMERA_TARGET).normalize();
    expect(holes.dot(toFront)).toBeCloseTo(1, 6);
  });

  it('keeps every preset inside the fog', () => {
    for (const id of VIEW_ORDER) expect(pos(id).distanceTo(CAMERA_TARGET)).toBeLessThanOrEqual(4.5);
  });

  it('places side on the player\'s right at about 30 deg', () => {
    expect(pos('side').x).toBeGreaterThan(2.5);
    expect(elevationDeg('side')).toBeGreaterThan(25);
    expect(elevationDeg('side')).toBeLessThan(35);
  });

  it('places front across the instrument, low', () => {
    expect(pos('front').z).toBeLessThan(-2.5);
    expect(elevationDeg('front')).toBeGreaterThan(15);
    expect(elevationDeg('front')).toBeLessThan(28);
  });
});
