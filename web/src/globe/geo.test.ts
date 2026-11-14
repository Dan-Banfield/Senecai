import { describe, expect, it } from 'vitest';
import { PLACES } from '../community/places';
import { generateSeeds } from '../community/seed';
import { CRAFTS } from '../crafts/catalog';
import { altitudeForSpan, countryAt, countryView, distanceKm, loadCountries, mapColours } from './geo';

const countries = loadCountries();
const names = new Set(countries.map((c) => c.properties.name));

describe('globe geography', () => {
  it('finds the right country, including next to antimeridian-crossing Russia', () => {
    expect(countryAt(countries, 66.5, 25.73)).toBe('Finland'); // Rovaniemi
    expect(countryAt(countries, 68.91, 27.03)).toBe('Finland'); // Inari
    expect(countryAt(countries, 60.17, 24.94)).toBe('Finland'); // Helsinki (coastal)
    expect(countryAt(countries, 55.75, 37.62)).toBe('Russia'); // Moscow
    expect(countryAt(countries, 64.73, 177.5)).toBe('Russia'); // Anadyr, far east
    expect(countryAt(countries, 35.01, 135.77)).toBe('Japan');
    expect(countryAt(countries, 0, -30)).toBeUndefined(); // mid-Atlantic
  });

  it('every craft, place and seed names a country that exists on the map', () => {
    for (const c of CRAFTS) expect(names, c.id).toContain(c.country);
    for (const p of PLACES) expect(names, p.place).toContain(p.country);
    for (const s of generateSeeds()) expect(names, s.id).toContain(s.location?.country);
  });

  it('craft pins sit inside (or right next to) their country', () => {
    for (const c of CRAFTS) expect([c.country, undefined], c.id).toContain(countryAt(countries, c.lat, c.lng) ?? c.country);
  });

  it('frames countries sensibly', () => {
    const fin = countries.find((c) => c.properties.name === 'Finland')!;
    const v = countryView(fin);
    expect(distanceKm(v, { lat: 64.5, lng: 26 })).toBeLessThan(250);
    expect(altitudeForSpan(v.spanDeg)).toBeLessThan(0.8);
    const rus = countries.find((c) => c.properties.name === 'Russia')!;
    expect(altitudeForSpan(countryView(rus).spanDeg)).toBeGreaterThan(1.5);
  });

  it('learned-from seeds point at real seeds', () => {
    const seeds = generateSeeds();
    const ids = new Set(seeds.map((s) => s.id));
    const learned = seeds.filter((s) => s.learnedFrom);
    expect(learned.length).toBeGreaterThanOrEqual(2);
    for (const s of learned) expect(ids).toContain(s.learnedFrom!.id);
  });

  it('colours neighbouring countries differently, like a printed atlas', () => {
    const countries = loadCountries();
    const ink = mapColours(countries, 6);
    for (const [a, b] of [['Finland', 'Sweden'], ['Finland', 'Russia'], ['Norway', 'Sweden'], ['France', 'Spain'], ['Germany', 'Poland'], ['United States of America', 'Canada'], ['Brazil', 'Argentina']]) {
      expect(ink.get(a)).not.toBe(ink.get(b));
    }
  });
});
