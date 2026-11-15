import { describe, expect, it, vi } from 'vitest';
import { LocalMarket } from './localMarket';
import { SongLibrary } from './library';
import { MemoryStorage } from './memoryStorage';
import { SEED_SONGS } from './seeds';

describe('SongLibrary', () => {
  it('saves, lists, gets and removes downloaded songs, notifying subscribers', async () => {
    const market = new LocalMarket(new MemoryStorage());
    const lib = new SongLibrary(new MemoryStorage());
    const listener = vi.fn();
    lib.subscribe(listener);

    const song = (await market.get(SEED_SONGS[0].id))!;
    await lib.save(song);
    expect(listener).toHaveBeenCalledTimes(1);
    const list = await lib.list();
    expect(list.map((s) => s.id)).toEqual([song.id]);
    expect(list[0]).not.toHaveProperty('take');
    expect((await lib.get(song.id))!.take.frames).toEqual(song.take.frames);

    await lib.save(song); // re-download replaces
    expect(await lib.list()).toHaveLength(1);

    await lib.remove(song.id);
    expect(await lib.list()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
