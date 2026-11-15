// The app's song market. With VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set
// (the hosted app), uploads are shared through Supabase; without them (local
// dev, offline demos), they stay in this browser's IndexedDB. Constructing it
// is cheap; nothing opens, connects or generates until the first call.

import { IdbStorage } from './idbStorage';
import { LocalMarket } from './localMarket';
import { SupabaseStorage } from './supabaseStorage';
import type { SongMarketApi, SongStorage } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const storage: SongStorage =
  url && anonKey
    ? new SupabaseStorage(() => import('@supabase/supabase-js').then(({ createClient }) => createClient(url, anonKey)))
    : new IdbStorage();

export const market: SongMarketApi = new LocalMarket(storage);

export { ARTIST_MAX, PREVIEW_MS, TITLE_MAX } from './types';
export type { MarketSong, MarketSongMeta, NoteRange, PreviewPlayer, PublishInput, SongMarketApi, SongStorage } from './types';
