import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  css2dTransform,
  geoToLocal,
  geoUnit,
  isBehindGlobe,
  isLimb,
  msUntilPark,
  ndcToScreen,
  newHideState,
  OFF_AFTER_MS,
  stepHide,
  tierHidden,
  tooltipTransform,
  zIndices,
} from './overlay';

const close = (a: { x: number; y: number; z: number }, b: [number, number, number]) => {
  expect(a.x).toBeCloseTo(b[0], 9);
  expect(a.y).toBeCloseTo(b[1], 9);
  expect(a.z).toBeCloseTo(b[2], 9);
};

describe('overlay maths', () => {
  it("uses three-globe's polar2Cartesian convention", () => {
    close(geoToLocal(0, 0), [0, 0, 100]);
    close(geoToLocal(90, 0), [0, 100, 0]);
    close(geoToLocal(0, 90), [100, 0, 0]);
    close(geoToLocal(0, 0, 0.008), [0, 0, 100.8]);
    const u = geoUnit(37, -122);
    expect(Math.hypot(u.x, u.y, u.z)).toBeCloseTo(1, 12);
  });

  it('limb test agrees with the old atlas fadeLimb maths (dot is frame independent)', () => {
    const RAD = Math.PI / 180;
    const atlasUnit = (lat: number, lng: number) => [Math.cos(lat * RAD) * Math.cos(lng * RAD), Math.cos(lat * RAD) * Math.sin(lng * RAD), Math.sin(lat * RAD)];
    for (const [a, b] of [[[60, 25], [50, 14]], [[-30, 150], [10, -40]], [[0, 0], [0, 63.2]], [[0, 0], [0, 63.3]]] as [number, number][][]) {
      const v = atlasUnit(a[0], a[1]);
      const c = atlasUnit(b[0], b[1]);
      const old = v[0] * c[0] + v[1] * c[1] + v[2] * c[2] < 0.45;
      expect(isLimb(geoUnit(a[0], a[1]), geoUnit(b[0], b[1]))).toBe(old);
    }
  });

  it("replicates three-globe's isBehindGlobe", () => {
    const pov = { x: 0, y: 0, z: 300 };
    expect(isBehindGlobe(pov, { x: 0, y: 0, z: 100 })).toBe(false);
    expect(isBehindGlobe(pov, { x: 0, y: 0, z: -100 })).toBe(true);
    // On the equatorial rim at 90 degrees: past the visible cap (acos(100/300) ~ 70.5 degrees).
    expect(isBehindGlobe(pov, { x: 100, y: 0, z: 0 })).toBe(true);
    expect(isBehindGlobe(pov, geoToLocal(0, 65))).toBe(false);
    expect(isBehindGlobe(pov, geoToLocal(0, 75))).toBe(true);
    // Raised high enough, a point past the rim pokes out of the silhouette cone.
    expect(isBehindGlobe(pov, geoToLocal(0, 90, 1))).toBe(false);
    // Camera inside the globe: three-globe's NaN maths says "not behind".
    expect(isBehindGlobe({ x: 0, y: 0, z: 50 }, { x: 0, y: 0, z: -100 })).toBe(false);
  });

  it('hides tiers by zoom band like the CSS', () => {
    expect(tierHidden(1, 'country', 'far')).toBe(false);
    expect(tierHidden(2, 'country', 'far')).toBe(true);
    expect(tierHidden(3, 'capital', 'far')).toBe(true);
    expect(tierHidden(1, 'sea', 'far')).toBe(true);
    expect(tierHidden(2, 'sea', 'mid')).toBe(false);
    expect(tierHidden(3, 'country', 'mid')).toBe(true);
    expect(tierHidden(3, 'country', 'near')).toBe(false);
    expect(tierHidden(undefined, undefined, 'far')).toBe(false);
  });

  it('projects like CSS2DRenderer', () => {
    const cam = new PerspectiveCamera(50, 800 / 600, 0.05, 1e5);
    cam.position.set(0, 0, 330);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const centre = ndcToScreen(new Vector3(0, 0, 100).project(cam), 800, 600);
    expect(centre.x).toBeCloseTo(400, 9);
    expect(centre.y).toBeCloseTo(300, 9);
    expect(centre.inDepth).toBe(true);
    const up = ndcToScreen(new Vector3(0, 50, 100).project(cam), 800, 600);
    expect(up.y).toBeLessThan(300);
    expect(ndcToScreen(new Vector3(0, 0, 400).project(cam), 800, 600).inDepth).toBe(false); // behind the camera
    expect(css2dTransform(12.5, -3)).toBe('translate(-50%, -50%) translate(12.5px, -3px) rotate(0rad)');
  });

  it('orders z-index nearest-first with stable ties', () => {
    expect(zIndices([5, 1, 3])).toEqual([1, 3, 2]);
    expect(zIndices([2, 2, 1])).toEqual([2, 1, 3]);
    expect(zIndices([])).toEqual([]);
  });

  it('parks labels after they have been hidden for a while, and unparks at once', () => {
    const s = newHideState();
    expect(stepHide(s, false, 0, true)).toBe(null);
    expect(stepHide(s, true, 100)).toBe(null);
    expect(msUntilPark(s, 100)).toBe(OFF_AFTER_MS + 1);
    expect(stepHide(s, true, 100 + OFF_AFTER_MS)).toBe(null); // strictly longer than the delay
    expect(stepHide(s, true, 101 + OFF_AFTER_MS)).toBe('park');
    expect(s.off).toBe(true);
    expect(msUntilPark(s, 1000)).toBe(Infinity);
    expect(stepHide(s, true, 2000)).toBe(null);
    expect(stepHide(s, false, 2001)).toBe('unpark');
    expect(s).toEqual({ hiddenSince: null, off: false });
    // Flickering visible resets the clock.
    stepHide(s, true, 3000);
    stepHide(s, false, 3300);
    expect(stepHide(s, true, 3500)).toBe(null);
    expect(stepHide(s, true, 3800)).toBe(null);
    // A label hidden on first sight parks immediately.
    const f = newHideState();
    expect(stepHide(f, true, 0, true)).toBe('park');
  });

  it("matches float-tooltip's automatic offsets", () => {
    expect(tooltipTransform(0, 10, 800, 600)).toBe('translate(-0%,21px)');
    expect(tooltipTransform(400, 10, 800, 600)).toBe('translate(-50%,21px)');
    expect(tooltipTransform(200, 550, 800, 600)).toBe('translate(-25%,calc(-100% - 6px))');
    expect(tooltipTransform(200, 100, 800, 120)).toBe('translate(-25%,21px)'); // short container never flips
  });
});
