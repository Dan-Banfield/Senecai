// Every craft on the globe, pinned to the region it comes from. Playable crafts (with a page and route) are listed
// here; the "coming soon" crafts and instruments live in ./world/, one file
// per region. Their photos are Wikimedia Commons links found by
// web/scripts/craft-photo-links.mjs; playable crafts keep theirs in web/public/crafts/.

import photos from './world/photos.json';
import { WORLD_CRAFTS } from './world';

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
  status: 'playable' | 'soon';
  route?: string;
  /** Missing when no freely licensed photo was found. */
  image?: CraftImage;
}

const commons = (f: string) => `https://commons.wikimedia.org/wiki/File:${f}`;

const PLAYABLE: CraftInfo[] = [
  {
    id: 'ocarina',
    name: 'Ocarina',
    localName: 'ocarina',
    country: 'Italy',
    region: 'Budrio, Emilia-Romagna',
    lat: 44.537,
    lng: 11.535,
    blurb:
      'A clay vessel flute that Giuseppe Donati turned into a 12-hole concert instrument in Budrio in 1853. Its pitch follows how much hole area is open, so every fingertip has to seal cleanly.',
    status: 'playable',
    route: '/craft/ocarina',
    image: {
      src: '/crafts/ocarina.jpg',
      alt: 'A turquoise crackle-glazed 12-hole ceramic ocarina',
      author: '0x010C',
      license: 'CC BY-SA 4.0',
      source: commons('2016-01_Ocarina_front.jpg'),
    },
  },
];

const PHOTOS = photos as Record<string, CraftImage>;

export const CRAFTS: CraftInfo[] = [
  ...PLAYABLE,
  ...WORLD_CRAFTS.map(({ wiki: _wiki, ...c }): CraftInfo => ({ ...c, status: 'soon', image: PHOTOS[c.id] })),
];

export const craftById = (id: string) => CRAFTS.find((c) => c.id === id);
