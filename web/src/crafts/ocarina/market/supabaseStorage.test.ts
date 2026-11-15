import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Take } from '../types';
import { LocalMarket } from './localMarket';
import { SEED_SONGS } from './seeds';
import { NETWORK_MESSAGE, NOT_MINE_MESSAGE, SIGN_IN_MESSAGE, SupabaseStorage, TABLE, TOO_LONG_MESSAGE } from './supabaseStorage';

const take = (): Take => ({
  id: 'take-1',
  name: 'Take 1',
  createdAt: 1,
  durationMs: 24,
  frames: [0, 12, 24].map((t, i) => ({
    t,
    dof: { right: [0.3, 1, 1, 1, 1, i * 0.4] },
    holes: Array.from({ length: 10 }, () => true),
    midi: 72,
    inspire: { right: [1000, 0, 0, 0, 0, 700] },
  })),
});

interface Row {
  id: string;
  title: string;
  artist: string;
  created_at: string;
  duration_ms: number;
  note_range: { low: number; high: number } | null;
  owner: string;
  take: Take;
}

type Err = { code?: string; message: string } | null;

/** Just enough of SupabaseClient for SupabaseStorage, backed by an array with RLS-like owner checks. */
class FakeSupabase {
  rows: Row[] = [];
  uid: string | null = null;
  failNext: Err = null;
  signInFails = false;
  signIns = 0;
  private clock = 0;

  client(): SupabaseClient {
    const auth = {
      getSession: async () => ({ data: { session: this.uid ? { user: { id: this.uid } } : null } }),
      signInAnonymously: async () => {
        this.signIns++;
        if (this.signInFails) return { data: { user: null }, error: { message: 'disabled' } };
        this.uid = `anon-${this.signIns}`;
        return { data: { user: { id: this.uid } }, error: null };
      },
    };
    return { auth, from: (table: string) => this.query(table) } as unknown as SupabaseClient;
  }

  private takeError(): Err {
    const e = this.failNext;
    this.failNext = null;
    return e;
  }

  private query(table: string) {
    expect(table).toBe(TABLE);
    let rows = [...this.rows];
    let op: 'select' | 'delete' = 'select';
    let columns = '*';
    const project = (r: Row) =>
      columns === '*' ? { ...r } : Object.fromEntries(columns.split(',').map((c) => [c, r[c as keyof Row]]));
    const run = () => {
      const error = this.takeError();
      if (error) return { data: null, error };
      if (op === 'delete') {
        const mine = rows.filter((r) => r.owner === this.uid);
        this.rows = this.rows.filter((r) => !mine.includes(r));
        return { data: mine.map((r) => ({ id: r.id })), error: null };
      }
      return { data: rows.map(project), error: null };
    };
    const builder = {
      select(cols = '*') {
        columns = cols;
        return builder;
      },
      order(col: keyof Row, { ascending }: { ascending: boolean }) {
        rows.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (ascending ? 1 : -1));
        return builder;
      },
      limit(n: number) {
        rows = rows.slice(0, n);
        return builder;
      },
      eq(col: keyof Row, v: unknown) {
        rows = rows.filter((r) => r[col] === v);
        return builder;
      },
      delete() {
        op = 'delete';
        return builder;
      },
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error };
      },
      insert: async (row: Omit<Row, 'owner' | 'created_at'>) => {
        const error = this.takeError();
        if (error) return { error };
        if (!this.uid) return { error: { code: '42501', message: 'rls' } };
        this.rows.push({ ...row, owner: this.uid, created_at: new Date(Date.UTC(2026, 10, 15, 0, 0, ++this.clock)).toISOString() });
        return { error: null };
      },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return builder;
  }
}

const setup = () => {
  const fake = new FakeSupabase();
  let connects = 0;
  const storage = new SupabaseStorage(async () => {
    connects++;
    return fake.client();
  });
  return { fake, storage, market: new LocalMarket(storage), connects: () => connects };
};

describe('SupabaseStorage', () => {
  it('connects lazily, once', async () => {
    const { market, connects } = setup();
    expect(connects()).toBe(0);
    await market.list();
    await market.list();
    expect(connects()).toBe(1);
  });

  it('publishes with an anonymous sign-in, then lists the upload as mine without its take', async () => {
    const { fake, market } = setup();
    const meta = await market.publish(take(), { title: ' Joiku ', artist: 'Aino' });
    expect(fake.signIns).toBe(1);
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0]).toMatchObject({ id: meta.id, title: 'Joiku', artist: 'Aino', duration_ms: 24, owner: 'anon-1' });

    const list = await market.list();
    expect(list).toHaveLength(SEED_SONGS.length + 1);
    const mine = list.find((s) => s.id === meta.id)!;
    expect(mine).toMatchObject({ title: 'Joiku', artist: 'Aino', mine: true, durationMs: 24, noteRange: { low: 72, high: 72 } });
    expect('take' in mine).toBe(false);
    expect(mine.createdAt).toBe(Date.UTC(2026, 10, 15, 0, 0, 1));

    // A second publish reuses the identity.
    await market.publish(take(), { title: 'Two', artist: 'Aino' });
    expect(fake.signIns).toBe(1);
  });

  it("marks other visitors' songs as not mine, and lists newest first", async () => {
    const { fake, market } = setup();
    await market.publish(take(), { title: 'Old', artist: 'A' });
    fake.uid = 'someone-else';
    await market.publish(take(), { title: 'New', artist: 'B' });
    const uploads = (await market.list()).slice(SEED_SONGS.length);
    expect(uploads.map((s) => [s.title, s.mine])).toEqual([
      ['New', true],
      ['Old', false],
    ]);
  });

  it('gets a full song by id', async () => {
    const { market } = setup();
    const meta = await market.publish(take(), { title: 'Joiku', artist: 'Aino' });
    const song = await market.get(meta.id);
    expect(song?.take.frames).toHaveLength(3);
    expect(song?.take.name).toBe('Joiku');
    expect(await market.get('missing')).toBeUndefined();
  });

  it('deletes only your own songs', async () => {
    const { fake, market } = setup();
    const meta = await market.publish(take(), { title: 'Joiku', artist: 'Aino' });
    fake.uid = 'someone-else';
    await expect(market.remove(meta.id)).rejects.toThrow(NOT_MINE_MESSAGE);
    fake.uid = null;
    await expect(market.remove(meta.id)).rejects.toThrow(NOT_MINE_MESSAGE);
    fake.uid = 'anon-1';
    await market.remove(meta.id);
    expect(fake.rows).toHaveLength(0);
  });

  it('falls back to the seeds when the market is unreachable', async () => {
    const { fake, market } = setup();
    fake.failNext = { message: 'fetch failed' };
    const list = await market.list();
    expect(list).toHaveLength(SEED_SONGS.length);
  });

  it('rejects with readable messages', async () => {
    const { fake, market, storage } = setup();
    fake.failNext = { message: 'fetch failed' };
    await expect(market.publish(take(), { title: 'A', artist: 'B' })).rejects.toThrow(NETWORK_MESSAGE);
    fake.failNext = { code: '23514', message: 'check violation' };
    await expect(market.publish(take(), { title: 'A', artist: 'B' })).rejects.toThrow(TOO_LONG_MESSAGE);
    fake.failNext = { message: 'fetch failed' };
    await expect(storage.get('x')).rejects.toThrow(NETWORK_MESSAGE);

    const signedOut = setup();
    signedOut.fake.signInFails = true;
    await expect(signedOut.market.publish(take(), { title: 'A', artist: 'B' })).rejects.toThrow(SIGN_IN_MESSAGE);
  });

  it('retries the connection after a failed connect', async () => {
    const fake = new FakeSupabase();
    let attempts = 0;
    const storage = new SupabaseStorage(async () => {
      if (++attempts === 1) throw new Error('chunk load failed');
      return fake.client();
    });
    await expect(storage.listMeta()).rejects.toThrow(NETWORK_MESSAGE);
    await expect(storage.listMeta()).resolves.toEqual([]);
  });
});
