// Every craft on the globe, pinned to the region it comes from, and what each
// one teaches a robot hand. Empty for now: add an entry (and its page and
// route) to put a craft on the map. Photos go in web/public/crafts/ (640px).

export interface CraftImage {
  src: string;
  alt: string;
  author: string;
  license: string;
  source: string;
}

export interface CraftInfo {
  id: string;
  name: string;
  /** Name in the local language, shown in italics. */
  localName: string;
  /** Must match the country name in world-atlas (countries-110m). */
  country: string;
  region: string;
  lat: number;
  lng: number;
  blurb: string;
  /** What practising this craft teaches a robot hand. */
  robotSkills: string[];
  status: 'playable' | 'soon';
  route?: string;
  image: CraftImage;
}

export const CRAFTS: CraftInfo[] = [];

export const craftById = (id: string) => CRAFTS.find((c) => c.id === id);
