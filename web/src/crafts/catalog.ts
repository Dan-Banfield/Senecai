// Every craft on the globe, pinned to the region it comes from, and what each
// one teaches a robot hand. Add an entry (and its page and route) to put a
// craft on the map. Photos go in web/public/crafts/ (640px).

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

const commons = (f: string) => `https://commons.wikimedia.org/wiki/File:${f}`;

export const CRAFTS: CraftInfo[] = [
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
    robotSkills: [
      'independent finger isolation',
      'sealing holes with fingertip pads',
      'timed finger-lift sequences',
      'two-hand coordination',
    ],
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

export const craftById = (id: string) => CRAFTS.find((c) => c.id === id);
