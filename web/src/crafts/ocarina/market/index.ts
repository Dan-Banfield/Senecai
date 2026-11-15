// The app's song market: the fake local backend over IndexedDB. Constructing it
// is cheap; nothing opens or generates until the first call.

import { IdbStorage } from './idbStorage';
import { LocalMarket } from './localMarket';
import type { SongMarketApi } from './types';

export const market: SongMarketApi = new LocalMarket(new IdbStorage());

export { ARTIST_MAX, PREVIEW_MS, TITLE_MAX } from './types';
export type { MarketSong, MarketSongMeta, NoteRange, PreviewPlayer, PublishInput, SongMarketApi, SongStorage } from './types';
