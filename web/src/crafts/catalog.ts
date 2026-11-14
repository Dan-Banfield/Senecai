// Every craft on the globe, pinned to the region it comes from, and what each
// one teaches a robot hand: the kantele (fine finger control and timing) and the
// puukko (tool use, heat and force control).
//
// Photos come from Wikimedia Commons, resized, with credits shown in the cards.

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

const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;

export const CRAFTS: CraftInfo[] = [
  {
    id: 'kantele',
    name: 'Kantele',
    localName: 'kantele',
    country: 'Finland',
    region: 'Karelia, eastern Finland',
    lat: 62.7,
    lng: 30.3,
    blurb: "Finland's national instrument, a plucked zither at the heart of Karelian runo-song. In the Kalevala, Väinämöinen carves the first one from a giant pike's jawbone.",
    robotSkills: ['fine finger control', 'timing'],
    status: 'playable',
    route: '/kantele',
    image: { src: '/crafts/kantele.jpg', alt: 'Two five-string kanteles lying on grass', author: 'TheYellowFellow', license: 'CC0', source: commons('Five_string_kanteles.jpg') },
  },
  {
    id: 'puukko',
    name: 'Puukko',
    localName: 'puukko',
    country: 'Finland',
    region: 'Kauhava, Ostrobothnia, Finland',
    lat: 63.1,
    lng: 23.06,
    blurb: 'The Finnish belt knife: a short single-edged blade with a birch handle. Kauhava has been famous for its puukko smiths for well over a century.',
    robotSkills: ['tool use', 'heat', 'force control'],
    status: 'playable',
    route: '/craft/puukko',
    image: { src: '/crafts/puukko.jpg', alt: 'A puukko knife and a filleting knife with a leather sheath', author: 'Kuroczynski', license: 'CC BY-SA 4.0', source: commons('%E2%80%9EIMG_5221_Puukko_and_fish_filleting_knife_with_sheath_by_J._Marttiini_(cropped).jpg') },
  },
];

export const craftById = (id: string) => CRAFTS.find((c) => c.id === id);
