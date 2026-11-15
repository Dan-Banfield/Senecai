// Shared contract for the ocarina Song Market (see SPEC.md). The data layer
// (localMarket, idbStorage, seeds), the preview player and the drawer UI all
// agree on these types.

import type { Take } from '../types';

export const TITLE_MAX = 60;
export const ARTIST_MAX = 40;
/** Audio previews play this many ms from the start of a song. */
export const PREVIEW_MS = 8000;

export interface NoteRange {
  /** MIDI */
  low: number;
  high: number;
}

/** Everything about a song except its frames: cheap to list and render. */
export interface MarketSongMeta {
  id: string;
  title: string;
  artist: string;
  /** ms epoch */
  createdAt: number;
  durationMs: number;
  /** null when the take never sounds a note. */
  noteRange: NoteRange | null;
  /** Published from this browser (deletable). */
  mine: boolean;
}

export interface MarketSong extends MarketSongMeta {
  take: Take;
}

export interface PublishInput {
  title: string;
  artist: string;
}

/** Async so a network backend can replace the fake local one. Errors reject with an Error whose message is user-readable. */
export interface SongMarketApi {
  list(): Promise<MarketSongMeta[]>;
  get(id: string): Promise<MarketSong | undefined>;
  /** Validates (trimmed, 1..TITLE_MAX / 1..ARTIST_MAX chars) and stores a deep copy of the take. */
  publish(take: Take, input: PublishInput): Promise<MarketSongMeta>;
  /** Only `mine` songs; rejects for seeds or unknown ids. */
  remove(id: string): Promise<void>;
  /** Called after every successful publish/remove. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** Persistence for uploaded (mine) songs. IndexedDB in the browser, in-memory in tests. */
export interface SongStorage {
  getAll(): Promise<MarketSong[]>;
  put(song: MarketSong): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Sound-only preview of a song's first PREVIEW_MS. Never touches the stage or the robot. */
export interface PreviewPlayer {
  /** Stops any current preview, then plays this one. Call from a user gesture (unlocks audio). */
  play(id: string, take: Take): void;
  stop(): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}
