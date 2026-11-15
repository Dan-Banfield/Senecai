// Country shapes and small spherical-geometry helpers for the globe.

import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import countries110 from 'world-atlas/countries-110m.json';
import countries50 from 'world-atlas/countries-50m.json';

export type CountryFeature = Feature<Polygon | MultiPolygon, { name: string }>;

type CountriesTopo = Topology<{ countries: GeometryCollection<{ name: string }> }>;
const toFeatures = (t: unknown) => {
  const topo = t as CountriesTopo;
  return feature(topo, topo.objects.countries).features as CountryFeature[];
};

/**
 * The coarse 110m map keeps the globe light, but leaves out small countries
 * (Singapore, Malta, Bahrain…). Those are filled in from the 50m map so every
 * country can be searched, clicked and landed on.
 */
export function loadCountries(): CountryFeature[] {
  const coarse = toFeatures(countries110).filter((f) => f.properties.name !== 'Antarctica');
  const have = new Set(coarse.map((f) => f.properties.name));
  const small = toFeatures(countries50).filter((f) => !have.has(f.properties.name) && f.properties.name !== 'Antarctica');
  return [...coarse, ...small];
}

const RAD = Math.PI / 180;
type Vec = [number, number, number];
const toVec = (lng: number, lat: number): Vec => [Math.cos(lat * RAD) * Math.cos(lng * RAD), Math.cos(lat * RAD) * Math.sin(lng * RAD), Math.sin(lat * RAD)];

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const va = toVec(a.lng, a.lat);
  const vb = toVec(b.lng, b.lat);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  return Math.acos(dot) * 6371;
}

/**
 * Centre of a country's largest landmass (averaged on the sphere, so it's safe
 * across the antimeridian) and its angular size in degrees.
 */
export function countryView(f: CountryFeature): { lat: number; lng: number; spanDeg: number } {
  const polys: Position[][][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const ring = polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0];
  const sum: Vec = [0, 0, 0];
  for (const [lng, lat] of ring) {
    const v = toVec(lng, lat);
    sum[0] += v[0];
    sum[1] += v[1];
    sum[2] += v[2];
  }
  const n = Math.hypot(...sum) || 1;
  const c: Vec = [sum[0] / n, sum[1] / n, sum[2] / n];
  let maxAngle = 0;
  for (const [lng, lat] of ring) {
    const v = toVec(lng, lat);
    maxAngle = Math.max(maxAngle, Math.acos(Math.min(1, v[0] * c[0] + v[1] * c[1] + v[2] * c[2])));
  }
  return { lat: Math.asin(c[2]) / RAD, lng: Math.atan2(c[1], c[0]) / RAD, spanDeg: (2 * maxAngle) / RAD };
}

/** Camera altitude (in globe radii) that frames a region of the given angular size. */
export const altitudeForSpan = (spanDeg: number) => Math.min(2.4, Math.max(0.42, spanDeg * 0.028 + 0.1));

export function inRingPlanar(ring: Position[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ray-casting point-in-ring, made safe for rings that cross the antimeridian (e.g. Russia, Fiji). */
export function inRing(ring: Position[], lng: number, lat: number) {
  const crosses = ring.some(([x], i) => i > 0 && Math.abs(x - ring[i - 1][0]) > 180);
  if (!crosses) return inRingPlanar(ring, lng, lat);
  const wrap = (x: number) => (x < 0 ? x + 360 : x);
  return inRingPlanar(
    ring.map(([x, y]) => [wrap(x), y]),
    wrap(lng),
    lat,
  );
}

/**
 * Which country a point is in. The 110m outlines are coarse, so coastal and
 * island towns can fall just outside; then we take the nearest country within
 * ~250 km.
 */
export function countryAt(features: CountryFeature[], lat: number, lng: number): string | undefined {
  let nearest: { name: string; d: number } | undefined;
  let hit: string | undefined;
  for (const f of features) {
    const polys: Position[][][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      // Keep looking after a hit: small countries come last and can sit inside a coarse
      // outline with no hole for them (the Vatican and San Marino inside Italy).
      if (inRing(poly[0], lng, lat) && !poly.slice(1).some((hole) => inRing(hole, lng, lat))) hit = f.properties.name;
      if (hit) continue;
      for (const [x, y] of poly[0]) {
        const d = distanceKm({ lat, lng }, { lat: y, lng: x });
        if (!nearest || d < nearest.d) nearest = { name: f.properties.name, d };
      }
    }
  }
  if (hit) return hit;
  return nearest && nearest.d < 250 ? nearest.name : undefined;
}

/**
 * Give each country one of `k` map colours so that neighbours (countries that
 * share a border) differ, the way a printed atlas colours them. Each country
 * starts from a colour picked from its name, so the result is stable.
 */
export function mapColours(countries: CountryFeature[], k: number): Map<string, number> {
  const owners = new Map<string, Set<number>>();
  countries.forEach((f, i) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys)
      for (const ring of poly)
        for (const [x, y] of ring) {
          const key = `${x.toFixed(3)},${y.toFixed(3)}`;
          let s = owners.get(key);
          if (!s) owners.set(key, (s = new Set()));
          s.add(i);
        }
  });
  const adj = countries.map(() => new Set<number>());
  for (const s of owners.values()) if (s.size > 1) for (const a of s) for (const b of s) if (a !== b) adj[a].add(b);
  const order = countries.map((_, i) => i).sort((a, b) => adj[b].size - adj[a].size);
  const colour = new Array<number>(countries.length).fill(-1);
  for (const i of order) {
    const used = new Set([...adj[i]].map((j) => colour[j]));
    let h = 0;
    for (const ch of countries[i].properties.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    let c = h % k;
    for (let t = 0; t < k; t++) {
      if (!used.has((h + t) % k)) {
        c = (h + t) % k;
        break;
      }
    }
    colour[i] = c;
  }
  return new Map(countries.map((f, i) => [f.properties.name, colour[i]]));
}
