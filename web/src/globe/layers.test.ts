import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCountries } from './geo';
import type { AtlasLayers } from './layers';

// The geometry libraries look for a global THREE on `window` when imported.
(globalThis as { window?: object }).window ??= {};

const countries = loadCountries();
let layers: AtlasLayers;

const drawCount = (o: THREE.Object3D) => {
  const g = (o as THREE.Mesh).geometry;
  return Math.min(g.drawRange.count, g.getIndex()!.count);
};

beforeAll(async () => {
  const { createAtlasLayers } = await import('./layers');
  layers = createAtlasLayers(countries, () => '#e9dc9e');
}, 60_000);

describe('merged atlas layers', () => {
  it('draws the whole base map in three objects', () => {
    const [fills, borders, grat] = layers.object.children;
    expect(layers.object.children).toHaveLength(3);
    expect(fills).toBeInstanceOf(THREE.Mesh);
    expect(borders).toBeInstanceOf(THREE.LineSegments);
    expect(grat).toBeInstanceOf(THREE.LineSegments);
    expect(fills.scale.x).toBeCloseTo(1.005);
    expect(borders.scale.x).toBeCloseTo(1.0051);
  });

  it('lifts highlighted countries out of the base and animates them back', () => {
    const [fills, borders] = layers.object.children;
    const fullFill = drawCount(fills);
    const fullBorder = drawCount(borders);

    layers.setHighlight('Finland', 'Indonesia');
    expect(layers.object.children).toHaveLength(5);
    expect(drawCount(fills)).toBeLessThan(fullFill);
    expect(drawCount(borders)).toBeLessThan(fullBorder);

    expect(layers.update(1000)).toBe(true);
    expect(layers.update(1130)).toBe(true);
    expect(layers.update(1260)).toBe(false);
    const hl = layers.object.children.slice(3).map((g) => g.children[0].scale.x);
    expect(hl.sort()).toEqual([1.014, 1.02]);

    layers.setHighlight(null, 'Indonesia');
    expect(layers.update(2000)).toBe(true);
    expect(layers.object.children).toHaveLength(5);
    expect(layers.update(2260)).toBe(false);
    expect(layers.object.children).toHaveLength(4);

    layers.setHighlight(null, null);
    layers.update(3000);
    layers.update(3300);
    expect(layers.object.children).toHaveLength(3);
    expect(drawCount(fills)).toBe(fullFill);
    expect(drawCount(borders)).toBe(fullBorder);
  });
});
