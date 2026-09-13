import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncDive, syncAllDives, reconcileWithSSI } from './diveSyncEngine';
import type { StoredDive } from '../db/Dive';
import { ssiDiveDateTimeKey, type CanonicalDive } from '@divesend/core';

vi.mock('../db/db', () => ({
  putDive: vi.fn().mockResolvedValue(undefined),
  getAllDives: vi.fn().mockResolvedValue([]),
}));
vi.mock('./ssiClient', () => ({
  getDivelog: vi.fn(),
  saveDivelog: vi.fn(),
}));

import { putDive, getAllDives } from '../db/db';
import { getDivelog, saveDivelog } from './ssiClient';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAllDives).mockResolvedValue([]);
});

function makeCanonicalDive(): CanonicalDive {
  return {
    header: {
      startTime: '2026-07-28T12:26:00Z',
      maxDepthM: 3.63,
      gasO2Percent: 21.0,
      gasHePercent: 0.0,
      tankBeginPressureBar: 130.59,
      tankEndPressureBar: 103.01,
      diveMode: 'oc',
      decoModel: 'buhlmann',
      gfLow: 50,
      gfHigh: 85,
      salinity: 'salt',
      deviceModel: 'Shearwater Teric',
      divetimeS: 600,
      minTemperatureC: null,
      maxTemperatureC: null,
      cnsPercent: null,
    },
    samples: [],
  };
}

function makeDive(id = '1'): StoredDive {
  return {
    id,
    diveId: id,
    date: '2026-07-28T12:26:00Z',
    maxDepthM: 3.63,
    durationMinutes: 10,
    computerModel: 'Shearwater Teric',
    canonicalDive: makeCanonicalDive(),
    syncState: 'notSynced',
    deviceSerialNumber: null,
    ssiDiveID: null,
    ssiDiveNumber: null,
  };
}

describe('syncDive', () => {
  it('assigns the next dive number based on the existing divelog max', async () => {
    vi.mocked(getDivelog).mockResolvedValue([{ odin_user_log_nr: 5 }, { odin_user_log_nr: 8 }]);
    vi.mocked(saveDivelog).mockResolvedValue({ success: { odin_user_log_id: 1 } });
    const dive = makeDive();

    const id = await syncDive(dive);

    expect(id).toBe(1);
    expect(dive.ssiDiveNumber).toBe(9); // max(5, 8) + 1
    expect(dive.ssiDiveID).toBe(1);
    expect(dive.syncState).toBe('synced');
    const payload = vi.mocked(saveDivelog).mock.calls[0][0];
    expect(payload.odin_user_log_nr).toBe(9);
    expect(putDive).toHaveBeenCalledWith(dive);
  });

  it('defaults to dive number 1 when the account has no existing dives', async () => {
    vi.mocked(getDivelog).mockResolvedValue([]);
    vi.mocked(saveDivelog).mockResolvedValue({ success: { odin_user_log_id: 1 } });

    await syncDive(makeDive());

    expect(vi.mocked(saveDivelog).mock.calls[0][0].odin_user_log_nr).toBe(1);
  });

  it('merges extraDetails overrides into the payload', async () => {
    vi.mocked(getDivelog).mockResolvedValue([]);
    vi.mocked(saveDivelog).mockResolvedValue({ success: { odin_user_log_id: 1 } });

    await syncDive(makeDive(), { diveTypeID: 24 });

    expect(vi.mocked(saveDivelog).mock.calls[0][0].odin_user_log_var_divetype_id).toBe(24);
  });

  it('sends a computed SAC rate when both tank pressures are present', async () => {
    vi.mocked(getDivelog).mockResolvedValue([]);
    vi.mocked(saveDivelog).mockResolvedValue({ success: { odin_user_log_id: 1 } });

    await syncDive(makeDive()); // makeCanonicalDive: 130.59 -> 103.01 bar over 600s, no samples (surface avg)

    const payload = vi.mocked(saveDivelog).mock.calls[0][0];
    expect(payload.odin_user_log_amv_psi).toBeCloseTo(((130.59 - 103.01) / 10 / 1) * 14.5038, 1);
  });

  it('omits the SAC rate when a tank pressure reading is missing', async () => {
    vi.mocked(getDivelog).mockResolvedValue([]);
    vi.mocked(saveDivelog).mockResolvedValue({ success: { odin_user_log_id: 1 } });

    const dive = makeDive();
    dive.canonicalDive.header.tankEndPressureBar = null;
    await syncDive(dive);

    // buildCreatePayload defaults every omitted schema key to null.
    expect(vi.mocked(saveDivelog).mock.calls[0][0].odin_user_log_amv_psi).toBeNull();
  });

  it('throws and leaves the dive not-synced when the response has no ssi dive id', async () => {
    vi.mocked(getDivelog).mockResolvedValue([]);
    vi.mocked(saveDivelog).mockResolvedValue({ error: 'something went wrong' });
    const dive = makeDive();

    await expect(syncDive(dive)).rejects.toThrow();
    expect(dive.syncState).toBe('notSynced');
    expect(dive.ssiDiveID).toBeNull();
  });
});

describe('syncAllDives', () => {
  it('assigns sequentially incrementing dive numbers within one batch', async () => {
    vi.mocked(getDivelog).mockResolvedValue([{ odin_user_log_nr: 8 }]);
    vi.mocked(saveDivelog).mockResolvedValue({ success: { odin_user_log_id: 1 } });
    const first = makeDive('a');
    const second = makeDive('b');

    await syncAllDives([first, second]);

    expect(vi.mocked(saveDivelog).mock.calls[0][0].odin_user_log_nr).toBe(9);
    expect(vi.mocked(saveDivelog).mock.calls[1][0].odin_user_log_nr).toBe(10);
    expect(vi.mocked(getDivelog)).toHaveBeenCalledTimes(1); // fetched once for the whole batch
  });

  it('applies the same extraDetails to every dive in the batch', async () => {
    vi.mocked(getDivelog).mockResolvedValue([]);
    vi.mocked(saveDivelog).mockResolvedValue({ success: { odin_user_log_id: 1 } });

    await syncAllDives([makeDive('a'), makeDive('b')], { diveTypeID: 24 });

    expect(vi.mocked(saveDivelog).mock.calls[0][0].odin_user_log_var_divetype_id).toBe(24);
    expect(vi.mocked(saveDivelog).mock.calls[1][0].odin_user_log_var_divetype_id).toBe(24);
  });

  it('skips already-synced/doNotSync dives and continues past per-dive failures without stopping others', async () => {
    vi.mocked(getDivelog).mockResolvedValue([]);
    const failing = makeDive('a');
    const ok = makeDive('b');
    const alreadySynced = { ...makeDive('c'), syncState: 'synced' as const };
    vi.mocked(saveDivelog)
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ success: { odin_user_log_id: 2 } });

    const failures = await syncAllDives([failing, ok, alreadySynced]);

    expect(failures).toHaveLength(1);
    expect(failures[0].dive.id).toBe('a');
    expect(ok.syncState).toBe('synced');
    expect(vi.mocked(saveDivelog)).toHaveBeenCalledTimes(2); // alreadySynced excluded
  });

  it('links a dive already present on SSI (by timestamp) instead of re-uploading it', async () => {
    const already = makeDive('a'); // startTime 2026-07-28T12:26:00Z
    const fresh = makeDive('b');
    fresh.canonicalDive.header.startTime = '2026-07-28T15:00:00Z';
    vi.mocked(getAllDives).mockResolvedValue([already, fresh]);
    vi.mocked(getDivelog).mockResolvedValue([
      { odin_user_log_datetime: ssiDiveDateTimeKey(already.canonicalDive.header.startTime), odin_user_log_id: 777, odin_user_log_nr: 12 },
    ]);
    vi.mocked(saveDivelog).mockResolvedValue({ success: { odin_user_log_id: 999 } });

    const failures = await syncAllDives([already, fresh]);

    expect(failures).toHaveLength(0);
    expect(vi.mocked(saveDivelog)).toHaveBeenCalledTimes(1); // only 'b' uploaded
    // 'a' persisted as a link to the existing SSI record.
    const linkedPut = vi.mocked(putDive).mock.calls.find(([d]) => d.id === 'a')?.[0];
    expect(linkedPut).toMatchObject({ syncState: 'synced', ssiDiveID: 777, ssiDiveNumber: 12 });
  });
});

describe('reconcileWithSSI', () => {
  it('persists every local notSynced dive whose timestamp matches an SSI record', async () => {
    const match = makeDive('a');
    const noMatch = makeDive('b');
    noMatch.canonicalDive.header.startTime = '2026-01-01T00:00:00Z';
    vi.mocked(getAllDives).mockResolvedValue([match, noMatch]);
    vi.mocked(getDivelog).mockResolvedValue([
      { odin_user_log_datetime: ssiDiveDateTimeKey(match.canonicalDive.header.startTime), odin_user_log_id: 5, odin_user_log_nr: 3 },
    ]);

    const linked = await reconcileWithSSI();

    expect(linked.map((d) => d.id)).toEqual(['a']);
    expect(linked[0]).toMatchObject({ syncState: 'synced', ssiDiveID: 5, ssiDiveNumber: 3 });
    expect(putDive).toHaveBeenCalledTimes(1);
    expect(vi.mocked(putDive).mock.calls[0][0].id).toBe('a');
  });

  it('links nothing when no timestamps line up', async () => {
    vi.mocked(getAllDives).mockResolvedValue([makeDive('a')]);
    vi.mocked(getDivelog).mockResolvedValue([{ odin_user_log_datetime: '1999-01-01 00:00', odin_user_log_id: 1, odin_user_log_nr: 1 }]);

    expect(await reconcileWithSSI()).toEqual([]);
    expect(putDive).not.toHaveBeenCalled();
  });

  it('unlinks a synced dive whose SSI record was deleted', async () => {
    const deleted = { ...makeDive('a'), syncState: 'synced' as const, ssiDiveID: 42, ssiDiveNumber: 7 };
    vi.mocked(getAllDives).mockResolvedValue([deleted]);
    vi.mocked(getDivelog).mockResolvedValue([
      { odin_user_log_datetime: '2026-09-01 00:00', odin_user_log_id: 99, odin_user_log_nr: 1 },
    ]);

    const result = await reconcileWithSSI();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'a', syncState: 'notSynced', ssiDiveID: null, ssiDiveNumber: null });
    expect(putDive).toHaveBeenCalledTimes(1);
  });

  it('does not unlink a synced dive still present in an empty-looking divelog fetch', async () => {
    const synced = { ...makeDive('a'), syncState: 'synced' as const, ssiDiveID: 42, ssiDiveNumber: 7 };
    vi.mocked(getAllDives).mockResolvedValue([synced]);
    vi.mocked(getDivelog).mockResolvedValue([]);

    expect(await reconcileWithSSI()).toEqual([]);
    expect(putDive).not.toHaveBeenCalled();
  });
});
