// app/src/db/db.ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StoredDive } from './Dive';

interface DiveDB extends DBSchema {
  dives: {
    key: string;
    value: StoredDive;
    indexes: { date: string; diveId: string };
  };
}

const DB_NAME = 'dive-send';
// v2: `id` became an opaque UUID and the old content-derived id moved to the
// `diveId` field (indexed, unique), which `upsertDive` now de-dups on.
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<DiveDB>> | null = null;

function getDb(): Promise<IDBPDatabase<DiveDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DiveDB>(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const store = db.createObjectStore('dives', { keyPath: 'id' });
          store.createIndex('date', 'date');
        }
        if (oldVersion < 2) {
          const store = tx.objectStore('dives');
          // Move each existing row's content-derived id into `diveId` and give
          // it a fresh UUID `id`. The key changes, so it's a delete + re-add
          // within this upgrade transaction rather than an in-place update.
          for (let cursor = await store.openCursor(); cursor; cursor = await cursor.continue()) {
            const legacy = cursor.value as StoredDive & { diveId?: string };
            if (legacy.diveId) continue;
            const migrated: StoredDive = { ...legacy, id: crypto.randomUUID(), diveId: legacy.id };
            await cursor.delete();
            await store.put(migrated);
          }
          store.createIndex('diveId', 'diveId', { unique: true });
        }
      },
    });
  }
  return dbPromise;
}

export async function putDive(dive: StoredDive): Promise<void> {
  const db = await getDb();
  await db.put('dives', dive);
}

/**
 * Inserts `dive`, or -- when a row with the same `diveId` already exists --
 * refreshes that row's parsed dive data in place while preserving its identity
 * (`id`) and every user/sync-owned field (`syncState`, `ssiDiveID`,
 * `ssiDiveNumber`, `hidden`). This is how re-downloading or re-importing a
 * dive avoids creating a duplicate without discarding SSI linkage or a
 * user's hidden flag.
 */
export async function upsertDive(dive: StoredDive): Promise<void> {
  const db = await getDb();
  const existing = await db.getFromIndex('dives', 'diveId', dive.diveId);
  if (!existing) {
    await db.add('dives', dive);
    return;
  }
  await db.put('dives', {
    ...dive,
    id: existing.id,
    syncState: existing.syncState,
    ssiDiveID: existing.ssiDiveID,
    ssiDiveNumber: existing.ssiDiveNumber,
    hidden: existing.hidden,
  });
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
