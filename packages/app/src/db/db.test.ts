// app/src/db/db.test.ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import type { StoredDive } from './Dive';

const DB_NAME = 'dive-send';

function makeDive(id: string, date: string, overrides: Partial<StoredDive> = {}): StoredDive {
  return {
    id,
    diveId: id,
    date,
    maxDepthM: 10,
    durationMinutes: 30,
    computerModel: 'Test',
    canonicalDive: {
      header: {
        startTime: date,
        maxDepthM: 10,
        gasO2Percent: 21,
        gasHePercent: 0,
        tankBeginPressureBar: 200,
        tankEndPressureBar: 100,
        diveMode: 'oc',
        decoModel: 'buhlmann',
        gfLow: 30,
        gfHigh: 80,
        salinity: 'salt',
        deviceModel: 'Test',
        divetimeS: 1800,
        minTemperatureC: null,
        maxTemperatureC: null,
        cnsPercent: null,
      },
      samples: [],
    },
    syncState: 'notSynced',
    deviceSerialNumber: null,
    ssiDiveID: null,
    ssiDiveNumber: null,
    ...overrides,
  };
}

describe('db', () => {
  // Each test re-imports db.ts fresh (its dbPromise is module-level cached),
  // closes that fresh module's connection, and deletes the underlying
  // fake-indexeddb database afterward, so tests don't leak state into each
  // other despite the fixed DB_NAME. Closing first matters: fake-indexeddb's
  // deleteDatabase() never resolves while a connection is still open, which
  // would otherwise hang every test after the first.
  let currentDb: typeof import('./db') | null = null;

  beforeEach(() => {
    vi.resetModules();
    currentDb = null;
  });

  afterEach(async () => {
    await currentDb?.closeDb();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  it('stores and retrieves a dive by id', async () => {
    currentDb = await import('./db');
    const { putDive, getDive } = currentDb;
    const dive = makeDive('a', '2026-08-01T00:00:00Z');
    await putDive(dive);
    expect(await getDive('a')).toEqual(dive);
  });

  it('returns undefined for a missing id', async () => {
    currentDb = await import('./db');
    const { getDive } = currentDb;
    expect(await getDive('missing')).toBeUndefined();
  });

  it('getAllDives returns dives sorted newest-first by date', async () => {
    currentDb = await import('./db');
    const { putDive, getAllDives } = currentDb;
    await putDive(makeDive('a', '2026-08-01T00:00:00Z'));
    await putDive(makeDive('b', '2026-08-03T00:00:00Z'));
    await putDive(makeDive('c', '2026-08-02T00:00:00Z'));
    const all = await getAllDives();
    expect(all.map((d) => d.id)).toEqual(['b', 'c', 'a']);
  });

  it('putDive overwrites an existing dive with the same id', async () => {
    currentDb = await import('./db');
    const { putDive, getDive } = currentDb;
    await putDive(makeDive('a', '2026-08-01T00:00:00Z'));
    await putDive(makeDive('a', '2026-08-01T00:00:00Z', { maxDepthM: 25 }));
    expect((await getDive('a'))?.maxDepthM).toBe(25);
  });

  it('getAllDives returns an empty array when nothing is stored', async () => {
    currentDb = await import('./db');
    const { getAllDives } = currentDb;
    expect(await getAllDives()).toEqual([]);
  });

  describe('upsertDive', () => {
    it('adds a dive that has no existing row with the same diveId', async () => {
      currentDb = await import('./db');
      const { upsertDive, getAllDives } = currentDb;
      await upsertDive(makeDive('uuid-1', '2026-08-01T00:00:00Z', { diveId: 'dev-a-2026-08-01T00:00:00Z' }));
      const all = await getAllDives();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('uuid-1');
    });

    it('refreshes the existing row in place when the diveId already exists, keeping its id and sync/hidden fields', async () => {
      currentDb = await import('./db');
      const { upsertDive, getAllDives, getDive } = currentDb;
      const key = 'dev-a-2026-08-01T00:00:00Z';
      await upsertDive(makeDive('uuid-original', '2026-08-01T00:00:00Z', { diveId: key }));
      // Simulate a later SSI sync + user hiding the dive.
      const synced = await getDive('uuid-original');
      await currentDb.putDive({ ...synced!, syncState: 'synced', ssiDiveID: 999, ssiDiveNumber: 42, hidden: true });

      // Re-download the same physical dive: fresh UUID, corrected depth.
      await upsertDive(makeDive('uuid-second', '2026-08-01T00:00:00Z', { diveId: key, maxDepthM: 33 }));

      const all = await getAllDives();
      expect(all).toHaveLength(1);
      const row = all[0];
      expect(row.id).toBe('uuid-original'); // identity preserved
      expect(row.maxDepthM).toBe(33); // parsed data refreshed
      expect(row.syncState).toBe('synced'); // sync state preserved
      expect(row.ssiDiveID).toBe(999);
      expect(row.ssiDiveNumber).toBe(42);
      expect(row.hidden).toBe(true); // user flag preserved
    });
  });

  describe('v1 -> v2 migration', () => {
    it('gives every legacy dive a UUID id and moves its old id into diveId', async () => {
      // Seed a v1-shaped database: object store keyed by `id`, `date` index
      // only, rows whose `id` is the old content-derived composite.
      const v1 = await openDB(DB_NAME, 1, {
        upgrade(db) {
          const store = db.createObjectStore('dives', { keyPath: 'id' });
          store.createIndex('date', 'date');
        },
      });
      const legacyId = 'device-abc-2026-08-22T11:42:10Z';
      await v1.put('dives', makeDive(legacyId, '2026-08-22T11:42:10Z') as unknown as Record<string, unknown>);
      // makeDive() adds a `diveId` field; strip it so the row looks truly legacy.
      const legacy = await v1.get('dives', legacyId);
      delete (legacy as Record<string, unknown>).diveId;
      await v1.put('dives', legacy as Record<string, unknown>);
      v1.close();

      currentDb = await import('./db');
      const all = await currentDb.getAllDives();
      expect(all).toHaveLength(1);
      expect(all[0].diveId).toBe(legacyId);
      expect(all[0].id).not.toBe(legacyId);
      expect(all[0].id).toMatch(/^[0-9a-f-]{36}$/);
      // The migrated row is reachable by its new UUID and by the diveId index.
      expect(await currentDb.getDive(all[0].id)).toBeTruthy();
    });
  });
});
