import { describe, expect, it } from 'vitest';
import { ssiDiveDateTimeKey, type CanonicalDive } from '@divesend/core';
import { indexDivelogByDateTime, reconcileDives } from './reconcile';
import type { StoredDive, SyncState } from '../db/Dive';

function makeCanonicalDive(startTime: string): CanonicalDive {
  return {
    header: {
      startTime,
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

function makeDive(id: string, startTime: string, syncState: SyncState = 'notSynced'): StoredDive {
  return {
    id,
    diveId: id,
    date: startTime,
    maxDepthM: 18,
    durationMinutes: 40,
    computerModel: 'Shearwater Teric',
    canonicalDive: makeCanonicalDive(startTime),
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
