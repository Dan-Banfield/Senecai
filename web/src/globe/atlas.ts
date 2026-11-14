// The look of an old printed atlas: paper-toned country colours, a mottled
// sea, a graticule, and serif labels for countries, oceans and capitals.

import * as THREE from 'three';
import { countryView, type CountryFeature } from './geo';

/** Muted printer's inks for countries; neighbours get different ones. */
export const ATLAS_INKS = ['#e9dc9e', '#d6d1e5', '#e8c5c5', '#edd1a5', '#c8d6d9', '#dcd8b4'];
/** Countries with a craft to learn stand out in green. */
export const CRAFT_INK = '#b2cd92';
/** Borders, grid and lettering. */
export const INK = '#4e3d2b';
export const SEA = '#a5b8b6';

/** Darken a fill towards the brown ink, for hover and selection. */
export function inked(fill: string, k: number) {
  return '#' + new THREE.Color(fill).lerp(new THREE.Color(INK), k).getHexString();
}

/** A sea texture with the faint mottling of printed paper. */
export function seaTexture() {
  const w = 2048;
  const h = 1024;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = SEA;
  ctx.fillRect(0, 0, w, h);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 4 + rnd() * 40;
    const light = rnd() < 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, light ? 'rgba(232,236,226,0.035)' : 'rgba(60,80,82,0.03)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Lines of latitude and longitude every 15°. */
export function graticule(): { pts: [number, number][] }[] {
  const lines: { pts: [number, number][] }[] = [];
  for (let lng = -180; lng < 180; lng += 15) {
    const pts: [number, number][] = [];
    for (let lat = -80; lat <= 80; lat += 4) pts.push([lat, lng]);
    lines.push({ pts });
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const pts: [number, number][] = [];
    for (let lng = -180; lng <= 180; lng += 4) pts.push([lat, lng]);
    lines.push({ pts });
  }
  return lines;
}

export interface MapLabel {
  id: string;
  kind: 'label';
  style: 'country' | 'ocean' | 'sea' | 'capital';
  text: string;
  lat: number;
  lng: number;
  /** 1 = shown from far out, 2 = once you zoom in a little, 3 = only up close. */
  tier: 1 | 2 | 3;
}

const SHORT: Record<string, string> = {
  'United States of America': 'United States',
  'Dem. Rep. Congo': 'D. R. Congo',
  'Central African Rep.': 'Central African Rep.',
  'Bosnia and Herz.': 'Bosnia',
  'Dominican Rep.': 'Dominican Rep.',
  'W. Sahara': 'W. Sahara',
};

const OCEANS: [string, number, number, 1 | 2 | 3][] = [
  ['North Pacific Ocean', 28, -152, 1],
  ['South Pacific Ocean', -32, -118, 1],
  ['North Atlantic Ocean', 33, -42, 1],
  ['South Atlantic Ocean', -28, -16, 1],
  ['Indian Ocean', -22, 78, 1],
  ['Arctic Ocean', 83, 10, 1],
  ['Southern Ocean', -62, 40, 1],
];

const SEAS: [string, number, number, 1 | 2 | 3][] = [
  ['Mediterranean Sea', 35, 18, 2],
  ['Baltic Sea', 57.5, 19.3, 2],
  ['Norwegian Sea', 68, 2, 2],
  ['North Sea', 56, 3, 2],
  ['Black Sea', 43.3, 34.5, 2],
  ['Caribbean Sea', 15, -76, 2],
  ['Gulf of Mexico', 25, -90, 2],
  ['Arabian Sea', 14, 63, 2],
  ['Bay of Bengal', 14, 88, 2],
  ['South China Sea', 13, 114, 2],
  ['Sea of Japan', 40, 135, 2],
  ['Hudson Bay', 60, -86, 2],
  ['Labrador Sea', 58, -54, 2],
  ['Bering Sea', 58, -178, 2],
  ['Coral Sea', -17, 156, 2],
  ['Tasman Sea', -40, 162, 2],
  ['Gulf of Bothnia', 62.8, 20.3, 3],
  ['Gulf of Finland', 59.8, 26, 3],
  ['Red Sea', 20, 38.6, 3],
  ['Barents Sea', 74, 40, 2],
];

/** Capitals: name, lat, lng, and 2 for the big ones shown from further out. */
const CAPITALS: [string, number, number, 2 | 3][] = [
  ['Washington', 38.9, -77.04, 2], ['Ottawa', 45.42, -75.7, 2], ['Mexico City', 19.43, -99.13, 2], ['Havana', 23.11, -82.37, 3],
  ['Bogotá', 4.71, -74.07, 3], ['Caracas', 10.48, -66.9, 3], ['Lima', -12.05, -77.04, 3], ['Quito', -0.18, -78.47, 3],
  ['La Paz', -16.5, -68.15, 3], ['Santiago', -33.45, -70.67, 3], ['Buenos Aires', -34.6, -58.38, 2], ['Montevideo', -34.9, -56.16, 3],
  ['Asunción', -25.26, -57.58, 3], ['Brasília', -15.79, -47.88, 2], ['Reykjavík', 64.15, -21.94, 3], ['Dublin', 53.35, -6.26, 3],
  ['London', 51.51, -0.13, 2], ['Paris', 48.86, 2.35, 2], ['Madrid', 40.42, -3.7, 3], ['Lisbon', 38.72, -9.14, 3],
  ['Brussels', 50.85, 4.35, 3], ['Amsterdam', 52.37, 4.9, 3], ['Berlin', 52.52, 13.4, 3], ['Copenhagen', 55.68, 12.57, 3],
  ['Oslo', 59.91, 10.75, 3], ['Stockholm', 59.33, 18.07, 3], ['Helsinki', 60.17, 24.94, 2], ['Tallinn', 59.44, 24.75, 3],
  ['Riga', 56.95, 24.11, 3], ['Vilnius', 54.69, 25.28, 3], ['Warsaw', 52.23, 21.01, 3], ['Prague', 50.08, 14.44, 3],
  ['Vienna', 48.21, 16.37, 3], ['Bern', 46.95, 7.45, 3], ['Rome', 41.9, 12.5, 3], ['Budapest', 47.5, 19.04, 3],
  ['Bucharest', 44.43, 26.1, 3], ['Athens', 37.98, 23.73, 3], ['Kyiv', 50.45, 30.52, 3], ['Minsk', 53.9, 27.57, 3],
  ['Moscow', 55.76, 37.62, 2], ['Ankara', 39.93, 32.86, 3], ['Cairo', 30.04, 31.24, 2], ['Rabat', 34.02, -6.84, 3],
  ['Algiers', 36.75, 3.06, 3], ['Tunis', 36.81, 10.18, 3], ['Dakar', 14.72, -17.47, 3], ['Abuja', 9.06, 7.5, 3],
  ['Accra', 5.6, -0.19, 3], ['Addis Ababa', 9.03, 38.74, 3], ['Nairobi', -1.29, 36.82, 3], ['Kinshasa', -4.44, 15.27, 3],
  ['Luanda', -8.84, 13.23, 3], ['Pretoria', -25.75, 28.19, 3], ['Riyadh', 24.71, 46.68, 3], ['Tehran', 35.69, 51.39, 3],
  ['Baghdad', 33.31, 44.36, 3], ['Kabul', 34.53, 69.17, 3], ['Islamabad', 33.68, 73.05, 3], ['New Delhi', 28.61, 77.21, 2],
  ['Dhaka', 23.81, 90.41, 3], ['Bangkok', 13.76, 100.5, 3], ['Hanoi', 21.03, 105.85, 3], ['Beijing', 39.9, 116.4, 2],
  ['Ulaanbaatar', 47.89, 106.91, 3], ['Seoul', 37.57, 126.98, 3], ['Tokyo', 35.68, 139.69, 2], ['Manila', 14.6, 120.98, 3],
  ['Jakarta', -6.21, 106.85, 3], ['Singapore', 1.35, 103.82, 3], ['Kuala Lumpur', 3.14, 101.69, 3], ['Canberra', -35.28, 149.13, 2],
  ['Wellington', -41.29, 174.78, 3], ['Astana', 51.17, 71.45, 3], ['Tashkent', 41.3, 69.24, 3],
];

/** Every label on the map. Big countries are lettered from far out, small ones only up close. */
export function mapLabels(countries: CountryFeature[]): MapLabel[] {
  const labels: MapLabel[] = [];
  for (const f of countries) {
    const v = countryView(f);
    if (v.spanDeg < 1.2) continue;
    const name = f.properties.name;
    labels.push({ id: `l-c-${name}`, kind: 'label', style: 'country', text: SHORT[name] ?? name, lat: v.lat, lng: v.lng, tier: v.spanDeg >= 26 ? 1 : v.spanDeg >= 6 ? 2 : 3 });
  }
  for (const [text, lat, lng, tier] of OCEANS) labels.push({ id: `l-o-${text}`, kind: 'label', style: 'ocean', text, lat, lng, tier });
  for (const [text, lat, lng, tier] of SEAS) labels.push({ id: `l-s-${text}`, kind: 'label', style: 'sea', text, lat, lng, tier });
  for (const [text, lat, lng, tier] of CAPITALS) labels.push({ id: `l-k-${text}`, kind: 'label', style: 'capital', text, lat, lng, tier });
  return labels;
}

const RAD = Math.PI / 180;
const unit = (lat: number, lng: number): [number, number, number] => [Math.cos(lat * RAD) * Math.cos(lng * RAD), Math.cos(lat * RAD) * Math.sin(lng * RAD), Math.sin(lat * RAD)];

/** Lettering on the map: countries, oceans, seas and capitals. Never in the way of clicks. */
export function labelElement(l: MapLabel): HTMLElement {
  const el = document.createElement('div');
  el.className = `map-label map-${l.style}`;
  el.dataset.tier = String(l.tier);
  el.textContent = l.text;
  el.dataset.v = unit(l.lat, l.lng).join(',');
  return el;
}

/**
 * Fade out lettering that has turned towards the edge of the globe (or round
 * the back), where it would crowd and overhang the rim, as a printed globe's
 * lettering foreshortens away.
 */
export function fadeLimb(root: ParentNode, view: { lat: number; lng: number }) {
  const c = unit(view.lat, view.lng);
  for (const el of root.querySelectorAll<HTMLElement>('.map-label')) {
    const v = el.dataset.v!.split(',').map(Number);
    el.classList.toggle('limb', v[0] * c[0] + v[1] * c[1] + v[2] * c[2] < 0.45);
  }
}

/** Which label tiers show at a camera altitude (globe radii). */
export function zoomBand(altitude: number): 'far' | 'mid' | 'near' {
  return altitude > 1.6 ? 'far' : altitude > 0.85 ? 'mid' : 'near';
}
