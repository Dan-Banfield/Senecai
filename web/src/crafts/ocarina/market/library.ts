// The lesson library: market songs downloaded to this browser (full take,
// frames included) so they can be practised in Lesson mode and watched as a
// demo. Persisted in IndexedDB next to the market uploads.

import { useEffect, useState } from 'react';
import { IdbStorage } from './idbStorage';
import type { MarketSong, MarketSongMeta, SongStorage } from './types';

const toMeta = ({ take: _take, ...meta }: MarketSong): MarketSongMeta => meta;

export class SongLibrary {
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: SongStorage) {}

  /** Downloaded songs (no frames), title order. Rejects with a readable message if storage is unavailable. */
  async list(): Promise<MarketSongMeta[]> {
    const all = await this.storage.getAll();
    return all.map(toMeta).sort((a, b) => a.title.localeCompare(b.title));
  }

  async get(id: string): Promise<MarketSong | undefined> {
    return (await this.storage.getAll()).find((s) => s.id === id);
  }

  /** Saves a deep copy (re-downloading replaces it). `mine` is kept so your own songs stay labelled. */
  async save(song: MarketSong): Promise<void> {
    await this.storage.put(structuredClone(song));
    this.notify();
  }

  async remove(id: string): Promise<void> {
    await this.storage.delete(id);
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }
}

export const library = new SongLibrary(new IdbStorage('library'));

/** Live list of downloaded songs; `error` is set when storage is unavailable, `loaded` after the first answer. */
export function useLibrary(lib: SongLibrary = library): { songs: MarketSongMeta[]; error: string | null; loaded: boolean } {
  const [state, setState] = useState<{ songs: MarketSongMeta[]; error: string | null; loaded: boolean }>({ songs: [], error: null, loaded: false });
  useEffect(() => {
    let alive = true;
    let seq = 0;
    const load = () => {
      const mine = ++seq;
      lib.list().then(
        (songs) => alive && mine === seq && setState({ songs, error: null, loaded: true }),
        (e: unknown) => alive && mine === seq && setState({ songs: [], error: e instanceof Error ? e.message : 'Library unavailable.', loaded: true }),
      );
    };
    load();
    const unsubscribe = lib.subscribe(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [lib]);
  return state;
}
