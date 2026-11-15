import { describe, expect, it } from 'vitest';
import { Object3D, PerspectiveCamera } from 'three';
import { polar2Cartesian } from './layerMath';
import { cartesian2Polar, globeCoordsAt, raySphereOrigin } from './pick';

describe('cartesian2Polar', () => {
  it('inverts polar2Cartesian', () => {
    for (const [lat, lng] of [[60.17, 24.94], [-33.9, 151.2], [0, -179], [45, 120], [-80, -60]]) {
      const p = [0, 0, 0];
      polar2Cartesian(lat, lng, 0, p, 0);
      const back = cartesian2Polar(p[0], p[1], p[2]);
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lng).toBeCloseTo(lng, 9);
    }
  });
});

describe('raySphereOrigin', () => {
  it('hits the near side', () => expect(raySphereOrigin(0, 0, 300, 0, 0, -1, 100)).toBeCloseTo(200));
  it('misses', () => expect(raySphereOrigin(0, 200, 300, 0, 0, -1, 100)).toBeNull());
  it('ignores spheres behind the ray', () => expect(raySphereOrigin(0, 0, 300, 0, 0, 1, 100)).toBeNull());
});

describe('globeCoordsAt', () => {
  const setup = (lat: number, lng: number) => {
    const cam = new PerspectiveCamera(50, 800 / 600, 0.05, 1e5);
    const p = [0, 0, 0];
    polar2Cartesian(lat, lng, 2.3, p, 0);
    cam.position.set(p[0], p[1], p[2]);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    return cam;
  };
  it('the centre of the view is the point the camera looks at', () => {
    const at = globeCoordsAt(setup(50, 14), new Object3D(), 400, 300, 800, 600)!;
    expect(at.lat).toBeCloseTo(50, 6);
    expect(at.lng).toBeCloseTo(14, 6);
  });
  it('space is null', () => expect(globeCoordsAt(setup(50, 14), new Object3D(), 2, 2, 800, 600)).toBeNull());
});
