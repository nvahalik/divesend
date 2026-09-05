// app/src/db/db.ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StoredDive } from './Dive';

interface DiveDB extends DBSchema {
  dives: {
    key: string;
    value: StoredDive;
    indexes: { date: string };
  };
}

const DB_NAME = 'dive-send';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<DiveDB>> | null = null;

function getDb(): Promise<IDBPDatabase<DiveDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DiveDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('dives', { keyPath: 'id' });
        store.createIndex('date', 'date');
      },
    });
  }
  return dbPromise;
}

export async function putDive(dive: StoredDive): Promise<void> {
  const db = await getDb();
  await db.put('dives', dive);
}

/** Newest-first by dive date. */
export async function getAllDives(): Promise<StoredDive[]> {
  const db = await getDb();
  const dives = await db.getAllFromIndex('dives', 'date');
  return dives.reverse();
}

export async function getDive(id: string): Promise<StoredDive | undefined> {
  const db = await getDb();
  return db.get('dives', id);
}

/** Sets (or clears) a dive's `hidden` flag and persists the change. No-op if the dive doesn't exist. */
export async function setDiveHidden(id: string, hidden: boolean): Promise<void> {
  const dive = await getDive(id);
  if (!dive) return;
  dive.hidden = hidden;
  await putDive(dive);
}

/** Deletes every stored dive. Local-only -- does not touch anything already synced to SSI. */
export async function clearAllDives(): Promise<void> {
  const db = await getDb();
  await db.clear('dives');
}

/**
 * Closes the current connection (if any) and clears the cached promise so a
 * subsequent call re-opens a fresh connection. Mainly useful in tests, where
 * a lingering open connection would otherwise block `indexedDB.deleteDatabase`.
 */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const promise = dbPromise;
  dbPromise = null;
  const db = await promise;
  db.close();
}
