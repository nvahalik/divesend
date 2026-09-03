import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncDive, syncAllDives } from './diveSyncEngine';
import type { StoredDive } from '../db/Dive';
import type { CanonicalDive } from '@divesend/core';

vi.mock('../db/db', () => ({ putDive: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./ssiClient', () => ({
  getDivelog: vi.fn(),
  saveDivelog: vi.fn(),
}));

import { putDive } from '../db/db';
import { getDivelog, saveDivelog } from './ssiClient';

beforeEach(() => {
  vi.clearAllMocks();
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
});
