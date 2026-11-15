// Country fills, ink borders and the graticule as a handful of merged meshes,
// replacing globe.gl's polygons layer (two draw calls per country part) and
// paths layer (one per graticule line). Geometry and materials mirror what
// three-globe builds, so the map looks the same; hovered and selected
// countries are lifted out of the merged meshes into small highlight objects
// that animate like three-globe's polygon transitions.

import type { Position } from 'geojson';
import ConicPolygonGeometry from 'three-conic-polygon-geometry';
import GeoJsonGeometry from 'three-geojson-geometry';
import * as THREE from 'three';
import { graticule, INK, inked } from './atlas';
import type { CountryFeature } from './geo';
import { compactRanges, GLOBE_RADIUS, pathSegments, quadInOut, shaderRgba, type IndexRange } from './layerMath';

export interface AtlasLayers {
  /** Add to the ThreeGlobe object. */
  object: THREE.Object3D;
  /** Hovered and selected country names (either may be null). Colours/side walls change instantly, altitude animates. */
  setHighlight(hover: string | null, selected: string | null): void;
  /** Advance altitude transitions. Returns true while anything is still animating. */
  update(now: number): boolean;
  dispose(): void;
}

// Values the page used to hand to globe.gl, and three-globe's defaults.
const BASE_ALT = 0.005;
const HOVER_ALT = 0.014;
const SELECT_ALT = 0.02;
const HOVER_INK = 0.12;
const SELECT_INK = 0.22;
/** polygonSideColor 'rgba(78,61,43,0.45)', split the way three-globe does (colorStr2Hex + colorAlpha). */
const WALL_HEX = 0x4e3d2b;
const WALL_OPACITY = 0.45;
const GRATICULE_ALT = 0.0062;
const GRATICULE_COLOR = 'rgba(78,61,43,0.22)';
/** polygonsTransitionDuration(260), animated with Easing.Quadratic.InOut. */
const TRANSITION_MS = 260;
/** three-globe polygonCapCurvatureResolution default (degrees); also the stroke GeoJsonGeometry resolution. */
const CAP_RESOLUTION = 5;
/** three-globe pathResolution default (degrees). */
const PATH_RESOLUTION = 2;
/** three-globe lifts the stroke this far above the cap (scale 1 + alt + 1e-4). */
const STROKE_LIFT = 1e-4;

const noRaycast = () => {};

const partsOf = (f: CountryFeature): Position[][][] => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);

/** Same call three-globe's polygons layer makes: conic from the centre up to the radius, open bottom. */
const conic = (coords: Position[][], sides: boolean) => new ConicPolygonGeometry(coords, 0, GLOBE_RADIUS, false, true, sides, CAP_RESOLUTION);
const stroke = (coords: Position[][]) => new GeoJsonGeometry({ type: 'Polygon', coordinates: coords }, GLOBE_RADIUS, CAP_RESOLUTION);

/** Grows typed arrays as geometry is appended. */
class Buf {
  data: Float32Array | Uint32Array;
  length = 0;
  constructor(private Ctor: typeof Float32Array | typeof Uint32Array) {
    this.data = new Ctor(1024);
  }
  reserve(n: number) {
    if (this.length + n <= this.data.length) return;
    let size = this.data.length;
    while (size < this.length + n) size *= 2;
    const next = new this.Ctor(size);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  push(src: ArrayLike<number>, offset = 0) {
    this.reserve(src.length);
    if (offset === 0) this.data.set(src, this.length);
    else for (let i = 0; i < src.length; i++) this.data[this.length + i] = src[i] + offset;
    this.length += src.length;
  }
  fill(v: number, n: number) {
    this.reserve(n);
    this.data.fill(v, this.length, this.length + n);
    this.length += n;
  }
  done() {
    return this.data.slice(0, this.length);
  }
}

const indexOf = (g: THREE.BufferGeometry, from = 0, count = Infinity): ArrayLike<number> => {
  const idx = g.getIndex()!.array as ArrayLike<number> & { subarray(a: number, b: number): ArrayLike<number> };
  return idx.subarray(from, Math.min(idx.length, from + count));
};

/** The invisibleUndergroundShaderExtend trick: side walls run from the centre and are discarded below the surface. */
function wallMaterial() {
  const surfaceRadius = { value: 0 };
  const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, depthWrite: true });
  m.color.set(WALL_HEX);
  m.opacity = WALL_OPACITY;
  m.transparent = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSurfaceRadius = surfaceRadius;
    shader.vertexShader = ('varying vec3 vPos;\n' + shader.vertexShader).replace('void main() {', 'void main() {\nvPos = position;');
    shader.fragmentShader = ('uniform float uSurfaceRadius;\nvarying vec3 vPos;\n' + shader.fragmentShader).replace(
      'void main() {',
      'void main() {\nif (length(vPos) < uSurfaceRadius) discard;',
    );
  };
  return { material: m, surfaceRadius };
}

interface Highlight {
  item: number;
  group: THREE.Group;
  /** Caps (shares the base fill buffers) and side walls. */
  mesh: THREE.Mesh;
  walls: THREE.Mesh;
  lines: THREE.LineSegments;
  cap: THREE.MeshLambertMaterial;
  wall: THREE.MeshBasicMaterial;
  surfaceRadius: { value: number };
  /** Current altitude and the running transition (t0 NaN = starts at the next update). */
  alt: number;
  from: number;
  to: number;
  t0: number;
  /** False once unhighlighted: it is only animating back down before removal. */
  active: boolean;
}

export function createAtlasLayers(countries: CountryFeature[], fillFor: (name: string) => string): AtlasLayers {
  const names = countries.map((f) => f.properties.name);
  const byName = new Map<string, number[]>();
  names.forEach((n, i) => {
    const list = byName.get(n);
    if (list) list.push(i);
    else byName.set(n, [i]);
  });

  // ---- base fills: every cap in one geometry, colour per vertex ----
  const fPos = new Buf(Float32Array);
  const fNor = new Buf(Float32Array);
  const fCol = new Buf(Float32Array);
  const fIdx = new Buf(Uint32Array);
  const fRanges: IndexRange[] = [];
  // ---- base borders ----
  const bPos = new Buf(Float32Array);
  const bIdx = new Buf(Uint32Array);
  const bRanges: IndexRange[] = [];

  const color = new THREE.Color();
  countries.forEach((f, i) => {
    // Same colour management as MeshLambertMaterial({ color }): sRGB hex -> linear working space.
    color.set(fillFor(names[i]));
    const fStart = fIdx.length;
    const bStart = bIdx.length;
    for (const coords of partsOf(f)) {
      const g = conic(coords, false);
      const pos = g.getAttribute('position').array;
      const base = fPos.length / 3;
      fPos.push(pos);
      fNor.push(g.getAttribute('normal').array);
      const rgb = [color.r, color.g, color.b];
      for (let v = 0; v < pos.length / 3; v++) fCol.push(rgb);
      fIdx.push(indexOf(g), base);
      g.dispose();

      const s = stroke(coords);
      const sPos = s.getAttribute('position')?.array;
      if (sPos) {
        const sBase = bPos.length / 3;
        bPos.push(sPos);
        bIdx.push(indexOf(s), sBase);
      }
      s.dispose();
    }
    fRanges.push({ start: fStart, count: fIdx.length - fStart });
    bRanges.push({ start: bStart, count: bIdx.length - bStart });
  });

  const fillIndexAll = fIdx.done() as Uint32Array;
  const borderIndexAll = bIdx.done() as Uint32Array;

  const fillGeom = new THREE.BufferGeometry();
  fillGeom.setAttribute('position', new THREE.BufferAttribute(fPos.done(), 3));
  fillGeom.setAttribute('normal', new THREE.BufferAttribute(fNor.done(), 3));
  fillGeom.setAttribute('color', new THREE.BufferAttribute(fCol.done(), 3));
  const fillIndex = new THREE.BufferAttribute(fillIndexAll.slice(), 1);
  fillGeom.setIndex(fillIndex);
  fillGeom.computeBoundingSphere();
  const fillMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const fills = new THREE.Mesh(fillGeom, fillMat);
  fills.scale.setScalar(1 + BASE_ALT);

  const borderGeom = new THREE.BufferGeometry();
  borderGeom.setAttribute('position', new THREE.BufferAttribute(bPos.done(), 3));
  const borderIndex = new THREE.BufferAttribute(borderIndexAll.slice(), 1);
  borderGeom.setIndex(borderIndex);
  borderGeom.computeBoundingSphere();
  const borderMat = new THREE.LineBasicMaterial({ color: INK });
  const borders = new THREE.LineSegments(borderGeom, borderMat);
  borders.scale.setScalar(1 + BASE_ALT + STROKE_LIFT);

  // ---- graticule: the paths layer's Line + dashed-line ShaderMaterial, merged ----
  const gratGeom = new THREE.BufferGeometry();
  gratGeom.setAttribute(
    'position',
    new THREE.BufferAttribute(
      pathSegments(
        graticule().map((l) => l.pts),
        GRATICULE_ALT,
        PATH_RESOLUTION,
      ),
      3,
    ),
  );
  gratGeom.computeBoundingSphere();
  const gratMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Vector4(...shaderRgba(GRATICULE_COLOR)) } },
    vertexShader: `
      ${THREE.ShaderChunk.common}
      ${THREE.ShaderChunk.logdepthbuf_pars_vertex}
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${THREE.ShaderChunk.logdepthbuf_vertex}
      }`,
    fragmentShader: `
      ${THREE.ShaderChunk.logdepthbuf_pars_fragment}
      uniform vec4 color;
      void main() {
        gl_FragColor = color;
        ${THREE.ShaderChunk.logdepthbuf_fragment}
      }`,
    transparent: true,
    blending: THREE.NormalBlending,
  });
  const grat = new THREE.LineSegments(gratGeom, gratMat);
  // three-globe created polygon objects before path lines, so its (transparent) side walls drew first.
  grat.renderOrder = 1;

  const root = new THREE.Group();
  root.name = 'atlas-layers';
  root.add(fills, borders, grat);
  for (const o of [fills, borders, grat]) o.raycast = noRaycast;

  // ---- highlights ----
  const highlights = new Map<number, Highlight>();
  const excluded = new Set<number>();
  let excludedKey = '';

  const rebuildBase = () => {
    const key = [...excluded].sort((a, b) => a - b).join(',');
    if (key === excludedKey) return;
    excludedKey = key;
    const skip = (i: number) => excluded.has(i);
    const fn = compactRanges(fillIndexAll, fRanges, skip, fillIndex.array as Uint32Array);
    fillGeom.setDrawRange(0, fn);
    fillIndex.clearUpdateRanges();
    fillIndex.addUpdateRange(0, fn);
    fillIndex.needsUpdate = true;
    const bn = compactRanges(borderIndexAll, bRanges, skip, borderIndex.array as Uint32Array);
    borderGeom.setDrawRange(0, bn);
    borderIndex.clearUpdateRanges();
    borderIndex.addUpdateRange(0, bn);
    borderIndex.needsUpdate = true;
  };

  const applyAlt = (h: Highlight) => {
    h.mesh.scale.setScalar(1 + h.alt);
    h.walls.scale.setScalar(1 + h.alt);
    h.lines.scale.setScalar(1 + h.alt + STROKE_LIFT);
    h.surfaceRadius.value = GLOBE_RADIUS / (h.alt + 1);
  };

  // Highlight geometry per country, built on first hover and kept: it is tiny (indices into the base
  // buffers plus one wall fan), whereas re-triangulating a big country (Russia) took ~70ms mid-hover.
  interface HighlightGeom {
    cap: THREE.BufferGeometry;
    walls: THREE.BufferGeometry;
    lines: THREE.BufferGeometry;
  }
  const geomCache = new Map<number, HighlightGeom>();
  const fillPosAttr = fillGeom.getAttribute('position') as THREE.BufferAttribute;
  const fillNorAttr = fillGeom.getAttribute('normal') as THREE.BufferAttribute;
  const borderPosAttr = borderGeom.getAttribute('position') as THREE.BufferAttribute;

  const highlightGeom = (item: number): HighlightGeom => {
    let g = geomCache.get(item);
    if (g) return g;
    // Caps: the country's own triangles of the merged base (same vertices, same normals).
    const fr = fRanges[item];
    const cap = new THREE.BufferGeometry();
    cap.setAttribute('position', fillPosAttr);
    cap.setAttribute('normal', fillNorAttr);
    cap.setIndex(new THREE.BufferAttribute(fillIndexAll.slice(fr.start, fr.start + fr.count), 1));
    cap.computeBoundingSphere();
    // Border: the country's own segments of the merged base.
    const br = bRanges[item];
    const segs = borderIndexAll.subarray(br.start, br.start + br.count);
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', borderPosAttr);
    lines.setIndex(new THREE.BufferAttribute(segs.slice(), 1));
    lines.computeBoundingSphere();
    // Side walls: three-globe's conic torso runs from the centre (bottomHeight 0) up to each densified
    // ring edge, i.e. one triangle (centre, a, b) per border segment (same rings, same resolution).
    const bp = borderPosAttr.array as Float32Array;
    const wp = new Float32Array((segs.length / 2) * 9);
    for (let s = 0, o = 0; s < segs.length; s += 2, o += 9) {
      const a = segs[s] * 3;
      const b = segs[s + 1] * 3;
      wp[o + 3] = bp[a];
      wp[o + 4] = bp[a + 1];
      wp[o + 5] = bp[a + 2];
      wp[o + 6] = bp[b];
      wp[o + 7] = bp[b + 1];
      wp[o + 8] = bp[b + 2];
    }
    const walls = new THREE.BufferGeometry();
    walls.setAttribute('position', new THREE.BufferAttribute(wp, 3));
    walls.computeBoundingSphere();
    geomCache.set(item, (g = { cap, walls, lines }));
    return g;
  };

  const createHighlight = (item: number): Highlight => {
    const g = highlightGeom(item);
    const { material: wall, surfaceRadius } = wallMaterial();
    const cap = new THREE.MeshLambertMaterial();
    const mesh = new THREE.Mesh(g.cap, cap);
    const walls = new THREE.Mesh(g.walls, wall);
    const lines = new THREE.LineSegments(g.lines, borderMat);
    mesh.raycast = noRaycast;
    walls.raycast = noRaycast;
    lines.raycast = noRaycast;
    const group = new THREE.Group();
    group.add(walls, mesh, lines);
    const h: Highlight = { item, group, mesh, walls, lines, cap, wall, surfaceRadius, alt: BASE_ALT, from: BASE_ALT, to: BASE_ALT, t0: NaN, active: true };
    applyAlt(h);
    root.add(group);
    return h;
  };

  // Geometries are cached (and the caps/lines share the base's attributes, which a geometry
  // dispose would free on the GPU), so only the materials go here.
  const disposeHighlight = (h: Highlight) => {
    root.remove(h.group);
    h.cap.dispose();
    h.wall.dispose();
  };

  const retarget = (h: Highlight, to: number) => {
    if (h.to === to) return;
    h.from = h.alt;
    h.to = to;
    h.t0 = NaN;
  };

  return {
    object: root,

    setHighlight(hover, selected) {
      const want = new Map<number, 'hover' | 'selected'>();
      for (const i of (hover && byName.get(hover)) || []) want.set(i, 'hover');
      for (const i of (selected && byName.get(selected)) || []) want.set(i, 'selected');

      for (const [i, h] of highlights) {
        if (want.has(i) || !h.active) continue;
        // Colour and walls revert at once; the altitude eases back down.
        h.active = false;
        h.cap.color.set(fillFor(names[i]));
        h.wall.visible = false;
        retarget(h, BASE_ALT);
      }
      for (const [i, kind] of want) {
        let h = highlights.get(i);
        if (!h) highlights.set(i, (h = createHighlight(i)));
        h.active = true;
        const fill = fillFor(names[i]);
        h.cap.color.set(inked(fill, kind === 'selected' ? SELECT_INK : HOVER_INK));
        h.wall.visible = true;
        retarget(h, kind === 'selected' ? SELECT_ALT : HOVER_ALT);
        excluded.add(i);
      }
      rebuildBase();
    },

    update(now) {
      let animating = false;
      for (const [i, h] of highlights) {
        if (h.alt !== h.to) {
          if (Number.isNaN(h.t0)) h.t0 = now;
          const k = Math.min(1, Math.max(0, (now - h.t0) / TRANSITION_MS));
          h.alt = k >= 1 ? h.to : h.from + (h.to - h.from) * quadInOut(k);
          applyAlt(h);
          if (h.alt !== h.to) animating = true;
        }
        if (!h.active && h.alt === h.to) {
          disposeHighlight(h);
          highlights.delete(i);
          excluded.delete(i);
        }
      }
      rebuildBase();
      return animating;
    },

    dispose() {
      for (const h of highlights.values()) disposeHighlight(h);
      highlights.clear();
      fillGeom.dispose();
      borderGeom.dispose();
      gratGeom.dispose();
      // Cached highlight geometries share the base's attributes: free them only after the base.
      for (const g of geomCache.values()) {
        g.cap.dispose();
        g.lines.dispose();
        g.walls.dispose();
      }
      geomCache.clear();
      fillMat.dispose();
      borderMat.dispose();
      gratMat.dispose();
      root.removeFromParent();
    },
  };
}
