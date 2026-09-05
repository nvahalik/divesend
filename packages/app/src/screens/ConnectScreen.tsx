// app/src/screens/ConnectScreen.tsx
import { useCallback, useState } from 'react';
import { VENDOR_BLE_PROFILES } from '../engine/vendorProfiles';
import {
  waitForEngineReady,
  installTransport,
  openTransport,
  openDevice,
  closeSession,
  getDeviceVendor,
  getDeviceProduct,
  getDeviceSerialHex,
  downloadNewDives,
  getLatestFingerprintHex,
  FINGERPRINT_STORAGE_PREFIX,
  setDiveCallbacks,
  setProgressCallback,
} from '../engine/webble';
import { toStoredDive, type RawDiveSource } from '../db/Dive';
import { putDive } from '../db/db';
import { readLocalStorage, writeLocalStorage } from '../lib/storage';
import { isWebBluetoothSupported } from '../lib/webBluetooth';
import { BluetoothUnsupportedNotice } from '../components/BluetoothUnsupportedNotice';
import type { CanonicalDive } from '@divesend/core';

interface Props {
  onDivesImported: () => void;
}

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

export function ConnectScreen({ onDivesImported }: Props) {
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);
  // The single most-recent stage message, shown prominently instead of only
  // inside the collapsed Log below -- without this, everything between
  // clicking Connect and the first dive streaming in (device picker, GATT
  // handshake, service/characteristic resolution) was invisible unless the
  // user thought to expand Log, which read as "nothing is happening."
  const [stage, setStage] = useState<string | null>(null);
  // Byte-level (not dive-count) progress from libdivecomputer's
  // DC_EVENT_PROGRESS -- see setProgressCallback's doc comment. Not every
  // device backend reports this, so it may just never update.
  const [transfer, setTransfer] = useState<{ current: number; maximum: number } | null>(null);
  const [diveCount, setDiveCount] = useState(0);

  const appendLog = useCallback((msg: string) => setLog((l) => [...l, msg]), []);
  const announce = useCallback(
    (msg: string) => {
      appendLog(msg);
      setStage(msg);
    },
    [appendLog]
  );

  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      appendLog('Web Bluetooth is not available in this browser.');
      return;
    }

    setConnecting(true);
    setProgress([]);
    setStage(null);
    setTransfer(null);
    setDiveCount(0);
    let importedCount = 0;

    try {
      await waitForEngineReady();
      // Tears down any prior C-side session before opening a new one --
      // see webble/main.js's connect() and webble/NOTES.md Round 4 for why
      // this must happen unconditionally, every time.
      await closeSession();

      announce('Waiting for device selection…');
      const device = await navigator.bluetooth.requestDevice({
        filters: VENDOR_BLE_PROFILES.map((p) => ({ services: [p.service] })),
      });
      announce('Selected device: ' + device.name);

      const server = await device.gatt!.connect();

      let matched: { profile: (typeof VENDOR_BLE_PROFILES)[number]; service: BluetoothRemoteGATTService } | null = null;
      for (const profile of VENDOR_BLE_PROFILES) {
        try {
          const service = await server.getPrimaryService(profile.service);
          matched = { profile, service };
          break;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'NotFoundError') {
            // This device doesn't advertise this vendor's service -- try
            // the next candidate.
            continue;
          }
          // A different failure (e.g. the device disconnected mid-probe) --
          // don't silently reinterpret it as "no vendor matched."
          announce('GATT error while identifying the device: ' + String(e));
          return;
        }
      }
      if (!matched) {
        announce('Connected, but none of the known vendor services were found on this device.');
        return;
      }
      announce('Resolved vendor: ' + matched.profile.vendor);

      const rx = await matched.service.getCharacteristic(matched.profile.rx);
      const tx = await matched.service.getCharacteristic(matched.profile.tx);
      await installTransport(rx, tx);
      announce('Connected and subscribed to notifications.');

      const openStatus = await openTransport();
      if (openStatus !== 0) {
        announce('webble_open failed with status ' + openStatus);
        return;
      }

      const openDeviceStatus = await openDevice(device.name ?? '');
      if (openDeviceStatus !== 0) {
        announce('webble_open_device failed with status ' + openDeviceStatus + ' (unrecognized device name?)');
        return;
      }

      announce('Device session opened: ' + getDeviceVendor() + ' ' + getDeviceProduct());

      setProgressCallback((current, maximum) => setTransfer({ current, maximum }));

      setDiveCallbacks(
        async (dive: CanonicalDive) => {
          // Serial is populated as a side effect of dc_device_foreach's
          // DEVINFO event, which fires before any dive callback in the
          // same walk -- so it's already valid here, not just after the
          // whole download completes.
          const serial = getDeviceSerialHex() || null;
          try {
            await putDive(toStoredDive(dive, device.id, serial, rawSourceFromDive(dive)));
            importedCount += 1;
            setDiveCount(importedCount);
            setProgress((p) => [...p, 'Downloaded dive ' + importedCount + ': ' + dive.header.startTime]);
          } catch (e) {
            // A persistence failure on this dive (IndexedDB quota, private
            // browsing restrictions, etc.) must not silently vanish as an
            // unhandled promise rejection -- surface it and keep going, same
            // "stream not batch" philosophy as the C engine's own
            // per-dive decode-error handling: one bad dive doesn't discard
            // the ones already persisted.
            appendLog('Failed to save dive ' + dive.header.startTime + ': ' + String(e));
          }
        },
        (index, message) => appendLog('Dive ' + index + ' failed to decode: ' + message)
      );

      const fingerprintKey = FINGERPRINT_STORAGE_PREFIX + device.id;
      const storedFingerprint = readLocalStorage(fingerprintKey) ?? '';

      announce(storedFingerprint ? 'Checking for new dives…' : 'Downloading dives…');
      const downloadResult = await downloadNewDives(storedFingerprint);
      if (downloadResult < 0) {
        announce('webble_download_new_dives failed with status ' + downloadResult);
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
    } catch (e) {
      announce('Error: ' + String(e));
    } finally {
      // Fires whenever anything was actually persisted this run, regardless
      // of whether the overall download call ultimately failed (e.g.
      // downloadNewDives returning a negative status after streaming a few
      // dives successfully) -- dives already saved to IndexedDB should show
      // up in the list even if the run as a whole didn't finish cleanly.
      if (importedCount > 0) {
        onDivesImported();
      }
      setConnecting(false);
    }
  }, [appendLog, announce, onDivesImported]);

  const bluetoothSupported = isWebBluetoothSupported();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Connect</h1>
      {!bluetoothSupported && <BluetoothUnsupportedNotice />}
      <button
        onClick={() => void connect()}
        disabled={connecting || !bluetoothSupported}
        className="flex w-fit items-center gap-2 rounded-lg bg-slate-900 px-6 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {connecting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
        {connecting ? 'Connecting…' : 'Connect'}
      </button>
      {connecting && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <p className="font-medium text-slate-700">{stage ?? 'Starting…'}</p>
          {transfer && transfer.maximum > 0 && (
            <div className="flex flex-col gap-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-cyan-500 transition-[width]"
                  style={{ width: `${Math.min(100, (transfer.current / transfer.maximum) * 100)}%` }}
                />
              </div>
              {/* current/maximum are the device backend's own units (usually bytes
                  through the raw dump, not a dive count) -- see setProgressCallback's
                  doc comment for why this can't say "dive N of M". */}
              <p className="text-xs text-slate-500">
                {Math.min(100, Math.round((transfer.current / transfer.maximum) * 100))}% transferred
              </p>
            </div>
          )}
          {diveCount > 0 && (
            <p className="text-xs text-slate-500">
              {diveCount} dive{diveCount === 1 ? '' : 's'} downloaded so far
            </p>
          )}
        </div>
      )}
      {progress.length > 0 && (
        <ul className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          {progress.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      <details className="rounded-2xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-500">Log</summary>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">{log.join('\n')}</pre>
      </details>
    </div>
  );
}
