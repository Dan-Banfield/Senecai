// Labels and pins drawn over the globe, plus the country tooltip.
//
// Replaces globe.gl's htmlElements layer (CSS2DRenderer) and its float-tooltip.
// Positioning, element/container styles, z-index ordering, the behind-globe
// test and the tooltip's offsets mirror those libraries exactly; the
// difference is that we only touch the DOM when a value actually changes, and
// labels faded out by tier or limb for long enough are parked with `.off`
// (visibility: hidden) and skipped entirely until they come back.
//
// The maths below is pure and DOM-free so it can be unit tested in node.

import { Matrix4, Vector3, type Camera, type Object3D } from 'three';

/** three-globe's GLOBE_RADIUS. */
export const GLOBE_R = 100;
/** Labels turned further than this from the centre of view fade out (dot product). */
export const LIMB_DOT = 0.45;
/** Hidden longer than this (ms) and a label is parked with `.off`. CSS fades opacity over 0.35s. */
export const OFF_AFTER_MS = 400;

export type Band = 'far' | 'mid' | 'near';
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

/** three-globe's polar2Cartesian: geographic coordinates to the globe's local frame. */
export function geoToLocal(lat: number, lng: number, alt = 0): Vec3 {
  const phi = (90 - lat) * DEG;
  const theta = (90 - lng) * DEG;
  const r = GLOBE_R * (1 + alt);
  const phiSin = Math.sin(phi);
  return { x: r * phiSin * Math.cos(theta), y: r * Math.cos(phi), z: r * phiSin * Math.sin(theta) };
}

/** Unit vector for a lat/lng in the globe's local frame. */
export function geoUnit(lat: number, lng: number): Vec3 {
  const p = geoToLocal(lat, lng, 0);
  return { x: p.x / GLOBE_R, y: p.y / GLOBE_R, z: p.z / GLOBE_R };
}

/**
 * three-globe's isBehindGlobe (setPointOfView): is `pos` (globe-local) hidden
 * by the globe as seen from `pov` (camera position in globe-local space)?
 */
export function isBehindGlobe(pov: Vec3, pos: Vec3, globeRadius = GLOBE_R): boolean {
  const povDist = Math.hypot(pov.x, pov.y, pov.z);
  const povEdgeDist = Math.sqrt(povDist ** 2 - globeRadius ** 2);
  const povEdgeAngle = Math.acos(povEdgeDist / povDist);
  const povPosDist = Math.hypot(pov.x - pos.x, pov.y - pos.y, pov.z - pos.z);
  if (povPosDist < povEdgeDist) return false; // closer than the visible edge of the globe
  const posDist = Math.hypot(pos.x, pos.y, pos.z);
  const povPosAngle = Math.acos((povDist ** 2 + povPosDist ** 2 - posDist ** 2) / (2 * povDist * povPosDist));
  return povPosAngle < povEdgeAngle;
}

/** Has this label turned towards the edge of the globe? `view` is the unit camera direction. */
export function isLimb(unit: Vec3, view: Vec3): boolean {
  return unit.x * view.x + unit.y * view.y + unit.z * view.z < LIMB_DOT;
}

/** Is a label's tier (or style) faded out at this zoom band? Mirrors the `data-zoom` rules in styles.css. */
export function tierHidden(tier: 1 | 2 | 3 | undefined, style: string | undefined, band: Band): boolean {
  if (band === 'far') return tier === 2 || tier === 3 || style === 'sea';
  if (band === 'mid') return tier === 3;
  return false;
}

/** CSS2DRenderer: NDC to pixel coordinates and its frustum depth test. */
export function ndcToScreen(ndc: Vec3, width: number, height: number): { x: number; y: number; inDepth: boolean } {
  const wh = width / 2;
  const hh = height / 2;
  return { x: ndc.x * wh + wh, y: -ndc.y * hh + hh, inDepth: ndc.z >= -1 && ndc.z <= 1 };
}

/** CSS2DRenderer's transform for an element at pixel (tx, ty), centre (0.5, 0.5), rotation 0. */
export function css2dTransform(tx: number, ty: number): string {
  return `translate(-50%, -50%) translate(${tx}px, ${ty}px) rotate(0rad)`;
}

/**
 * CSS2DRenderer's zOrder: stable sort by distance (nearest first), z-index =
 * count - rank. Returns z-index per input position.
 */
export function zIndices(dist2: ArrayLike<number>, order: number[] = []): number[] {
  const n = dist2.length;
  order.length = n;
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => dist2[a] - dist2[b]);
  const z = new Array<number>(n);
  for (let i = 0; i < n; i++) z[order[i]] = n - i;
  return z;
}

/** Per-label hide-skip state. */
export interface HideState {
  /** When the label last became hidden (ms), or null while visible. */
  hiddenSince: number | null;
  /** Parked: `.off` applied, no style writes. */
  off: boolean;
}

export const newHideState = (): HideState => ({ hiddenSince: null, off: false });

/**
 * Advance the hide-skip state machine. Returns 'park' when `.off` must be
 * added, 'unpark' when the element must be repositioned and `.off` removed,
 * otherwise null. `fresh`: first sighting, so a label that starts hidden is
 * parked at once (there is no fade to wait for).
 */
export function stepHide(s: HideState, hidden: boolean, now: number, fresh = false): 'park' | 'unpark' | null {
  if (hidden) {
    if (s.hiddenSince === null) s.hiddenSince = now;
    if (!s.off && (fresh || now - s.hiddenSince > OFF_AFTER_MS)) {
      s.off = true;
      return 'park';
    }
    return null;
  }
  s.hiddenSince = null;
  if (s.off) {
    s.off = false;
    return 'unpark';
  }
  return null;
}

/** Milliseconds until a hidden, not yet parked label is due to park (Infinity if never). */
export function msUntilPark(s: HideState, now: number): number {
  if (s.off || s.hiddenSince === null) return Infinity;
  return Math.max(0, OFF_AFTER_MS - (now - s.hiddenSince)) + 1;
}

/** float-tooltip's automatic translate: shift left in proportion to x, flip above near the bottom. */
export function tooltipTransform(x: number, y: number, width: number, height: number): string {
  const tx = `-${(x / width) * 100}%`;
  const ty = height > 130 && height - y < 100 ? 'calc(-100% - 6px)' : '21px';
  return `translate(${tx},${ty})`;
}

// ---------------------------------------------------------------------------
// DOM

export interface OverlayItem {
  id: string;
  lat: number;
  lng: number;
  alt: number;
  kind: 'label' | 'pin';
  /** Label tier (1..3) and style, for hide-skipping. */
  tier?: 1 | 2 | 3;
  style?: string;
  make(): HTMLElement;
}

export interface Overlay {
  /** Container appended into the globe mount, styled like CSS2DRenderer's domElement. */
  root: HTMLElement;
  /** Diff by id: keep existing elements for unchanged ids, create new via make(), remove the rest. */
  setItems(items: OverlayItem[]): void;
  /** Reposition. Call when camera/size/band/items changed. Cheap when nothing changed. */
  update(camera: Camera, globeObject: Object3D, width: number, height: number, band: Band): void;
  /** True if the item is currently hidden behind the globe (what 'pin-hidden' means). */
  isHidden(id: string): boolean;
  dispose(): void;
}

interface Entry {
  item: OverlayItem;
  el: HTMLElement;
  local: Vec3;
  unit: Vec3;
  appended: boolean;
  /** Last written values (undefined = never written). */
  tx?: number;
  ty?: number;
  display?: string;
  zIndex?: number;
  behind: boolean;
  limb: boolean;
  hide: HideState;
  seen: boolean;
  dist2: number;
}

const _world = new Vector3();
const _ndc = new Vector3();
const _camPos = new Vector3();
const _pov = new Vector3();
const _viewProj = new Matrix4();
const _globeInv = new Matrix4();

function sameMatrix(a: number[], b: ArrayLike<number>): boolean {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
}
function copyMatrix(a: number[], b: ArrayLike<number>) {
  for (let i = 0; i < 16; i++) a[i] = b[i];
}

function chainVisible(o: Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export function createOverlay(): Overlay {
  // CSS2DRenderer's domElement, as three-render-objects mounts it.
  const root = document.createElement('div');
  root.style.overflow = 'hidden';
  root.style.position = 'absolute';
  root.style.top = '0px';
  root.style.pointerEvents = 'none';

  const entries = new Map<string, Entry>();
  let list: Entry[] = [];
  let dirty = true;
  let lastW = NaN;
  let lastH = NaN;
  let lastBand: Band | null = null;
  let lastShown = true;
  const lastCam: number[] = new Array(16).fill(NaN);
  const lastProj: number[] = new Array(16).fill(NaN);
  const lastGlobe: number[] = new Array(16).fill(NaN);
  const order: number[] = [];
  const dist2: number[] = [];
  let timer = 0;
  let timerDue = Infinity;

  const writePosition = (e: Entry, x: number, y: number, inDepth: boolean) => {
    const display = inDepth ? '' : 'none';
    if (display !== e.display) e.el.style.display = e.display = display;
    if (!inDepth) return;
    if (x !== e.tx || y !== e.ty) {
      e.tx = x;
      e.ty = y;
      e.el.style.transform = css2dTransform(x, y);
    }
    if (!e.appended) {
      root.appendChild(e.el);
      e.appended = true;
    }
  };

  /** Park labels whose fade has finished even if no further update comes (the render loop may be idle). */
  const schedulePark = () => {
    const now = performance.now();
    let wait = Infinity;
    for (const e of list) if (e.item.kind === 'label') wait = Math.min(wait, msUntilPark(e.hide, now));
    if (wait === Infinity) return;
    // An earlier pending timer is fine: it parks what is due and reschedules.
    if (timer && timerDue <= now + wait) return;
    clearTimeout(timer);
    timerDue = now + wait;
    timer = window.setTimeout(() => {
      timer = 0;
      timerDue = Infinity;
      const t = performance.now();
      for (const e of list) {
        if (e.item.kind === 'label' && e.hide.hiddenSince !== null && stepHide(e.hide, true, t) === 'park') e.el.classList.add('off');
      }
      schedulePark();
    }, wait);
  };

  const setItems = (items: OverlayItem[]) => {
    const keep = new Set<string>();
    for (const item of items) {
      keep.add(item.id);
      const e = entries.get(item.id);
      if (e) {
        if (e.item.lat !== item.lat || e.item.lng !== item.lng || e.item.alt !== item.alt) {
          e.local = geoToLocal(item.lat, item.lng, item.alt);
          e.unit = geoUnit(item.lat, item.lng);
        }
        e.item = item;
        continue;
      }
      // CSS2DObject's element styles.
      const el = item.make();
      el.style.position = 'absolute';
      el.style.userSelect = 'none';
      el.setAttribute('draggable', 'false');
      el.style.transformOrigin = '50% 50%';
      entries.set(item.id, {
        item,
        el,
        local: geoToLocal(item.lat, item.lng, item.alt),
        unit: geoUnit(item.lat, item.lng),
        appended: false,
        behind: false,
        limb: false,
        hide: newHideState(),
        seen: false,
        dist2: 0,
      });
    }
    for (const [id, e] of entries) {
      if (keep.has(id)) continue;
      e.el.remove();
      entries.delete(id);
    }
    list = [...entries.values()];
    dirty = true;
  };

  const update = (camera: Camera, globeObject: Object3D, width: number, height: number, band: Band) => {
    if (width !== lastW) root.style.width = width + 'px';
    if (height !== lastH) root.style.height = height + 'px';

    // CSS2DRenderer hides every element while the globe (or an ancestor) is invisible.
    const shown = chainVisible(globeObject);
    if (!shown) {
      if (lastShown || dirty) {
        for (const e of list) if (e.display !== 'none') e.el.style.display = e.display = 'none';
      }
      lastShown = false;
      dirty = false;
      lastW = width;
      lastH = height;
      return;
    }

    if (camera.parent === null && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld();
    globeObject.updateWorldMatrix(true, false);
    const camE = camera.matrixWorld.elements;
    const projE = camera.projectionMatrix.elements;
    const globeE = globeObject.matrixWorld.elements;
    if (
      !dirty &&
      lastShown &&
      width === lastW &&
      height === lastH &&
      band === lastBand &&
      sameMatrix(lastCam, camE) &&
      sameMatrix(lastProj, projE) &&
      sameMatrix(lastGlobe, globeE)
    ) {
      return;
    }
    dirty = false;
    lastShown = true;
    lastW = width;
    lastH = height;
    lastBand = band;
    copyMatrix(lastCam, camE);
    copyMatrix(lastProj, projE);
    copyMatrix(lastGlobe, globeE);

    _viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    // three-globe: camera position in the globe's local space.
    _globeInv.copy(globeObject.matrixWorld).invert();
    _pov.copy(_camPos).applyMatrix4(_globeInv);
    // globe.gl's pointOfView lat/lng: the camera's direction from the origin (world space).
    const len = _camPos.length() || 1;
    const view: Vec3 = { x: _camPos.x / len, y: _camPos.y / len, z: _camPos.z / len };
    const now = performance.now();
    const unpark: Entry[] = [];
    const park: Entry[] = [];
    dist2.length = list.length;

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      _world.set(e.local.x, e.local.y, e.local.z).applyMatrix4(globeObject.matrixWorld);
      dist2[i] = e.dist2 = _world.distanceToSquared(_camPos);
      _ndc.copy(_world).applyMatrix4(_viewProj);
      const s = ndcToScreen(_ndc, width, height);

      const behind = isBehindGlobe(_pov, e.local);
      if (behind !== e.behind || !e.seen) {
        e.behind = behind;
        e.el.classList.toggle('pin-hidden', behind);
      }

      if (e.item.kind === 'label') {
        const limb = isLimb(e.unit, view);
        if (limb !== e.limb || !e.seen) {
          e.limb = limb;
          e.el.classList.toggle('limb', limb);
        }
        const hidden = limb || behind || tierHidden(e.item.tier, e.item.style, band);
        const step = stepHide(e.hide, hidden, now, !e.seen);
        if (step === 'park') park.push(e);
        else if (step === 'unpark') unpark.push(e);
      }
      e.seen = true;
      if (!e.hide.off) writePosition(e, s.x, s.y, s.inDepth);
    }

    const z = zIndices(dist2, order);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.hide.off || z[i] === e.zIndex) continue;
      e.zIndex = z[i];
      e.el.style.zIndex = String(z[i]);
    }
    for (const e of park) e.el.classList.add('off');
    for (const e of unpark) e.el.classList.remove('off');
    schedulePark();
  };

  return {
    root,
    setItems,
    update,
    isHidden: (id) => entries.get(id)?.behind ?? false,
    dispose() {
      clearTimeout(timer);
      for (const e of entries.values()) e.el.remove();
      entries.clear();
      list = [];
      root.remove();
    },
  };
}

export interface Tooltip {
  root: HTMLElement;
  show(html: string, clientX: number, clientY: number): void;
  hide(): void;
  dispose(): void;
}

/**
 * float-tooltip as three-render-objects sets it up for globe.gl: a
 * `.float-tooltip-kap` div appended to `container` (its base CSS is injected
 * by float-tooltip itself, which globe.gl still loads).
 */
export function createTooltip(container: HTMLElement): Tooltip {
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const root = document.createElement('div');
  root.className = 'float-tooltip-kap';
  root.style.left = '-10000px';
  root.style.display = 'none';
  container.appendChild(root);

  let html = '';
  let left = '';
  let top = '';
  let transform = '';
  let display = 'none';
  const setDisplay = (d: string) => {
    if (d !== display) root.style.display = display = d;
  };

  const hide = () => {
    setDisplay('none');
    if (html) {
      root.textContent = '';
      html = '';
    }
  };

  return {
    root,
    hide,
    show(next, clientX, clientY) {
      if (!next) return hide();
      // d3-selection's pointer() for an HTML element.
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left - container.clientLeft;
      const y = clientY - rect.top - container.clientTop;
      const l = x + 'px';
      const t = y + 'px';
      const tf = tooltipTransform(x, y, container.offsetWidth, container.offsetHeight);
      if (l !== left) root.style.left = left = l;
      if (t !== top) root.style.top = top = t;
      if (tf !== transform) root.style.transform = transform = tf;
      if (next !== html) root.innerHTML = html = next;
      setDisplay('inline');
    },
    dispose() {
      root.remove();
    },
  };
}
