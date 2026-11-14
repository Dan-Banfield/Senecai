import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityStorageError, MockCommunityApi, parseLikes, parseUserCreations, writeUserCreations, type Creation } from './api';

const STORE_KEY = 'senecai.community.v1';
const LIKES_KEY = 'senecai.community.likes.v1';

/** In-memory localStorage with an optional size limit (total characters across values). */
class FakeStorage {
  data = new Map<string, string>();
  constructor(public quota = Infinity) {}
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    let used = v.length;
    for (const [key, val] of this.data) if (key !== k) used += val.length;
    if (used > this.quota) throw new DOMException('quota', 'QuotaExceededError');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

function creation(id: string, extra: Partial<Creation> = {}): Creation {
  return {
    id,
    craft: 'kantele',
    title: `t-${id}`,
    author: 'a',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    likes: 0,
    recording: { version: 1, craft: 'kantele', source: 'keyboard', durationMs: 0, frames: [], events: [] } as unknown as Creation['recording'],
    ...extra,
  };
}

let storage: FakeStorage;
beforeEach(() => {
  storage = new FakeStorage();
  vi.stubGlobal('localStorage', storage);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseUserCreations', () => {
  it.each(['null', '{}', '[1,2]', '"x"', '42', 'not json', '{"0":{}}'])('falls back to [] for %s', (raw) => {
    expect(parseUserCreations(raw)).toEqual([]);
  });

  it('returns [] when the key is missing', () => {
    expect(parseUserCreations(null)).toEqual([]);
  });

  it('keeps valid entries and drops malformed ones', () => {
    const good = creation('u-1');
    const raw = JSON.stringify([good, null, 1, [], { id: 'u-2' }, { ...good, id: 'u-3', likes: 'x' }, { ...good, id: 'u-4', recording: null }]);
    expect(parseUserCreations(raw).map((c) => c.id)).toEqual(['u-1']);
  });
});

describe('parseLikes', () => {
  it.each(['null', '[]', '[1,2]', '"x"', 'not json'])('falls back to {} for %s', (raw) => {
    expect(parseLikes(raw)).toEqual({});
  });

  it('keeps only true entries', () => {
    expect(parseLikes(JSON.stringify({ a: true, b: false, c: 'yes', d: 1 }))).toEqual({ a: true });
  });
});

describe('writeUserCreations', () => {
  it('writes the whole list when it fits', () => {
    writeUserCreations([creation('a'), creation('b')]);
    expect(parseUserCreations(storage.getItem(STORE_KEY)).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('drops the oldest entries until the list fits, keeping the newest', () => {
    const list = ['n', 'o1', 'o2', 'o3', 'o4'].map((id) => creation(id));
    storage.quota = JSON.stringify(list.slice(0, 2)).length;
    writeUserCreations(list);
    expect(parseUserCreations(storage.getItem(STORE_KEY)).map((c) => c.id)).toEqual(['n', 'o1']);
  });

  it('throws a quota CommunityStorageError when even the newest does not fit, leaving storage untouched', () => {
    storage.setItem(STORE_KEY, '[]');
    storage.quota = 10;
    let err: unknown;
    try {
      writeUserCreations([creation('n'), creation('o')]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CommunityStorageError);
    expect((err as CommunityStorageError).reason).toBe('quota');
    expect(storage.getItem(STORE_KEY)).toBe('[]');
  });

  it('reports non-quota failures as unavailable without retrying', () => {
    const setItem = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => writeUserCreations([creation('a'), creation('b')])).toThrow(CommunityStorageError);
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});

describe('MockCommunityApi with bad stored data', () => {
  it.each(['null', '{}', '[1,2]'])('list/get/like still work when the stores hold %s', async (raw) => {
    storage.data.set(STORE_KEY, raw);
    storage.data.set(LIKES_KEY, raw);
    const api = new MockCommunityApi();
    const list = await api.list();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    const first = list[0];
    expect((await api.get(first.id))?.id).toBe(first.id);
    const liked = await api.like(first.id);
    expect(liked?.liked).toBe(true);
    expect(liked?.likes).toBe(first.likes + 1);
  });

  it('create rejects with CommunityStorageError when storage is full', async () => {
    storage.quota = 5;
    const api = new MockCommunityApi();
    const c = creation('x');
    await expect(api.create({ craft: c.craft, title: c.title, author: c.author, description: c.description, recording: c.recording })).rejects.toBeInstanceOf(CommunityStorageError);
  });
});
