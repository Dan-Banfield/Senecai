// Fast exact point-in-country lookup for pointer hover. Unlike `countryAt`
// there is no nearest-country fallback: a hit means the point is inside the
// outline, the same thing a ray hitting the country's mesh would say.

import type { Position } from 'geojson';
import { inRingPlanar, type CountryFeature } from './geo';

export interface CountryIndex {
  at(lat: number, lng: number): string | undefined;
}

/** A ring ready for planar ray casting: longitudes already shifted into 0..360 if it crosses the antimeridian. */
interface PreparedRing {
  pts: Position[];
  wrapped: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface PreparedPolygon {
  name: string;
  outer: PreparedRing;
  holes: PreparedRing[];
}

const wrap = (x: number) => (x < 0 ? x + 360 : x);

function prepareRing(ring: Position[]): PreparedRing {
  const wrapped = ring.some(([x], i) => i > 0 && Math.abs(x - ring[i - 1][0]) > 180);
  const pts = wrapped ? ring.map(([x, y]) => [wrap(x), y]) : ring;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { pts, wrapped, minX, maxX, minY, maxY };
}

function inPrepared(r: PreparedRing, lng: number, lat: number) {
  if (lat < r.minY || lat > r.maxY) return false;
  const x = r.wrapped ? wrap(lng) : lng;
  if (x < r.minX || x > r.maxX) return false;
  return inRingPlanar(r.pts, x, lat);
}

export function createCountryIndex(countries: CountryFeature[]): CountryIndex {
  const polys: PreparedPolygon[] = [];
  for (const f of countries) {
    const parts: Position[][][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of parts) {
      if (!p.length) continue;
      polys.push({ name: f.properties.name, outer: prepareRing(p[0]), holes: p.slice(1).map(prepareRing) });
    }
  }
  return {
    at(lat, lng) {
      for (const p of polys) {
        if (!inPrepared(p.outer, lng, lat)) continue;
        if (p.holes.some((h) => inPrepared(h, lng, lat))) continue;
        return p.name;
      }
      return undefined;
    },
  };
}
