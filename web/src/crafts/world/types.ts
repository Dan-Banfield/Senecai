// A craft or instrument shown on the globe as "coming soon": a pin and a card,
// no lesson yet. `wiki` is the English Wikipedia article its photo is taken
// from (see web/scripts/fetch-craft-photos.mjs).

export interface WorldCraft {
  id: string;
  name: string;
  localName: string;
  /** Must match the country name in world-atlas. */
  country: string;
  region: string;
  lat: number;
  lng: number;
  wiki: string;
  blurb: string;
}
