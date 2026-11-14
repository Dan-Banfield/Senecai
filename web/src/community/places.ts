// Where a creation was made, so it can be pinned on the globe.

export interface GeoPoint {
  lat: number;
  lng: number;
  place: string;
  /** Country name as in world-atlas, when known (otherwise looked up from lat/lng). */
  country?: string;
}

export const PLACES: GeoPoint[] = [
  { place: 'Espoo, Finland (Junction 2026)', lat: 60.185, lng: 24.83, country: 'Finland' },
  { place: 'Helsinki, Finland', lat: 60.17, lng: 24.94, country: 'Finland' },
  { place: 'Tampere, Finland', lat: 61.5, lng: 23.76, country: 'Finland' },
  { place: 'Turku, Finland', lat: 60.45, lng: 22.27, country: 'Finland' },
  { place: 'Jyväskylä, Finland', lat: 62.24, lng: 25.75, country: 'Finland' },
  { place: 'Joensuu, Finland', lat: 62.6, lng: 29.76, country: 'Finland' },
  { place: 'Oulu, Finland', lat: 65.01, lng: 25.47, country: 'Finland' },
  { place: 'Rovaniemi, Finland', lat: 66.5, lng: 25.73, country: 'Finland' },
  { place: 'Inari, Finland', lat: 68.91, lng: 27.03, country: 'Finland' },
  { place: 'Stockholm, Sweden', lat: 59.33, lng: 18.07, country: 'Sweden' },
  { place: 'Oslo, Norway', lat: 59.91, lng: 10.75, country: 'Norway' },
  { place: 'Copenhagen, Denmark', lat: 55.68, lng: 12.57, country: 'Denmark' },
  { place: 'Tallinn, Estonia', lat: 59.44, lng: 24.75, country: 'Estonia' },
  { place: 'Riga, Latvia', lat: 56.95, lng: 24.11, country: 'Latvia' },
  { place: 'Warsaw, Poland', lat: 52.23, lng: 21.01, country: 'Poland' },
  { place: 'Berlin, Germany', lat: 52.52, lng: 13.4, country: 'Germany' },
  { place: 'Amsterdam, Netherlands', lat: 52.37, lng: 4.9, country: 'Netherlands' },
  { place: 'London, UK', lat: 51.51, lng: -0.13, country: 'United Kingdom' },
  { place: 'Edinburgh, UK', lat: 55.95, lng: -3.19, country: 'United Kingdom' },
  { place: 'Paris, France', lat: 48.86, lng: 2.35, country: 'France' },
  { place: 'Madrid, Spain', lat: 40.42, lng: -3.7, country: 'Spain' },
  { place: 'Lisbon, Portugal', lat: 38.72, lng: -9.14, country: 'Portugal' },
  { place: 'Rome, Italy', lat: 41.9, lng: 12.5, country: 'Italy' },
  { place: 'Athens, Greece', lat: 37.98, lng: 23.73, country: 'Greece' },
  { place: 'Kyiv, Ukraine', lat: 50.45, lng: 30.52, country: 'Ukraine' },
  { place: 'New York, USA', lat: 40.71, lng: -74.01, country: 'United States of America' },
  { place: 'Montréal, Canada', lat: 45.5, lng: -73.57, country: 'Canada' },
  { place: 'San Francisco, USA', lat: 37.77, lng: -122.42, country: 'United States of America' },
  { place: 'São Paulo, Brazil', lat: -23.55, lng: -46.63, country: 'Brazil' },
  { place: 'Nairobi, Kenya', lat: -1.29, lng: 36.82, country: 'Kenya' },
  { place: 'Tokyo, Japan', lat: 35.68, lng: 139.69, country: 'Japan' },
  { place: 'Kyoto, Japan', lat: 35.01, lng: 135.77, country: 'Japan' },
  { place: 'Seoul, South Korea', lat: 37.57, lng: 126.98, country: 'South Korea' },
  { place: 'Sydney, Australia', lat: -33.87, lng: 151.21, country: 'Australia' },
];

export const DEFAULT_PLACE = PLACES[0];
export const placeByName = (name: string) => PLACES.find((p) => p.place === name);
