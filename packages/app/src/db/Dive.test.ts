import { describe, expect, it } from 'vitest';
import { diveId, diveDurationMinutes, toStoredDive, importedDiveId, toImportedStoredDive } from './Dive';
import type { CanonicalDive } from '@divesend/core';

function makeCanonicalDive(overrides: Partial<CanonicalDive['header']> = {}): CanonicalDive {
  return {
    header: {
      startTime: '2026-08-22T11:42:10Z',
      maxDepthM: 10.75944,
      gasO2Percent: 21,
      gasHePercent: 0,
      tankBeginPressureBar: 184.6,
      tankEndPressureBar: 74.5,
      diveMode: 'oc',
      decoModel: 'buhlmann',
      gfLow: 50,
      gfHigh: 85,
      salinity: 'fresh',
      deviceModel: 'Petrel 2',
      divetimeS: 2484,
      minTemperatureC: null,
      maxTemperatureC: null,
      cnsPercent: null,
      ...overrides,
    },
    samples: [],
  };
}

describe('diveId', () => {
  it('combines the device id and dive start time', () => {
    expect(diveId('device-abc', makeCanonicalDive())).toBe('device-abc-2026-08-22T11:42:10Z');
  });

  it('produces different ids for different dives on the same device', () => {
    const a = diveId('device-abc', makeCanonicalDive({ startTime: '2026-08-01T00:00:00Z' }));
    const b = diveId('device-abc', makeCanonicalDive({ startTime: '2026-08-02T00:00:00Z' }));
    expect(a).not.toBe(b);
  });
});

describe('diveDurationMinutes', () => {
  it('converts divetimeS to whole minutes, rounding to the nearest minute', () => {
    expect(diveDurationMinutes(makeCanonicalDive({ divetimeS: 2484 }))).toBe(41); // 41.4 -> 41
    expect(diveDurationMinutes(makeCanonicalDive({ divetimeS: 2490 }))).toBe(42); // 41.5 -> 42
  });
});

describe('toStoredDive', () => {
  it('builds a StoredDive with notSynced state and the given device metadata', () => {
    const canonicalDive = makeCanonicalDive();
    const stored = toStoredDive(canonicalDive, 'device-abc', 'ABCD1234');

    expect(stored.id).toBe('device-abc-2026-08-22T11:42:10Z');
    expect(stored.date).toBe('2026-08-22T11:42:10Z');
    expect(stored.maxDepthM).toBe(10.75944);
    expect(stored.durationMinutes).toBe(41);
    expect(stored.computerModel).toBe('Petrel 2');
    expect(stored.syncState).toBe('notSynced');
    expect(stored.deviceSerialNumber).toBe('ABCD1234');
    expect(stored.canonicalDive).toBe(canonicalDive);
  });

  it('stores a null deviceSerialNumber as-is', () => {
    const stored = toStoredDive(makeCanonicalDive(), 'device-abc', null);
    expect(stored.deviceSerialNumber).toBeNull();
  });
});

describe('importedDiveId', () => {
  it('uses the device serial when present', () => {
    const dive = makeCanonicalDive({ startTime: '2026-01-01T10:00:00Z' });
    expect(importedDiveId('00000000', dive)).toBe('00000000-2026-01-01T10:00:00Z');
  });

  it("falls back to 'import' when there is no serial", () => {
    const dive = makeCanonicalDive({ startTime: '2026-01-01T10:00:00Z' });
    expect(importedDiveId(null, dive)).toBe('import-2026-01-01T10:00:00Z');
  });

  it('is stable across repeated calls for the same dive+serial (dedup proof)', () => {
    const dive = makeCanonicalDive({ startTime: '2026-01-01T10:00:00Z' });
    expect(importedDiveId('00000000', dive)).toBe(importedDiveId('00000000', dive));
  });
});

describe('toImportedStoredDive', () => {
  it('builds a StoredDive with the imported id, serial, and notSynced state', () => {
    const dive = makeCanonicalDive({ startTime: '2026-01-01T10:00:00Z', maxDepthM: 12.5, divetimeS: 1800, deviceModel: 'Teric' });
    const stored = toImportedStoredDive(dive, '00000000');
    expect(stored.id).toBe('00000000-2026-01-01T10:00:00Z');
    expect(stored.deviceSerialNumber).toBe('00000000');
    expect(stored.date).toBe('2026-01-01T10:00:00Z');
    expect(stored.maxDepthM).toBe(12.5);
    expect(stored.durationMinutes).toBe(30);
    expect(stored.computerModel).toBe('Teric');
    expect(stored.syncState).toBe('notSynced');
    expect(stored.ssiDiveID).toBeNull();
    expect(stored.ssiDiveNumber).toBeNull();
    expect(stored.canonicalDive).toBe(dive);
  });

  it('builds the fallback id when there is no serial', () => {
    const dive = makeCanonicalDive({ startTime: '2026-01-02T08:00:00Z' });
    const stored = toImportedStoredDive(dive, null);
    expect(stored.id).toBe('import-2026-01-02T08:00:00Z');
    expect(stored.deviceSerialNumber).toBeNull();
  });
});
