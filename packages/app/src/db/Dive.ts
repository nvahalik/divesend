import type { CanonicalDive } from '@divesend/core';

export type SyncState = 'notSynced' | 'synced' | 'doNotSync';

export interface StoredDive {
  id: string;
  date: string;
  maxDepthM: number;
  durationMinutes: number;
  computerModel: string;
  canonicalDive: CanonicalDive;
  syncState: SyncState;
  deviceSerialNumber: string | null;
  /** SSI's internal database identifier (`odin_user_log_id`). Not human-meaningful. */
  ssiDiveID: number | null;
  /** The account's sequential dive number (`odin_user_log_nr`), what SSI's own app labels a dive with. */
  ssiDiveNumber: number | null;
}

/**
 * Dedup key: the BLE device's own persistent id (stable across
 * reconnects, known immediately after requestDevice() resolves) plus the
 * dive's start time -- NOT the C-side serial number, which is only
 * populated as a side effect of the download call itself (see
 * webble/NOTES.md's fingerprint-key bugfix for the same reasoning applied
 * to localStorage's fingerprint key).
 */
export function diveId(deviceId: string, canonicalDive: CanonicalDive): string {
  return `${deviceId}-${canonicalDive.header.startTime}`;
}

export function diveDurationMinutes(canonicalDive: CanonicalDive): number {
  return Math.round(canonicalDive.header.divetimeS / 60);
}

export function toStoredDive(
  canonicalDive: CanonicalDive,
  deviceId: string,
  deviceSerialNumber: string | null
): StoredDive {
  return {
    id: diveId(deviceId, canonicalDive),
    date: canonicalDive.header.startTime,
    maxDepthM: canonicalDive.header.maxDepthM,
    durationMinutes: diveDurationMinutes(canonicalDive),
    computerModel: canonicalDive.header.deviceModel,
    canonicalDive,
    syncState: 'notSynced',
    deviceSerialNumber,
    ssiDiveID: null,
    ssiDiveNumber: null,
  };
}

/**
 * Dedup key for a dive imported from a file (not Bluetooth): the device
 * serial when the source format had one, else just the start time. Shaped
 * the same way as `diveId`'s `<identity>-<startTime>` so imports and BLE
 * dives never accidentally collide (a BLE `deviceId` is a GATT device id,
 * never equal to a device serial).
 */
export function importedDiveId(deviceSerial: string | null, canonicalDive: CanonicalDive): string {
  return `${deviceSerial ?? 'import'}-${canonicalDive.header.startTime}`;
}

export function toImportedStoredDive(canonicalDive: CanonicalDive, deviceSerial: string | null): StoredDive {
  return {
    id: importedDiveId(deviceSerial, canonicalDive),
    date: canonicalDive.header.startTime,
    maxDepthM: canonicalDive.header.maxDepthM,
    durationMinutes: diveDurationMinutes(canonicalDive),
    computerModel: canonicalDive.header.deviceModel,
    canonicalDive,
    syncState: 'notSynced',
    deviceSerialNumber: deviceSerial,
    ssiDiveID: null,
    ssiDiveNumber: null,
  };
}
