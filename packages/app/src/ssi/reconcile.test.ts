import { describe, expect, it } from 'vitest';
import { ssiDiveDateTimeKey, type CanonicalDive } from '@divesend/core';
import { indexDivelogByDateTime, reconcileDives, unlinkDeletedDives } from './reconcile';
import type { StoredDive, SyncState } from '../db/Dive';

function makeCanonicalDive(startTime: string, utcOffsetMinutes?: number | null): CanonicalDive {
  return {
    header: {
      startTime,
      ...(utcOffsetMinutes === undefined ? {} : { utcOffsetMinutes }),
      maxDepthM: 18,
      gasO2Percent: 21,
      gasHePercent: 0,
      tankBeginPressureBar: 200,
      tankEndPressureBar: 90,
      diveMode: 'oc',
      decoModel: 'buhlmann',
      gfLow: 40,
      gfHigh: 85,
      salinity: 'salt',
      deviceModel: 'Shearwater Teric',
      divetimeS: 2400,
      minTemperatureC: null,
      maxTemperatureC: null,
      cnsPercent: null,
    },
    samples: [],
  };
}

function makeDive(
  id: string,
  startTime: string,
  syncState: SyncState = 'notSynced',
  utcOffsetMinutes?: number | null
): StoredDive {
  return {
    id,
    diveId: id,
    date: startTime,
    maxDepthM: 18,
    durationMinutes: 40,
    computerModel: 'Shearwater Teric',
    canonicalDive: makeCanonicalDive(startTime, utcOffsetMinutes),
    syncState,
    deviceSerialNumber: null,
    ssiDiveID: null,
    ssiDiveNumber: null,
  };
}

/** A divelog record for a dive whose local start time is `startTime`. */
function ssiRecord(startTime: string, id: number, nr: number): Record<string, unknown> {
  return {
    odin_user_log_datetime: ssiDiveDateTimeKey(startTime),
    odin_user_log_id: id,
    odin_user_log_nr: nr,
  };
}

describe('indexDivelogByDateTime', () => {
  it('keys each record by its datetime string', () => {
    const index = indexDivelogByDateTime([ssiRecord('2026-08-01T10:00:00Z', 11, 2)]);
    expect(index.get(ssiDiveDateTimeKey('2026-08-01T10:00:00Z'))).toEqual({ ssiDiveID: 11, ssiDiveNumber: 2 });
  });

  it('ignores records missing a datetime, id, or number', () => {
    const index = indexDivelogByDateTime([
      { odin_user_log_id: 1, odin_user_log_nr: 1 },
      { odin_user_log_datetime: '2026-08-01 10:00', odin_user_log_nr: 1 },
      { odin_user_log_datetime: '2026-08-01 11:00', odin_user_log_id: 2 },
    ]);
    expect(index.size).toBe(0);
  });

  it('keeps the first record when two share a datetime', () => {
    const index = indexDivelogByDateTime([
      { odin_user_log_datetime: '2026-08-01 10:00', odin_user_log_id: 1, odin_user_log_nr: 1 },
      { odin_user_log_datetime: '2026-08-01 10:00', odin_user_log_id: 2, odin_user_log_nr: 2 },
    ]);
    expect(index.get('2026-08-01 10:00')).toEqual({ ssiDiveID: 1, ssiDiveNumber: 1 });
  });
});

describe('reconcileDives', () => {
  it('links a notSynced dive whose timestamp matches an SSI record', () => {
    const dive = makeDive('a', '2026-08-01T10:00:00Z');
    const linked = reconcileDives([dive], [ssiRecord('2026-08-01T10:00:00Z', 42, 7)]);

    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ id: 'a', syncState: 'synced', ssiDiveID: 42, ssiDiveNumber: 7 });
    // Returns a new object; the input is untouched (callers persist the copy).
    expect(dive.syncState).toBe('notSynced');
    expect(linked[0]).not.toBe(dive);
  });

  it('matches a UTC-instant dive against its diver-local SSI datetime, whatever the host timezone', () => {
    // startTime is true UTC; the Teric was on UTC-4, so SSI stored "2026-07-30 15:07".
    // The literal record string here does not depend on the test host's zone.
    const dive = makeDive('teric18', '2026-07-30T19:07:51Z', 'notSynced', -240);
    const linked = reconcileDives(
      [dive],
      [{ odin_user_log_datetime: '2026-07-30 15:07', odin_user_log_id: 900, odin_user_log_nr: 18 }]
    );
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ id: 'teric18', syncState: 'synced', ssiDiveID: 900, ssiDiveNumber: 18 });
  });

  it('matches at minute precision, ignoring seconds', () => {
    const dive = makeDive('a', '2026-08-01T10:00:59Z');
    const linked = reconcileDives([dive], [ssiRecord('2026-08-01T10:00:03Z', 1, 1)]);
    expect(linked).toHaveLength(1);
  });

  it('leaves a dive with no matching timestamp alone', () => {
    const linked = reconcileDives(
      [makeDive('a', '2026-08-01T10:00:00Z')],
      [ssiRecord('2026-08-01T10:01:00Z', 1, 1)]
    );
    expect(linked).toEqual([]);
  });

  it('skips dives that are already synced or marked doNotSync', () => {
    const dives = [
      makeDive('a', '2026-08-01T10:00:00Z', 'synced'),
      makeDive('b', '2026-08-01T10:00:00Z', 'doNotSync'),
    ];
    expect(reconcileDives(dives, [ssiRecord('2026-08-01T10:00:00Z', 1, 1)])).toEqual([]);
  });

  it('links only the matching dives out of a mixed set', () => {
    const dives = [
      makeDive('a', '2026-08-01T10:00:00Z'),
      makeDive('b', '2026-08-02T09:30:00Z'),
      makeDive('c', '2026-08-03T14:15:00Z'),
    ];
    const linked = reconcileDives(dives, [
      ssiRecord('2026-08-01T10:00:00Z', 100, 10),
      ssiRecord('2026-08-03T14:15:00Z', 300, 12),
    ]);
    expect(linked.map((d) => d.id).sort()).toEqual(['a', 'c']);
    expect(linked.find((d) => d.id === 'c')).toMatchObject({ ssiDiveID: 300, ssiDiveNumber: 12 });
  });
});

function makeSyncedDive(id: string, startTime: string, ssiDiveID: number, ssiDiveNumber: number): StoredDive {
  return { ...makeDive(id, startTime, 'synced'), ssiDiveID, ssiDiveNumber };
}

describe('unlinkDeletedDives', () => {
  it('unlinks a synced dive whose ssiDiveID is no longer in the divelog', () => {
    const dive = makeSyncedDive('a', '2026-08-01T10:00:00Z', 42, 7);
    const unlinked = unlinkDeletedDives([dive], []);
    // Empty divelog is treated as a fetch glitch, not "everything was deleted".
    expect(unlinked).toEqual([]);

    const stillEmpty = unlinkDeletedDives([dive], [ssiRecord('2026-09-01T10:00:00Z', 99, 1)]);
    expect(stillEmpty).toHaveLength(1);
    expect(stillEmpty[0]).toMatchObject({ id: 'a', syncState: 'notSynced', ssiDiveID: null, ssiDiveNumber: null });
    // Returns a new object; the input is untouched.
    expect(dive.syncState).toBe('synced');
    expect(stillEmpty[0]).not.toBe(dive);
  });

  it('leaves a synced dive alone when its ssiDiveID is still present', () => {
    const dive = makeSyncedDive('a', '2026-08-01T10:00:00Z', 42, 7);
    expect(unlinkDeletedDives([dive], [ssiRecord('2026-08-01T10:00:00Z', 42, 7)])).toEqual([]);
  });

  it('ignores notSynced and doNotSync dives', () => {
    const dives = [
      makeDive('a', '2026-08-01T10:00:00Z', 'notSynced'),
      makeDive('b', '2026-08-01T10:00:00Z', 'doNotSync'),
    ];
    expect(unlinkDeletedDives(dives, [ssiRecord('2026-09-01T10:00:00Z', 99, 1)])).toEqual([]);
  });

  it('unlinks only the dives whose ssiDiveID is missing, out of a mixed set', () => {
    const stale = makeSyncedDive('a', '2026-08-01T10:00:00Z', 1, 1);
    const current = makeSyncedDive('b', '2026-08-02T10:00:00Z', 2, 2);
    const unlinked = unlinkDeletedDives([stale, current], [ssiRecord('2026-08-02T10:00:00Z', 2, 2)]);
    expect(unlinked.map((d) => d.id)).toEqual(['a']);
  });
});
