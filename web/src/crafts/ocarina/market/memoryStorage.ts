// In-memory SongStorage for tests, and the fallback when IndexedDB is missing.

import type { MarketSong, SongStorage } from './types';

export class MemoryStorage implements SongStorage {
  private songs = new Map<string, MarketSong>();

  async getAll(): Promise<MarketSong[]> {
    return [...this.songs.values()].map((s) => structuredClone(s));
  }

  async put(song: MarketSong): Promise<void> {
    this.songs.set(song.id, structuredClone(song));
  }

  async delete(id: string): Promise<void> {
    this.songs.delete(id);
  }
}
