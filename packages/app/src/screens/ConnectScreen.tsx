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
  setDiveCallbacks,
} from '../engine/webble';
import { toStoredDive } from '../db/Dive';
import { putDive } from '../db/db';
import { readLocalStorage, writeLocalStorage } from '../lib/storage';
import type { CanonicalDive } from '@divesend/core';

interface Props {
  onDivesImported: () => void;
}

export function ConnectScreen({ onDivesImported }: Props) {
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);

  const appendLog = useCallback((msg: string) => setLog((l) => [...l, msg]), []);

  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      appendLog('Web Bluetooth is not available in this browser.');
      return;
    }

    setConnecting(true);
    setProgress([]);
    let importedCount = 0;

    try {
      await waitForEngineReady();
      // Tears down any prior C-side session before opening a new one --
      // see webble/main.js's connect() and webble/NOTES.md Round 4 for why
      // this must happen unconditionally, every time.
      await closeSession();

      const device = await navigator.bluetooth.requestDevice({
        filters: VENDOR_BLE_PROFILES.map((p) => ({ services: [p.service] })),
      });
      appendLog('Selected device: ' + device.name);

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
          appendLog('GATT error while identifying the device: ' + String(e));
          return;
        }
      }
      if (!matched) {
        appendLog('Connected, but none of the known vendor services were found on this device.');
        return;
      }
      appendLog('Resolved vendor: ' + matched.profile.vendor);

      const rx = await matched.service.getCharacteristic(matched.profile.rx);
      const tx = await matched.service.getCharacteristic(matched.profile.tx);
      await installTransport(rx, tx);
      appendLog('Connected and subscribed to notifications.');

      const openStatus = await openTransport();
      if (openStatus !== 0) {
        appendLog('webble_open failed with status ' + openStatus);
        return;
      }

      const openDeviceStatus = await openDevice(device.name ?? '');
      if (openDeviceStatus !== 0) {
        appendLog('webble_open_device failed with status ' + openDeviceStatus + ' (unrecognized device name?)');
        return;
      }

      appendLog('Device session opened: ' + getDeviceVendor() + ' ' + getDeviceProduct());

      setDiveCallbacks(
        async (dive: CanonicalDive) => {
          // Serial is populated as a side effect of dc_device_foreach's
          // DEVINFO event, which fires before any dive callback in the
          // same walk -- so it's already valid here, not just after the
          // whole download completes.
          const serial = getDeviceSerialHex() || null;
          try {
            await putDive(toStoredDive(dive, device.id, serial));
            importedCount += 1;
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

      const fingerprintKey = 'webble-fingerprint-' + device.id;
      const storedFingerprint = readLocalStorage(fingerprintKey) ?? '';

      const downloadResult = await downloadNewDives(storedFingerprint);
      if (downloadResult < 0) {
        appendLog('webble_download_new_dives failed with status ' + downloadResult);
        return;
      }
      appendLog(downloadResult === 0 ? 'Up to date -- no new dives.' : 'Downloaded ' + downloadResult + ' new dive(s).');

      if (downloadResult > 0) {
        const latestFingerprint = getLatestFingerprintHex();
        if (latestFingerprint) {
          if (!writeLocalStorage(fingerprintKey, latestFingerprint)) {
            appendLog("Warning: couldn't save the sync fingerprint -- next connect will redownload every dive.");
          }
        }
      }
    } catch (e) {
      appendLog('Error: ' + String(e));
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
  }, [appendLog, onDivesImported]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Connect</h1>
      <button
        onClick={() => void connect()}
        disabled={connecting}
        className="flex w-fit items-center gap-2 rounded-lg bg-slate-900 px-6 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {connecting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
        {connecting ? 'Connecting…' : 'Connect'}
      </button>
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
