import { describe, expect, it } from 'vitest';
import { countryAt, loadCountries } from './geo';
import { createCountryIndex } from './hit';

const countries = loadCountries();
const index = createCountryIndex(countries);

describe('country hit index', () => {
  it('finds countries by exact outline', () => {
    expect(index.at(66.5, 25.73)).toBe('Finland'); // Rovaniemi
    expect(index.at(62.0, 26.0)).toBe('Finland');
    expect(index.at(55.75, 37.62)).toBe('Russia'); // Moscow
    expect(index.at(35.01, 135.77)).toBe('Japan');
    expect(index.at(48.86, 2.35)).toBe('France');
  });

  it('has no nearest-country fallback', () => {
    expect(index.at(0, -30)).toBeUndefined(); // mid-Atlantic
    expect(index.at(-40, -120)).toBeUndefined(); // South Pacific
    expect(index.at(-85, 0)).toBeUndefined(); // Antarctica is not on the map
  });

  it('handles rings that cross the antimeridian', () => {
    expect(index.at(64.73, 177.5)).toBe('Russia'); // Anadyr
    expect(index.at(66.0, -175.0)).toBe('Russia'); // Chukotka, west of 180
    expect(index.at(-17.8, 178.0)).toBe('Fiji'); // Viti Levu
    expect(index.at(-16.6, 179.4)).toBe('Fiji'); // Vanua Levu
    expect(index.at(0, 180)).toBeUndefined();
  });

  it('respects holes', () => {
    expect(index.at(-29.5, 28.25)).toBe('Lesotho'); // inside the hole in South Africa
    expect(index.at(-26.2, 28.05)).toBe('South Africa'); // Johannesburg
  });

  it('agrees with countryAt wherever the point is strictly inside a country', () => {
    for (let lat = -60; lat <= 80; lat += 7) {
      for (let lng = -180; lng < 180; lng += 9) {
        const hit = index.at(lat, lng);
        if (hit) expect(countryAt(countries, lat, lng)).toBe(hit);
      }
    }
  });
});
