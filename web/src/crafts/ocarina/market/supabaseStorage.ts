// SongStorage on Supabase: the shared song market used by the hosted app. Every
// visitor sees every upload; a visitor's own uploads are `mine` (deletable).
// Visitors get a Supabase anonymous identity on their first publish, kept in
// localStorage by supabase-js, so `mine` survives reloads in the same browser.
// Row-level security (supabase/migrations) makes the database enforce that
// only the owner can delete. Every failure rejects with a user-readable Error.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Take } from '../types';
import type { MarketSong, MarketSongMeta, NoteRange, SongStorage } from './types';

export const TABLE = 'ocarina_songs';
const META_COLUMNS = 'id,title,artist,created_at,duration_ms,note_range,owner';
const ALL_COLUMNS = `${META_COLUMNS},take`;
/** Newest first; the market lists at most this many uploads. */
export const LIST_LIMIT = 500;

export const NETWORK_MESSAGE = "Couldn't reach the song market. Check your connection and try again.";
export const SIGN_IN_MESSAGE = "Publishing isn't available right now. Please try again later.";
export const TOO_LONG_MESSAGE = 'This take is too long to publish.';
export const NOT_MINE_MESSAGE = 'You can only delete your own songs.';

interface Row {
  id: string;
  title: string;
  artist: string;
  created_at: string;
  duration_ms: number;
  note_range: NoteRange | null;
  owner: string;
  take?: Take;
}

function toMeta(row: Row, uid: string | null): MarketSongMeta {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    createdAt: Date.parse(row.created_at),
    durationMs: row.duration_ms,
    noteRange: row.note_range,
    mine: uid !== null && row.owner === uid,
  };
}

function toSong(row: Row, uid: string | null): MarketSong {
  if (!row.take) throw new Error(NETWORK_MESSAGE);
  return { ...toMeta(row, uid), take: row.take };
}

export class SupabaseStorage implements SongStorage {
  private client: Promise<SupabaseClient> | null = null;

  /** `connect` creates the client; called once, on first use (so the library loads only when the market opens). */
  constructor(private readonly connect: () => Promise<SupabaseClient>) {}

  async listMeta(): Promise<MarketSongMeta[]> {
    const db = await this.db();
    const { data, error } = await db.from(TABLE).select(META_COLUMNS).order('created_at', { ascending: false }).limit(LIST_LIMIT);
    if (error || !data) throw new Error(NETWORK_MESSAGE);
    const uid = await this.uid();
    return (data as Row[]).map((r) => toMeta(r, uid));
  }

  async getAll(): Promise<MarketSong[]> {
    const db = await this.db();
    const { data, error } = await db.from(TABLE).select(ALL_COLUMNS).order('created_at', { ascending: false }).limit(LIST_LIMIT);
    if (error || !data) throw new Error(NETWORK_MESSAGE);
    const uid = await this.uid();
    return (data as Row[]).map((r) => toSong(r, uid));
  }

  async get(id: string): Promise<MarketSong | undefined> {
    const db = await this.db();
    const { data, error } = await db.from(TABLE).select(ALL_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw new Error(NETWORK_MESSAGE);
    if (!data) return undefined;
    return toSong(data as Row, await this.uid());
  }

  /** Owner and creation time are set by the database (auth.uid(), now()). */
  async put(song: MarketSong): Promise<void> {
    const db = await this.db();
    await this.signIn(db);
    const { error } = await db.from(TABLE).insert({
      id: song.id,
      title: song.title,
      artist: song.artist,
      duration_ms: Math.round(song.durationMs),
      note_range: song.noteRange,
      take: song.take,
    });
    if (error) throw new Error(error.code === '23514' || error.code === '54000' ? TOO_LONG_MESSAGE : NETWORK_MESSAGE);
  }

  async delete(id: string): Promise<void> {
    const db = await this.db();
    if (!(await this.uid())) throw new Error(NOT_MINE_MESSAGE);
    // RLS silently filters rows you don't own, so check that one was deleted.
    const { data, error } = await db.from(TABLE).delete().eq('id', id).select('id');
    if (error) throw new Error(NETWORK_MESSAGE);
    if (!data?.length) throw new Error(NOT_MINE_MESSAGE);
  }

  private db(): Promise<SupabaseClient> {
    this.client ??= this.connect().catch(() => {
      this.client = null;
      throw new Error(NETWORK_MESSAGE);
    });
    return this.client;
  }

  /** The visitor's id, or null before their first publish. Reads the stored session; no network. */
  private async uid(): Promise<string | null> {
    const db = await this.db();
    const { data } = await db.auth.getSession();
    return data.session?.user.id ?? null;
  }

  private async signIn(db: SupabaseClient): Promise<void> {
    if (await this.uid()) return;
    const { data, error } = await db.auth.signInAnonymously();
    if (error || !data.user) throw new Error(SIGN_IN_MESSAGE);
  }
}
