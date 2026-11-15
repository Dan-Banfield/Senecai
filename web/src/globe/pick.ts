// What point of the globe is under the pointer, by intersecting the pointer ray with the sphere.
//
// globe.gl's `toGlobeCoords` raycasts every object in the globe recursively (including hidden
// layers such as the atmosphere and graticule lines) and took ~13ms per call, far too slow to run
// on every pointer move. The sea is a sphere, so a ray/sphere intersection gives the same answer
// in microseconds.

import { Matrix4, Ray, Vector2, Vector3, type Camera, type Object3D } from 'three';

/** three-globe's GLOBE_RADIUS: the sea sphere. */
export const GLOBE_RADIUS = 100;

/** three-globe's `cartesian2Polar`, for a point in the globe's local frame. */
export function cartesian2Polar(x: number, y: number, z: number): { lat: number; lng: number } {
  const r = Math.sqrt(x * x + y * y + z * z);
  const phi = Math.acos(y / r);
  const theta = Math.atan2(z, x);
  return { lat: 90 - (phi * 180) / Math.PI, lng: 90 - (theta * 180) / Math.PI - (theta < -Math.PI / 2 ? 360 : 0) };
}

/**
 * Nearest intersection distance of a ray (unit `dir`) with a sphere at the origin, or null if it
 * misses or the sphere is behind the ray.
 */
export function raySphereOrigin(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, radius: number): number | null {
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t = -b - s >= 0 ? -b - s : -b + s;
  return t >= 0 ? t : null;
}

const _ndc = new Vector2();
const _ray = new Ray();
const _inv = new Matrix4();
const _o = new Vector3();
const _d = new Vector3();

/**
 * Latitude/longitude under canvas-relative pixel (x, y), or null over space. Same result as
 * globe.gl's `toGlobeCoords` (which hits the sea sphere), honouring the globe object's transform.
 */
export function globeCoordsAt(camera: Camera, globeObject: Object3D, x: number, y: number, width: number, height: number): { lat: number; lng: number } | null {
  if (!width || !height) return null;
  _ndc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
  // Ray from the camera through the pixel (as Raycaster.setFromCamera does for a perspective camera).
  _ray.origin.setFromMatrixPosition(camera.matrixWorld);
  _ray.direction.set(_ndc.x, _ndc.y, 0.5).unproject(camera).sub(_ray.origin).normalize();
  // Into the globe's local frame (undoes the intro scale/spin; the radius stays GLOBE_RADIUS).
  globeObject.updateWorldMatrix(true, false);
  _inv.copy(globeObject.matrixWorld).invert();
  _o.copy(_ray.origin).applyMatrix4(_inv);
  _d.copy(_ray.direction).transformDirection(_inv);
  const t = raySphereOrigin(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, GLOBE_RADIUS);
  if (t === null) return null;
  return cartesian2Polar(_o.x + _d.x * t, _o.y + _d.y * t, _o.z + _d.z * t);
}
