import type { CanonicalDive } from '@divesend/core';

export type SyncState = 'notSynced' | 'synced' | 'doNotSync';

/**
 * The dive's original source bytes, verbatim -- the uploaded file for a file
 * import, or the raw buffer libdivecomputer handed us for a BLE download.
 * Kept alongside (not instead of) the parsed `canonicalDive` purely so the
 * "export raw" feature can hand back exactly what came in, unmodified.
 */
export interface RawDiveSource {
  bytes: Uint8Array;
  /** Suggested filename for a raw-export download. */
  fileName: string;
}

export interface StoredDive {
  /** Opaque, stable, URL-safe primary key (a UUID). Never derived from dive content. */
  id: string;
  /**
   * The dive's *identity* key, used only for de-duplication: re-downloading or
   * re-importing the same physical dive produces the same `diveId`, so
   * `upsertDive` refreshes the existing row instead of creating a second one.
   * `${bleDeviceId}-${startTime}` for a BLE download, `${serial ?? 'import'}-${startTime}`
   * for a file import. NOT the primary key -- that's `id`.
   */
  diveId: string;
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
  /** User-hidden from the dive list. Undefined/false means visible -- no migration needed for existing dives. */
  hidden?: boolean;
  /** Absent for dives stored before this field existed, or a BLE dive whose device doesn't hand us raw bytes. */
  rawSource?: RawDiveSource | null;
}

/**
 * Identity key for a BLE-downloaded dive (stored as `StoredDive.diveId`, used
 * for de-dup -- see that field's doc comment): the BLE device's own persistent
 * id (stable across reconnects, known immediately after requestDevice()
 * resolves) plus the dive's start time -- NOT the C-side serial number, which
 * is only populated as a side effect of the download call itself (see
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
  deviceSerialNumber: string | null,
  rawSource?: RawDiveSource | null
): StoredDive {
  return {
    id: crypto.randomUUID(),
    diveId: diveId(deviceId, canonicalDive),
    date: canonicalDive.header.startTime,
    maxDepthM: canonicalDive.header.maxDepthM,
    durationMinutes: diveDurationMinutes(canonicalDive),
    computerModel: canonicalDive.header.deviceModel,
    canonicalDive,
    syncState: 'notSynced',
    deviceSerialNumber,
    ssiDiveID: null,
    ssiDiveNumber: null,
    rawSource: rawSource ?? null,
  };
}

/**
 * Identity key for a dive imported from a file (not Bluetooth), stored as
 * `StoredDive.diveId` and used for de-dup: the device serial when the source
 * format had one, else just the start time. Shaped the same way as `diveId`'s
 * `<identity>-<startTime>` so imports and BLE dives never accidentally collide
 * (a BLE `deviceId` is a GATT device id, never equal to a device serial).
 */
export function importedDiveId(deviceSerial: string | null, canonicalDive: CanonicalDive): string {
  return `${deviceSerial ?? 'import'}-${canonicalDive.header.startTime}`;
}

export function toImportedStoredDive(
  canonicalDive: CanonicalDive,
  deviceSerial: string | null,
  rawSource?: RawDiveSource | null
): StoredDive {
  return {
    id: crypto.randomUUID(),
    diveId: importedDiveId(deviceSerial, canonicalDive),
    date: canonicalDive.header.startTime,
    maxDepthM: canonicalDive.header.maxDepthM,
    durationMinutes: diveDurationMinutes(canonicalDive),
    computerModel: canonicalDive.header.deviceModel,
    canonicalDive,
    syncState: 'notSynced',
    deviceSerialNumber: deviceSerial,
    ssiDiveID: null,
    ssiDiveNumber: null,
    rawSource: rawSource ?? null,
  };
}
