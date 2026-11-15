// A circle behind the globe canvas that carries the globe's rim and drop shadow as a CSS box-shadow,
// replacing the (per-frame, full-canvas) `filter: drop-shadow(...)` on the canvas itself.

import { Vector3, type Camera, type Object3D } from 'three';

/** three-globe GLOBE_RADIUS. */
export const GLOBE_RADIUS = 100;
/** Country caps sit at this altitude, so they define the silhouette where land reaches the limb. */
export const SILHOUETTE_ALTITUDE = 0.005;
/** Minimum change (CSS px) before a style is rewritten. */
const EPS_PX = 0.25;

/**
 * On-screen radius (px) of a sphere of world radius `radius` whose centre lies on the camera's optical
 * axis at distance `distance`, for a perspective camera with focal length `focalPx` (px). The silhouette
 * is the tangent cone with half-angle asin(R/d), so its radius on the image plane is f * tan(asin(R/d)).
 * Returns null when the camera is inside or on the sphere.
 */
export function silhouetteRadiusPx(radius: number, distance: number, focalPx: number): number | null {
  const d2r2 = distance * distance - radius * radius;
  if (!(d2r2 > 0)) return null;
  return (focalPx * radius) / Math.sqrt(d2r2);
}

/** Focal length in CSS px from a perspective projection matrix (elements[5] = zoom / tan(fov/2)). */
export function focalPx(projectionElements: ArrayLike<number>, height: number): number {
  return (projectionElements[5] * height) / 2;
}

export interface CircleBox {
  x: number;
  y: number;
  size: number;
}

/** True if any of position/size moved by more than `eps` px. */
export function boxChanged(a: CircleBox | null, b: CircleBox, eps = EPS_PX): boolean {
  return !a || Math.abs(a.x - b.x) > eps || Math.abs(a.y - b.y) > eps || Math.abs(a.size - b.size) > eps;
}

export interface GlobeShadow {
  el: HTMLElement;
  update(camera: Camera, globeObject: Object3D, width: number, height: number): void;
}

export function createGlobeShadow(opts: { altitude?: number } = {}): GlobeShadow {
  const altitude = opts.altitude ?? SILHOUETTE_ALTITUDE;
  const el = document.createElement('div');
  el.className = 'globe-shadow';
  el.setAttribute('aria-hidden', 'true');
  const s = el.style;
  s.position = 'absolute';
  s.left = '0px';
  s.top = '0px';
  s.width = '0px';
  s.height = '0px';
  s.borderRadius = '50%';
  s.pointerEvents = 'none';
  s.display = 'none';

  const centre = new Vector3();
  const scale = new Vector3();
  let last: CircleBox | null = null;
  let shown = false;

  const hide = () => {
    if (shown) {
      s.display = 'none';
      shown = false;
      last = null;
    }
  };

  return {
    el,
    update(camera, globeObject, width, height) {
      globeObject.getWorldPosition(centre);
      globeObject.getWorldScale(scale);
      const radius = GLOBE_RADIUS * (1 + altitude) * scale.x;
      // Camera space (camera.matrixWorldInverse is current after camera.updateMatrixWorld()).
      centre.applyMatrix4(camera.matrixWorldInverse);
      const distance = centre.length();
      const r = centre.z < 0 ? silhouetteRadiusPx(radius, distance, focalPx(camera.projectionMatrix.elements, height)) : null;
      if (r === null || !Number.isFinite(r) || width <= 0 || height <= 0) {
        hide();
        return;
      }
      // Projected centre, including any view offset (globeOffset) baked into the projection matrix.
      centre.applyMatrix4(camera.projectionMatrix);
      const cx = ((centre.x + 1) / 2) * width;
      const cy = ((1 - centre.y) / 2) * height;
      const box: CircleBox = { x: cx - r, y: cy - r, size: 2 * r };
      if (boxChanged(last, box)) {
        // Compare against what was last written, so sub-threshold drift can't accumulate.
        const size = !last || Math.abs(last.size - box.size) > EPS_PX ? box.size : last.size;
        if (size !== last?.size) {
          s.width = `${size.toFixed(2)}px`;
          s.height = s.width;
        }
        const x = cx - size / 2;
        const y = cy - size / 2;
        s.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
        last = { x, y, size };
      }
      if (!shown) {
        s.display = '';
        shown = true;
      }
    },
  };
}
