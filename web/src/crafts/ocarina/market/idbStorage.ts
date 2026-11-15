// SongStorage on raw IndexedDB. One database holds the 'songs' store (your
// market uploads) and the 'library' store (songs downloaded for lessons), both
// keyed by id. Opens lazily on first use; every failure rejects with a
// user-readable Error.

import type { MarketSong, SongStorage } from './types';

const DB_NAME = 'senecai-ocarina-market';
const DB_VERSION = 2;
export type StoreName = 'songs' | 'library';
const STORES: readonly StoreName[] = ['songs', 'library'];

export const UNAVAILABLE_MESSAGE = "Saving songs isn't available in this browser (private window?).";
export const QUOTA_MESSAGE = 'Not enough storage space to save this song.';
const GENERIC_MESSAGE = 'Something went wrong with saved songs. Please try again.';

function readable(err: DOMException | null | undefined): Error {
  if (err?.name === 'QuotaExceededError') return new Error(QUOTA_MESSAGE);
  return new Error(GENERIC_MESSAGE);
}

/** One connection per page, shared by every store. */
let shared: Promise<IDBDatabase> | null = null;

export class IdbStorage implements SongStorage {
  constructor(private readonly store: StoreName = 'songs') {}

  getAll(): Promise<MarketSong[]> {
    return this.run('readonly', (store) => store.getAll() as IDBRequest<MarketSong[]>);
  }

  async put(song: MarketSong): Promise<void> {
    await this.run('readwrite', (store) => store.put(song));
  }

  async delete(id: string): Promise<void> {
    await this.run('readwrite', (store) => store.delete(id));
  }

  private open(): Promise<IDBDatabase> {
    if (!shared) {
      shared = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === 'undefined') throw new Error(UNAVAILABLE_MESSAGE);
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          for (const name of STORES) {
            if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            db.close();
            shared = null;
          };
          resolve(db);
        };
        req.onerror = () => reject(new Error(UNAVAILABLE_MESSAGE));
      }).catch((err: unknown) => {
        shared = null;
        throw err instanceof Error && err.message === UNAVAILABLE_MESSAGE ? err : new Error(UNAVAILABLE_MESSAGE);
      });
    }
    return shared;
  }

  /** Runs one request in its own transaction; resolves with its result once the transaction commits. */
  private async run<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      let req: IDBRequest<T>;
      try {
        tx = db.transaction(this.store, mode);
        req = make(tx.objectStore(this.store));
      } catch (err) {
        reject(readable(err instanceof DOMException ? err : null));
        return;
      }
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(readable(tx.error ?? req.error));
      tx.onerror = () => reject(readable(tx.error ?? req.error));
    });
  }
}
