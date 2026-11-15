import { describe, expect, it, vi } from 'vitest';
import type { Take } from '../types';
import { LocalMarket } from './localMarket';
import { MemoryStorage } from './memoryStorage';
import { SEED_SONGS } from './seeds';
import { ARTIST_MAX, TITLE_MAX, type MarketSong, type SongStorage } from './types';

const sampleTake = (): Take => ({
  id: 'take-1',
  name: 'Take 1',
  createdAt: 1,
  durationMs: 24,
  frames: [0, 12, 24].map((t, i) => ({
    t,
    dof: { left: [0.3, 1, 1, 1, 1, 1], right: [0.3, 1, 1, 1, 1, i * 0.4] },
    holes: Array.from({ length: 10 }, () => true),
    midi: i === 2 ? null : 72 + i * 2,
    inspire: { left: [0, 0, 0, 0, 0, 700], right: [1000 - i * 400, 0, 0, 0, 0, 700] },
  })),
});

class FailingStorage extends MemoryStorage {
  constructor(private readonly fail: Partial<Record<keyof SongStorage, string>>) {
    super();
  }
  async getAll(): Promise<MarketSong[]> {
    if (this.fail.getAll) throw new Error(this.fail.getAll);
    return super.getAll();
  }
  async put(song: MarketSong): Promise<void> {
    if (this.fail.put) throw new Error(this.fail.put);
    return super.put(song);
  }
}

describe('LocalMarket', () => {
  it('lists the seeds as metas', async () => {
    const list = await new LocalMarket(new MemoryStorage()).list();
    expect(list).toHaveLength(SEED_SONGS.length);
    for (const m of list) {
      expect(m.mine).toBe(false);
      expect('take' in m).toBe(false);
      expect(m.durationMs).toBeGreaterThan(0);
    }
  });

  it('gets a seed with generated frames, cached across calls', async () => {
    const market = new LocalMarket(new MemoryStorage());
    const a = await market.get(SEED_SONGS[0].id);
    const b = await market.get(SEED_SONGS[0].id);
    expect(a?.take.frames.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    expect(await market.get('nope')).toBeUndefined();
  });

  it('publishes, gets and removes my song', async () => {
    const market = new LocalMarket(new MemoryStorage());
    const take = sampleTake();
    const meta = await market.publish(take, { title: '  My tune ', artist: ' Aino ' });
    expect(meta).toMatchObject({ title: 'My tune', artist: 'Aino', mine: true, durationMs: 24, noteRange: { low: 72, high: 74 } });
    expect(meta.id).toMatch(/^song-/);
    expect('take' in meta).toBe(false);

    const list = await market.list();
    expect(list).toHaveLength(SEED_SONGS.length + 1);
    expect(list.find((m) => m.id === meta.id)?.mine).toBe(true);

    const song = await market.get(meta.id);
    expect(song?.take.frames).toEqual(take.frames);
    expect(song?.take.id).toBe(meta.id);
    expect(song?.take.name).toBe('My tune');
    expect(take.id).toBe('take-1');

    await market.remove(meta.id);
    expect((await market.list()).some((m) => m.id === meta.id)).toBe(false);
    expect(await market.get(meta.id)).toBeUndefined();
  });

  it('stores a deep copy of the take', async () => {
    const market = new LocalMarket(new MemoryStorage());
    const take = sampleTake();
    const meta = await market.publish(take, { title: 'T', artist: 'A' });
    take.frames[0].holes[0] = false;
    expect((await market.get(meta.id))?.take.frames[0].holes[0]).toBe(true);
  });

  it('publishing twice makes two songs', async () => {
    const market = new LocalMarket(new MemoryStorage());
    const a = await market.publish(sampleTake(), { title: 'T', artist: 'A' });
    const b = await market.publish(sampleTake(), { title: 'T', artist: 'A' });
    expect(a.id).not.toBe(b.id);
    expect((await market.list()).filter((m) => m.mine)).toHaveLength(2);
  });

  it('validates title and artist', async () => {
    const market = new LocalMarket(new MemoryStorage());
    const take = sampleTake();
    await expect(market.publish(take, { title: '   ', artist: 'A' })).rejects.toThrow('Give the song a title.');
    await expect(market.publish(take, { title: 'T', artist: '' })).rejects.toThrow(/name/);
    await expect(market.publish(take, { title: 'x'.repeat(TITLE_MAX + 1), artist: 'A' })).rejects.toThrow(/title/);
    await expect(market.publish(take, { title: 'T', artist: 'x'.repeat(ARTIST_MAX + 1) })).rejects.toThrow(/name/);
    await expect(market.publish(take, { title: 'x'.repeat(TITLE_MAX), artist: 'x'.repeat(ARTIST_MAX) })).resolves.toBeDefined();
  });

  it('refuses to remove seeds or unknown songs', async () => {
    const market = new LocalMarket(new MemoryStorage());
    await expect(market.remove(SEED_SONGS[0].id)).rejects.toThrow('You can only delete your own songs.');
    await expect(market.remove('song-unknown')).rejects.toThrow('You can only delete your own songs.');
  });

  it('notifies subscribers on publish and remove', async () => {
    const market = new LocalMarket(new MemoryStorage());
    const listener = vi.fn();
    const off = market.subscribe(listener);
    const meta = await market.publish(sampleTake(), { title: 'T', artist: 'A' });
    expect(listener).toHaveBeenCalledTimes(1);
    await market.remove(meta.id);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    await market.publish(sampleTake(), { title: 'T', artist: 'A' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('still lists seeds when storage is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const market = new LocalMarket(new FailingStorage({ getAll: 'nope' }));
    expect(await market.list()).toHaveLength(SEED_SONGS.length);
    expect(await market.list()).toHaveLength(SEED_SONGS.length);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((await market.get(SEED_SONGS[1].id))?.take.frames.length).toBeGreaterThan(0);
    warn.mockRestore();
  });

  it('rejects publish with the storage error message', async () => {
    const market = new LocalMarket(new FailingStorage({ put: 'Not enough storage space to save this song.' }));
    const listener = vi.fn();
    market.subscribe(listener);
    await expect(market.publish(sampleTake(), { title: 'T', artist: 'A' })).rejects.toThrow(
      'Not enough storage space to save this song.',
    );
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('IdbStorage without IndexedDB', () => {
  it('rejects with a readable message, and the market still lists seeds', async () => {
    const { IdbStorage, UNAVAILABLE_MESSAGE } = await import('./idbStorage');
    expect(typeof indexedDB).toBe('undefined');
    const storage = new IdbStorage();
    await expect(storage.getAll()).rejects.toThrow(UNAVAILABLE_MESSAGE);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const market = new LocalMarket(storage);
    expect(await market.list()).toHaveLength(SEED_SONGS.length);
    await expect(market.publish(sampleTake(), { title: 'T', artist: 'A' })).rejects.toThrow(UNAVAILABLE_MESSAGE);
    warn.mockRestore();
  });
});
