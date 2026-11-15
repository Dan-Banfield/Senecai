import { AFRICA } from './africa';
import { AMERICAS } from './americas';
import { ASIA } from './asia';
import { EUROPE } from './europe';
import { OCEANIA } from './oceania';

export type { WorldCraft } from './types';

/** Every "coming soon" craft and instrument on the globe, by region. */
export const WORLD_CRAFTS = [...EUROPE, ...ASIA, ...AFRICA, ...AMERICAS, ...OCEANIA];
