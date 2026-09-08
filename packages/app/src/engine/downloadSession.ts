// app/src/engine/downloadSession.ts
// Owns the BLE download's UI-facing state at module scope instead of inside
// ConnectScreen's component state, so it survives navigating to another
// screen -- webble.ts's transport/GATT/WASM state was already module-level
// and unaffected by React unmounting; only the *visible* progress used to
// live and die with the ConnectScreen instance. Any screen can subscribe via
// useDownloadSession() and the download keeps running (and this store keeps
// updating) regardless of which one is currently mounted.
import { useSyncExternalStore } from 'react';
import { VENDOR_BLE_PROFILES, EXTRA_ADVERTISED_SERVICE_UUIDS } from './vendorProfiles';
import {
  waitForEngineReady,
  installTransport,
  openTransport,
  openDevice,
  deviceMatchIsFallback,
  closeSession,
  getDeviceVendor,
  getDeviceProduct,
  getDeviceSerialHex,
  downloadNewDives,
  getLatestFingerprintHex,
  FINGERPRINT_STORAGE_PREFIX,
  setDiveCallbacks,
  setProgressCallback,
  setLogCallback,
} from './webble';
import {
  startAttempt,
  markStage,
  setAttemptDevice,
  setAttemptDeviceName,
  finishAttempt,
  pushDiagLog,
  classifyError,
  recordGuardRejection,
} from './diagnostics';
import { recordDeviceSync, getDeviceSyncRecord } from './deviceSyncHistory';
import { toStoredDive, type RawDiveSource } from '../db/Dive';
import { upsertDive } from '../db/db';
import { readLocalStorage, writeLocalStorage } from '../lib/storage';
import type { CanonicalDive } from '@divesend/core';

/** Decodes a lowercase hex string (as emitted by the C side's hex_encode) into raw bytes. */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Builds a RawDiveSource from a BLE-downloaded dive's rawDataHex, or null if it's missing/empty. */
function rawSourceFromDive(dive: CanonicalDive): RawDiveSource | null {
  if (!dive.rawDataHex) return null;
  // Strip characters unsafe in filenames (":" from the ISO timestamp, etc.).
  const safeStartTime = dive.header.startTime.replace(/[^A-Za-z0-9._-]/g, '-');
  const safeModel = dive.header.deviceModel.replace(/[^A-Za-z0-9._-]/g, '-');
  return {
    bytes: hexToBytes(dive.rawDataHex),
    fileName: `${safeModel}-${safeStartTime}.bin`,
  };
}

export interface DownloadSessionState {
  connecting: boolean;
  log: string[];
  progress: string[];
  // The single most-recent stage message -- see ConnectScreen's prior version
  // of this comment: without it, everything between clicking Connect and the
  // first dive streaming in (device picker, GATT handshake, service
  // resolution) was invisible unless the user expanded Log.
  stage: string | null;
  // Byte-level (not dive-count) progress from libdivecomputer's
  // DC_EVENT_PROGRESS -- see setProgressCallback's doc comment. Not every
  // device backend reports this, so it may just never update.
  transfer: { current: number; maximum: number } | null;
  // This run's dive count -- resets to 0 at the start of each connect().
  diveCount: number;
  // Never resets -- App.tsx watches this (not diveCount) to know a dive
  // landed in IndexedDB and refresh the Dives list, regardless of which
  // screen is currently mounted.
  totalImported: number;
}

const initialState: DownloadSessionState = {
  connecting: false,
  log: [],
  progress: [],
  stage: null,
  transfer: null,
  diveCount: 0,
  totalImported: 0,
};

let state: DownloadSessionState = initialState;
const listeners = new Set<() => void>();

function setState(patch: Partial<DownloadSessionState> | ((s: DownloadSessionState) => Partial<DownloadSessionState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): DownloadSessionState {
  return state;
}

export function useDownloadSession(): DownloadSessionState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

function appendLog(msg: string): void {
  pushDiagLog('js', msg);
  setState((s) => ({ log: [...s.log, msg] }));
}

function announce(msg: string): void {
  appendLog(msg);
  setState({ stage: msg });
}

/**
 * Runs one connect-and-download cycle, updating the shared store as it goes.
 * Safe to call from any screen; a second call while one is already running
 * is rejected (mirrors webble.ts's own asyncCallInFlight guard, but with a
 * friendlier message before ever reaching the WASM call).
 */
export async function startDownload(): Promise<void> {
  if (state.connecting) {
    appendLog('A download is already in progress.');
    // NOT startAttempt() -- that resets the ring buffer and would destroy the
    // in-flight attempt's log. This records the rejection standalone.
    recordGuardRejection('already_running');
    return;
  }
  if (!navigator.bluetooth) {
    appendLog('Web Bluetooth is not available in this browser.');
    // Nothing is in flight here, so a real attempt is the honest shape: the
    // spec wants one event per startDownload() call, including this one.
    startAttempt();
    finishAttempt('error', 'bluetooth_unavailable', 0);
    return;
  }

  setState({
    connecting: true,
    progress: [],
    stage: null,
    transfer: null,
    diveCount: 0,
  });
  let importedCount = 0;
  let deviceForHistory: { id: string; name: string } | null = null;

  try {
    const diagCode = startAttempt();
    void diagCode; // returned for callers that surface it; not needed here
    await waitForEngineReady();
    // Tears down any prior C-side session before opening a new one -- see
    // webble/main.js's connect() and webble/NOTES.md Round 4 for why this
    // must happen unconditionally, every time.
    await closeSession();

    announce('Waiting for device selection…');
    markStage('device_select');
    const knownServices = VENDOR_BLE_PROFILES.map((p) => p.service);
    const device = await navigator.bluetooth.requestDevice({
      // One filter per known service, plus any EXTRA_ADVERTISED_SERVICE_UUIDS
      // entries -- a device can advertise a UUID that isn't any profile's own
      // `service` while still exposing one of those once connected (its ad
      // packet just doesn't have room for every GATT service it has; see
      // vendorProfiles.ts's doc comment on that constant).
      filters: [...knownServices, ...EXTRA_ADVERTISED_SERVICE_UUIDS].map((service) => ({ services: [service] })),
      // Grants access to every known vendor service regardless of which one
      // matched the filter above -- without this, the probing loop below
      // calling getPrimaryService() on a service that exists on the device
      // but wasn't the one matched by requestDevice() throws SecurityError
      // instead of the NotFoundError it expects for "wrong vendor, try the
      // next one." Needed precisely when a device advertises one UUID (an
      // EXTRA_ADVERTISED_SERVICE_UUIDS entry) but its usable service is a
      // different one that's actually in VENDOR_BLE_PROFILES.
      optionalServices: knownServices,
    });
    deviceForHistory = { id: device.id, name: device.name ?? 'Unknown device' };
    setAttemptDeviceName(device.name ?? '');
    announce('Selected device: ' + device.name);

    markStage('gatt_connect');
    const server = await device.gatt!.connect();

    let matched: { profile: (typeof VENDOR_BLE_PROFILES)[number]; service: BluetoothRemoteGATTService } | null = null;
    markStage('service_probe');
    for (const profile of VENDOR_BLE_PROFILES) {
      try {
        const service = await server.getPrimaryService(profile.service);
        matched = { profile, service };
        break;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'NotFoundError') {
          // This device doesn't advertise this vendor's service -- try the next candidate.
          continue;
        }
        // A different failure (e.g. the device disconnected mid-probe) --
        // don't silently reinterpret it as "no vendor matched."
        announce('GATT error while identifying the device: ' + String(e));
        finishAttempt('error', 'gatt_probe:' + (e instanceof DOMException ? e.name : 'error'), importedCount);
        return;
      }
    }
    if (!matched) {
      announce('Connected, but none of the known vendor services were found on this device.');
      finishAttempt('error', 'no_vendor_service', importedCount);
      return;
    }
    announce('Resolved vendor: ' + matched.profile.vendor);

    const rx = await matched.service.getCharacteristic(matched.profile.rx);
    const tx = await matched.service.getCharacteristic(matched.profile.tx);
    await installTransport(rx, tx);
    setLogCallback((level, line) => pushDiagLog('dc', line, String(level)));
    markStage('transport_open');
    announce('Connected and subscribed to notifications.');

    const openStatus = await openTransport();
    if (openStatus !== 0) {
      announce('webble_open failed with status ' + openStatus);
      finishAttempt('error', 'webble_open:' + openStatus, importedCount);
      return;
    }

    markStage('open_device');
    const openDeviceStatus = await openDevice(device.name ?? '');
    if (openDeviceStatus !== 0) {
      announce('webble_open_device failed with status ' + openDeviceStatus + ' (unrecognized device name?)');
      finishAttempt('error', 'webble_open_device:' + openDeviceStatus, importedCount);
      return;
    }

    const vendor = getDeviceVendor();
    const product = getDeviceProduct();
    setAttemptDevice(vendor, product, deviceMatchIsFallback());
    announce('Device session opened: ' + vendor + ' ' + product);
    if (deviceMatchIsFallback()) {
      appendLog(
        '⚠ "' +
          (device.name ?? '') +
          '" isn\'t a recognized model name -- opened it as ' +
          vendor +
          ' ' +
          product +
          " (a best guess). If the download fails, this model probably needs adding to the descriptor matcher."
      );
    }

    setProgressCallback((current, maximum) => setState({ transfer: { current, maximum } }));

    setDiveCallbacks(
      async (dive: CanonicalDive) => {
        // Serial is populated as a side effect of dc_device_foreach's
        // DEVINFO event, which fires before any dive callback in the same
        // walk -- so it's already valid here, not just after the whole
        // download completes.
        const serial = getDeviceSerialHex() || null;
        try {
          await upsertDive(toStoredDive(dive, device.id, serial, rawSourceFromDive(dive)));
          importedCount += 1;
          markStage('persist');
          setState((s) => ({
            diveCount: importedCount,
            totalImported: s.totalImported + 1,
            progress: [...s.progress, 'Downloaded dive ' + importedCount + ': ' + dive.header.startTime],
          }));
        } catch (e) {
          // A persistence failure on this dive (IndexedDB quota, private
          // browsing restrictions, etc.) must not silently vanish as an
          // unhandled promise rejection -- surface it and keep going, same
          // "stream not batch" philosophy as the C engine's own per-dive
          // decode-error handling: one bad dive doesn't discard the ones
          // already persisted.
          appendLog('Failed to save dive ' + dive.header.startTime + ': ' + String(e));
        }
      },
      (index, message) => appendLog('Dive ' + index + ' failed to decode: ' + message)
    );

    const fingerprintKey = FINGERPRINT_STORAGE_PREFIX + device.id;
    const storedFingerprint = readLocalStorage(fingerprintKey) ?? '';

    announce(storedFingerprint ? 'Checking for new dives…' : 'Downloading dives…');
    markStage('download');
    const downloadResult = await downloadNewDives(storedFingerprint);
    if (downloadResult < 0) {
      announce('webble_download_new_dives failed with status ' + downloadResult);
      finishAttempt('error', 'download:' + downloadResult, importedCount);
      return;
    }
    announce(downloadResult === 0 ? 'Up to date -- no new dives.' : 'Downloaded ' + downloadResult + ' new dive(s).');

    if (downloadResult > 0) {
      const latestFingerprint = getLatestFingerprintHex();
      if (latestFingerprint) {
        if (!writeLocalStorage(fingerprintKey, latestFingerprint)) {
          appendLog("Warning: couldn't save the sync fingerprint -- next connect will redownload every dive.");
        }
      }
    }

    recordDeviceSync({
      deviceId: device.id,
      name: device.name ?? 'Unknown device',
      vendor,
      product,
      lastSyncedAt: new Date().toISOString(),
      lastSyncDiveCount: importedCount,
    });

    finishAttempt(downloadResult === 0 ? 'no_new_dives' : 'success', null, importedCount);
  } catch (e) {
    const cancelled = e instanceof DOMException && e.name === 'NotFoundError' && !deviceForHistory;
    finishAttempt(cancelled ? 'user_cancelled' : 'error', cancelled ? '' : classifyError(e), importedCount);
    announce('Error: ' + String(e));
    // Still record the attempt if we got far enough to identify the device --
    // a diver checking "did it try?" after an error shouldn't see nothing.
    if (deviceForHistory) {
      // Don't call getDeviceVendor()/getDeviceProduct() here -- the error may
      // have happened before webble_open_device ever succeeded, so the WASM
      // module may never have populated them. Fall back to whatever this
      // device's last successful sync recorded, rather than blanking out
      // vendor/product info a prior run already established.
      const previous = getDeviceSyncRecord(deviceForHistory.id);
      recordDeviceSync({
        deviceId: deviceForHistory.id,
        name: deviceForHistory.name,
        vendor: previous?.vendor ?? '',
        product: previous?.product ?? '',
        lastSyncedAt: new Date().toISOString(),
        lastSyncDiveCount: importedCount,
      });
    }
  } finally {
    setState({ connecting: false });
  }
}
