// Fake local market backend: seeded songs (generated on demand, never stored)
// plus this browser's uploads in a SongStorage.

import type { Take } from '../types';
import { noteRangeOf, seedMeta, songToTake } from './generate';
import { SEED_SONGS, type SeedSong } from './seeds';
import {
  ARTIST_MAX,
  TITLE_MAX,
  type MarketSong,
  type MarketSongMeta,
  type PublishInput,
  type SongMarketApi,
  type SongStorage,
} from './types';

const toMeta = ({ take: _take, ...meta }: MarketSong): MarketSongMeta => meta;

let idSeq = 0;

export class LocalMarket implements SongMarketApi {
  private readonly storage: SongStorage;
  private readonly seeds = new Map<string, SeedSong>();
  private seedMetas: MarketSongMeta[] | null = null;
  private readonly seedTakes = new Map<string, Take>();
  private readonly listeners = new Set<() => void>();
  private warned = false;

  constructor(storage: SongStorage, seeds: SeedSong[] = SEED_SONGS) {
    this.storage = storage;
    for (const s of seeds) this.seeds.set(s.id, s);
  }

  async list(): Promise<MarketSongMeta[]> {
    this.seedMetas ??= [...this.seeds.values()].map(seedMeta);
    const seeds = this.seedMetas.map((m) => ({ ...m }));
    try {
      const mine = await this.storage.getAll();
      return [...seeds, ...mine.map(toMeta)];
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        console.warn('Song market: saved songs unavailable, listing seeds only.', err);
      }
      return seeds;
    }
  }

  async get(id: string): Promise<MarketSong | undefined> {
    const seed = this.seeds.get(id);
    if (seed) {
      let take = this.seedTakes.get(id);
      if (!take) {
        take = songToTake(seed);
        this.seedTakes.set(id, take);
      }
      const meta = seedMeta(seed);
      return { ...meta, durationMs: take.durationMs, noteRange: noteRangeOf(take), take: structuredClone(take) };
    }
    const mine = await this.storage.getAll();
    return mine.find((s) => s.id === id);
  }

  async publish(take: Take, input: PublishInput): Promise<MarketSongMeta> {
    const title = input.title.trim();
    const artist = input.artist.trim();
    if (!title) throw new Error('Give the song a title.');
    if (title.length > TITLE_MAX) throw new Error(`Keep the title to ${TITLE_MAX} characters or fewer.`);
    if (!artist) throw new Error('Add your name.');
    if (artist.length > ARTIST_MAX) throw new Error(`Keep your name to ${ARTIST_MAX} characters or fewer.`);
    if (!take.frames.length) throw new Error('This take is empty.');

    const id = `song-${Date.now().toString(36)}-${(++idSeq).toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const copy: Take = { ...structuredClone(take), id, name: title };
    const song: MarketSong = {
      id,
      title,
      artist,
      createdAt: Date.now(),
      durationMs: copy.durationMs,
      noteRange: noteRangeOf(copy),
      mine: true,
      take: copy,
    };
    await this.storage.put(song);
    this.notify();
    return toMeta(song);
  }

  async remove(id: string): Promise<void> {
    const notMine = new Error('You can only delete your own songs.');
    if (this.seeds.has(id)) throw notMine;
    const mine = await this.storage.getAll();
    if (!mine.some((s) => s.id === id)) throw notMine;
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
