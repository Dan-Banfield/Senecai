// Every craft on the globe, pinned to the region it comes from. Kantele and kuksa
// are playable; the rest show where Senecai could go next, and what each craft
// would teach a robot (the Rokoko track's interests: fragile objects, tools,
// liquids, fine finger control).
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
    id: 'kuksa',
    name: 'Kuksa',
    localName: 'kuksa · guksi',
    country: 'Finland',
    region: 'Lapland, northern Finland',
    lat: 68.9,
    lng: 27.0,
    blurb: 'A drinking cup carved from a single birch burl, a classic of Sámi duodji handicraft. A good kuksa lasts a lifetime of campfire coffee.',
    robotSkills: ['tool use', 'force control'],
    status: 'playable',
    route: '/kuksa',
    image: { src: '/crafts/kuksa.jpg', alt: 'A carved wooden guksi cup', author: 'Duodjiinfo', license: 'CC BY-SA 3.0', source: commons('Guksi.jpg') },
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
    status: 'soon',
    image: { src: '/crafts/puukko.jpg', alt: 'A puukko knife and a filleting knife with a leather sheath', author: 'Kuroczynski', license: 'CC BY-SA 4.0', source: commons('%E2%80%9EIMG_5221_Puukko_and_fish_filleting_knife_with_sheath_by_J._Marttiini_(cropped).jpg') },
  },
  {
    id: 'lace',
    name: 'Rauma bobbin lace',
    localName: 'Rauman pitsi',
    country: 'Finland',
    region: 'Rauma, western Finland',
    lat: 61.13,
    lng: 21.51,
    blurb: 'Lace made by crossing and twisting dozens of threads wound on wooden bobbins. Rauma has made lace since the 1700s and still celebrates it every summer during Lace Week.',
    robotSkills: ['bimanual dexterity', 'thread handling'],
    status: 'soon',
    image: { src: '/crafts/lace.jpg', alt: 'Hands working bobbins on a lace pillow (photographed in Myjava, Slovakia)', author: 'Krzysiu', license: 'CC BY 4.0', source: commons('Bobbin_lace_making_Myjava-Festival.jpg') },
  },
  {
    id: 'himmeli',
    name: 'Himmeli',
    localName: 'himmeli',
    country: 'Finland',
    region: 'Southern Finland',
    lat: 61.0,
    lng: 24.46,
    blurb: 'Geometric mobiles of rye straw, traditionally hung above the table at Christmas to bring a good harvest.',
    robotSkills: ['fragile materials', 'precise assembly'],
    status: 'soon',
    image: { src: '/crafts/himmeli.jpg', alt: 'Straw himmeli mobiles glowing in warm light', author: 'Tomi Knuutila', license: 'CC BY 2.0', source: commons('Himmeli_(1433508300).jpg') },
  },
  {
    id: 'kannel',
    name: 'Kannel',
    localName: 'kannel',
    country: 'Estonia',
    region: 'Viljandi, Estonia',
    lat: 58.36,
    lng: 25.59,
    blurb: "Estonia's kannel is the kantele's close cousin, one of the Baltic family of box zithers. Viljandi is home to the Estonian Traditional Music Centre.",
    robotSkills: ['fine finger control', 'timing'],
    status: 'soon',
    image: { src: '/crafts/kannel.jpg', alt: 'A small Estonian kannel', author: 'Adeliine', license: 'CC BY-SA 3.0', source: commons('V%C3%A4ikekannel.jpg') },
  },
  {
    id: 'dala',
    name: 'Dala horse',
    localName: 'dalahäst',
    country: 'Sweden',
    region: 'Nusnäs, Dalarna, Sweden',
    lat: 60.96,
    lng: 14.65,
    blurb: "Carved and painted wooden horses that grew out of woodcutters' winter evenings in Dalarna. In Nusnäs they are still carved and painted by hand.",
    robotSkills: ['tool use', 'brushwork'],
    status: 'soon',
    image: { src: '/crafts/dala.jpg', alt: 'A red painted Dala horse', author: 'Mysid', license: 'Public domain', source: commons('Dalecarlian_horse.jpg') },
  },
  {
    id: 'hardanger',
    name: 'Hardanger fiddle',
    localName: 'hardingfele',
    country: 'Norway',
    region: 'Hardanger, western Norway',
    lat: 60.33,
    lng: 6.45,
    blurb: "Norway's national instrument: a richly decorated fiddle with extra sympathetic strings that ring beneath the bowed ones.",
    robotSkills: ['bimanual coordination', 'bowing pressure'],
    status: 'soon',
    image: { src: '/crafts/hardanger.jpg', alt: 'The inlaid body of a Hardanger fiddle', author: 'Frode Inge Helland', license: 'CC BY-SA 3.0', source: commons('Midt.jpg') },
  },
  {
    id: 'tweed',
    name: 'Harris Tweed',
    localName: 'clò mòr',
    country: 'United Kingdom',
    region: 'Outer Hebrides, Scotland',
    lat: 57.85,
    lng: -6.85,
    blurb: 'Cloth handwoven by islanders at home in the Outer Hebrides. Its name and methods are protected by an Act of Parliament.',
    robotSkills: ['rhythmic coordination', 'thread handling'],
    status: 'soon',
    image: { src: '/crafts/tweed.jpg', alt: 'Hands tying warp threads on a Harris Tweed loom', author: 'Callicvol', license: 'CC BY-SA 2.0', source: commons('Tying_Harris_Tweed.jpg') },
  },
  {
    id: 'delft',
    name: 'Delftware',
    localName: 'Delfts blauw',
    country: 'Netherlands',
    region: 'Delft, Netherlands',
    lat: 52.01,
    lng: 4.36,
    blurb: 'Tin-glazed blue-and-white pottery and tiles, made in Delft since the 1600s and painted by hand with fine brushes.',
    robotSkills: ['brushwork', 'fragile objects'],
    status: 'soon',
    image: { src: '/crafts/delft.jpg', alt: 'A blue Delft tile showing a milkmaid, around 1700', author: 'Unknown author', license: 'Public domain', source: commons('Delft-tile-milkmaid-c1700.JPG') },
  },
  {
    id: 'wycinanki',
    name: 'Wycinanki',
    localName: 'wycinanki łowickie',
    country: 'Poland',
    region: 'Łowicz, Poland',
    lat: 52.11,
    lng: 19.94,
    blurb: 'Polish folk paper-cutting: intricate, symmetrical designs traditionally cut with sheep shears. The colourful layered style of Łowicz is the best known.',
    robotSkills: ['precision cutting', 'tool use'],
    status: 'soon',
    image: { src: '/crafts/wycinanki.jpg', alt: 'A colourful Łowicz paper cutting with birds, 1909', author: 'Unknown author', license: 'Public domain', source: commons('Wycinanka_lowicka._1909_(106673350).jpg') },
  },
  {
    id: 'pysanka',
    name: 'Pysanka',
    localName: 'писанка',
    country: 'Ukraine',
    region: 'Kolomyia, western Ukraine',
    lat: 48.53,
    lng: 25.04,
    blurb: 'Easter eggs decorated layer by layer with beeswax and dyes. Kolomyia has a museum built in the shape of a giant pysanka.',
    robotSkills: ['fragile objects', 'liquids'],
    status: 'soon',
    image: { src: '/crafts/pysanka.jpg', alt: 'A pysanka egg with a meander motif', author: 'Lubap', license: 'CC BY-SA 4.0', source: commons('Meander_Motif_on_a_Ukrainian_Pysanka.JPG') },
  },
  {
    id: 'murano',
    name: 'Murano glass',
    localName: 'vetro di Murano',
    country: 'Italy',
    region: 'Murano, Venice, Italy',
    lat: 45.46,
    lng: 12.35,
    blurb: "Venice moved its glassmakers to the island of Murano in 1291, and they've blown glass there ever since, gathering molten glass from the furnace and shaping it in minutes.",
    robotSkills: ['fragile objects', 'heat', 'timing'],
    status: 'soon',
    image: { src: '/crafts/murano.jpg', alt: 'A gather of molten glass glowing at a Murano furnace', author: 'Dennis G. Jarvis', license: 'CC BY-SA 2.0', source: commons('Italy-1453_-_Murano_Glass_(5228946002).jpg') },
  },
  {
    id: 'azulejo',
    name: 'Azulejo',
    localName: 'azulejo',
    country: 'Portugal',
    region: 'Lisbon, Portugal',
    lat: 38.72,
    lng: -9.14,
    blurb: 'Painted, tin-glazed tiles covering churches, stations and whole house fronts across Portugal.',
    robotSkills: ['brushwork', 'repetition'],
    status: 'soon',
    image: { src: '/crafts/azulejo.jpg', alt: 'A Lisbon house front covered in azulejo tiles', author: 'NorbertNagel', license: 'CC BY-SA 4.0', source: commons('Azulejo_facade_in_Rua_de_S%C3%A3o_Bento_-_Lisbon_-_Portugal.jpg') },
  },
];

export const craftById = (id: string) => CRAFTS.find((c) => c.id === id);
