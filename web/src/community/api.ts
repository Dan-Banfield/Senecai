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

class MockCommunityApi implements CommunityApi {
  private seeds: Creation[] | null = null;

  private getSeeds() {
    this.seeds ??= generateSeeds();
    return this.seeds;
  }
  private readUser(): Creation[] {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    } catch {
      return [];
    }
  }
  private writeUser(list: Creation[]) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
    } catch (e) {
      // Quota exceeded: drop the oldest user creations and retry once.
      console.warn('community storage full, trimming', e);
      localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, Math.max(1, Math.floor(list.length / 2)))));
    }
  }
  private likes(): Record<string, boolean> {
    try {
      return JSON.parse(localStorage.getItem(LIKES_KEY) ?? '{}');
    } catch {
      return {};
    }
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
    this.writeUser([creation, ...this.readUser()]);
    return creation;
  }

  async like(id: string) {
    await delay(60);
    const l = this.likes();
    l[id] = !l[id];
    localStorage.setItem(LIKES_KEY, JSON.stringify(l));
    return this.all().find((c) => c.id === id);
  }
}

export const community: CommunityApi = new MockCommunityApi();
