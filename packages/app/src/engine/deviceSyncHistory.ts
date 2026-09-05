// app/src/engine/deviceSyncHistory.ts
// Per-device "you've synced this one before" record, shown on the Device
// screen so a diver can see which computers are known and when each last
// handed over dives -- separate from FINGERPRINT_STORAGE_PREFIX (webble.ts),
// which only tracks the newest-downloaded dive per device for incremental
// sync. Keeping them as separate keys means AccountsScreen's "forget synced
// devices" action clears both without either one depending on the other's
// shape.
import { readLocalStorage, writeLocalStorage, removeLocalStorageByPrefix } from '../lib/storage';

export const DEVICE_HISTORY_STORAGE_PREFIX = 'webble-device-history-';

export interface DeviceSyncRecord {
  deviceId: string;
  name: string;
  vendor: string;
  product: string;
  /** ISO timestamp of when this device last finished a (partial or full) sync. */
  lastSyncedAt: string;
  /** Dives downloaded during that last sync -- 0 if it was an up-to-date no-op. */
  lastSyncDiveCount: number;
}

function storageKey(deviceId: string): string {
  return DEVICE_HISTORY_STORAGE_PREFIX + deviceId;
}

export function recordDeviceSync(record: DeviceSyncRecord): void {
  writeLocalStorage(storageKey(record.deviceId), JSON.stringify(record));
}

/** The stored record for one device, or null if it's never synced (or the entry is corrupt). */
export function getDeviceSyncRecord(deviceId: string): DeviceSyncRecord | null {
  const raw = readLocalStorage(storageKey(deviceId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DeviceSyncRecord;
  } catch {
    return null;
  }
}

/** All known devices, most-recently-synced first. Best-effort: a corrupt entry is skipped, not thrown. */
export function listDeviceSyncHistory(): DeviceSyncRecord[] {
  const records: DeviceSyncRecord[] = [];
  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(DEVICE_HISTORY_STORAGE_PREFIX));
  } catch {
    return records; // Storage disabled/unavailable.
  }
  for (const key of keys) {
    const raw = readLocalStorage(key);
    if (!raw) continue;
    try {
      records.push(JSON.parse(raw) as DeviceSyncRecord);
    } catch {
      // Corrupt entry -- skip it rather than fail the whole list.
    }
  }
  return records.sort((a, b) => b.lastSyncedAt.localeCompare(a.lastSyncedAt));
}

export function forgetDeviceSyncHistory(): void {
  removeLocalStorageByPrefix(DEVICE_HISTORY_STORAGE_PREFIX);
}
