// Community backend. For the hackathon this is a fake: seeded creations are
// generated in memory, user creations persist in localStorage, and calls get
// artificial latency so the UI behaves as it would against a real API. Swap
// MockCommunityApi for an HTTP implementation of CommunityApi later.

import { isBenchCraft } from '../bench/crafts';
import type { BenchRecording } from '../bench/recording';
import type { CraftId, Recording } from '../recording/recording';
import type { GeoPoint } from './places';
import { generateSeeds } from './seed';

export interface Creation {
  id: string;
  craft: CraftId;
  title: string;
  author: string;
  description: string;
  createdAt: string;
  likes: number;
  liked?: boolean;
  /** Kantele: v1 recording. Workbench crafts: v2 bench recording (robot frames plus workpiece ops). */
  recording: Recording | BenchRecording;
  /** Snapshot of the finished piece (JPEG data URL), for workbench crafts. */
  thumb?: string;
  score?: number;
  seeded?: boolean;
  /** Set when this creation was made by following another one's tutorial. */
  learnedFrom?: { id: string; title: string; author: string };
  /** Where it was made, for the globe. */
  location?: GeoPoint;
}

export type NewCreation = Pick<Creation, 'craft' | 'title' | 'author' | 'description' | 'recording' | 'thumb' | 'score' | 'learnedFrom' | 'location'>;

export interface CommunityApi {
  list(filter?: { craft?: CraftId }): Promise<Creation[]>;
  get(id: string): Promise<Creation | undefined>;
  create(c: NewCreation): Promise<Creation>;
  like(id: string): Promise<Creation | undefined>;
}

const STORE_KEY = 'senecai.community.v1';
const LIKES_KEY = 'senecai.community.likes.v1';
const delay = (ms = 120 + Math.random() * 180) => new Promise((r) => setTimeout(r, ms));

/** Thrown when a creation or like can't be saved to local storage (quota exceeded or storage unavailable). */
export class CommunityStorageError extends Error {
  override readonly name = 'CommunityStorageError';
  constructor(
    message: string,
    readonly reason: 'quota' | 'unavailable',
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function isQuotaError(e: unknown) {
  if (typeof e !== 'object' || e === null) return false;
  const { name, code } = e as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

/** Minimal structural check: enough for the list, detail and replay pages not to throw. */
function isCreation(v: unknown): v is Creation {
  if (!isPlainObject(v)) return false;
  const { id, craft, title, author, createdAt, likes, recording } = v;
  return (
    typeof id === 'string' &&
    typeof craft === 'string' &&
    typeof title === 'string' &&
    typeof author === 'string' &&
    typeof createdAt === 'string' &&
    typeof likes === 'number' &&
    Number.isFinite(likes) &&
    isPlainObject(recording) &&
    Array.isArray(recording.frames)
  );
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Parses the stored user creations, dropping anything that isn't a well-formed creation. */
export function parseUserCreations(raw: string | null): Creation[] {
  const data = parseJson(raw);
  return Array.isArray(data) ? data.filter(isCreation) : [];
}

/** Parses the stored likes map, keeping only `id: true` entries. */
export function parseLikes(raw: string | null): Record<string, boolean> {
  const data = parseJson(raw);
  if (!isPlainObject(data)) return {};
  const out: Record<string, boolean> = {};
  for (const [id, on] of Object.entries(data)) if (on === true) out[id] = true;
  return out;
}

function setItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (isQuotaError(e)) throw new CommunityStorageError('Local storage is full.', 'quota', { cause: e });
    throw new CommunityStorageError('Local storage is unavailable.', 'unavailable', { cause: e });
  }
}

/**
 * Saves the user's creations (newest first). When storage is full, drops the oldest creations one
 * at a time until the list fits. The newest creation is never dropped: if even it alone doesn't
 * fit, throws a CommunityStorageError and leaves the stored list untouched.
 */
export function writeUserCreations(list: Creation[]) {
  for (let keep = list.length; ; keep--) {
    try {
      setItem(STORE_KEY, JSON.stringify(list.slice(0, keep)));
      if (keep < list.length) console.warn(`community storage full: dropped ${list.length - keep} oldest creation(s)`);
      return;
    } catch (e) {
      const full = e instanceof CommunityStorageError && e.reason === 'quota';
      if (!full) throw e;
      if (keep <= 1) throw new CommunityStorageError('Not enough local storage to save this creation. Try a shorter recording.', 'quota', { cause: e.cause });
    }
  }
}

export class MockCommunityApi implements CommunityApi {
  private seeds: Creation[] | null = null;

  private getSeeds() {
    this.seeds ??= generateSeeds();
    return this.seeds;
  }
  private readUser(): Creation[] {
    return parseUserCreations(localStorage.getItem(STORE_KEY));
  }
  private likes(): Record<string, boolean> {
    return parseLikes(localStorage.getItem(LIKES_KEY));
  }
  private all(): Creation[] {
    const liked = this.likes();
    return [...this.readUser(), ...this.getSeeds()]
      // Creations saved for crafts that have since been removed can't be replayed; skip them.
      .filter((c) => c.craft === 'kantele' || isBenchCraft(c.craft))
      .map((c) => ({
        ...c,
        liked: !!liked[c.id],
        likes: c.likes + (liked[c.id] ? 1 : 0),
      }));
  }

  async list(filter?: { craft?: CraftId }) {
    await delay();
    return this.all()
      .filter((c) => !filter?.craft || c.craft === filter.craft)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string) {
    await delay(80);
    return this.all().find((c) => c.id === id);
  }

  async create(c: NewCreation) {
    await delay(300);
    const creation: Creation = { ...c, id: `u-${Date.now().toString(36)}`, createdAt: new Date().toISOString(), likes: 0 };
    writeUserCreations([creation, ...this.readUser()]);
    return creation;
  }

  async like(id: string) {
    await delay(60);
    const l = this.likes();
    if (l[id]) delete l[id];
    else l[id] = true;
    setItem(LIKES_KEY, JSON.stringify(l));
    return this.all().find((c) => c.id === id);
  }
}

export const community: CommunityApi = new MockCommunityApi();
