// app/src/db/db.test.ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredDive } from './Dive';

const DB_NAME = 'dive-send';

function makeDive(id: string, date: string, overrides: Partial<StoredDive> = {}): StoredDive {
  return {
    id,
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
});
