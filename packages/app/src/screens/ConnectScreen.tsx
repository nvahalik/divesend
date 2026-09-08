// app/src/screens/ConnectScreen.tsx
import { useEffect, useState } from 'react';
import { useDownloadSession, startDownload } from '../engine/downloadSession';
import { listDeviceSyncHistory, type DeviceSyncRecord } from '../engine/deviceSyncHistory';
import { isWebBluetoothSupported } from '../lib/webBluetooth';
import { BluetoothUnsupportedNotice } from '../components/BluetoothUnsupportedNotice';
import {
  getDiagOptIn,
  setDiagOptIn,
  getLastAttemptOutcome,
  sendLastConnectEvent,
  currentAttemptMeta,
  getDiagLog,
} from '../engine/diagnostics';
import { copyDiagnostics, downloadDiagnostics } from './connectDiagnostics';

function DeviceHistoryList({ records }: { records: DeviceSyncRecord[] }) {
  if (records.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Synced devices</p>
      <ul className="flex flex-col divide-y divide-slate-100">
        {records.map((r) => (
          <li key={r.deviceId} className="flex items-center justify-between gap-4 py-2 text-sm">
            <div>
              <p className="font-medium text-slate-800">{r.name}</p>
              {(r.vendor || r.product) && (
                <p className="text-xs text-slate-500">{[r.vendor, r.product].filter(Boolean).join(' ')}</p>
              )}
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>{new Date(r.lastSyncedAt).toLocaleString()}</p>
              <p>
                {r.lastSyncDiveCount} dive{r.lastSyncDiveCount === 1 ? '' : 's'} last sync
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Diagnostic code of the attempt whose opt-in card the user dismissed with
 *  "Not now". Module-scope so it outlives this Route's unmount -- same reason
 *  downloadSession's store lives at module scope. */
let dismissedAttemptCode: string | null = null;

export function ConnectScreen() {
  const session = useDownloadSession();
  const [history, setHistory] = useState<DeviceSyncRecord[]>(() => listDeviceSyncHistory());
  const [optIn, setOptIn] = useState(getDiagOptIn());
  const [lastOutcome, setLastOutcome] = useState(getLastAttemptOutcome());
  const [copied, setCopied] = useState(false);
  // The diagnostic code the user shared, so the confirmation (which replaces
  // the card once optIn flips to 'granted') can quote it to support.
  const [sharedCode, setSharedCode] = useState<string | null>(null);

  // The download keeps running (and this store keeps updating) even if this
  // screen isn't mounted -- refresh the history list whenever a run finishes
  // while we ARE mounted, so returning here shows the latest sync without
  // needing a manual reload.
  useEffect(() => {
    if (!session.connecting) setHistory(listDeviceSyncHistory());
  }, [session.connecting]);

  useEffect(() => {
    if (!session.connecting) {
      setOptIn(getDiagOptIn());
      setLastOutcome(getLastAttemptOutcome());
    }
  }, [session.connecting]);

  const bluetoothSupported = isWebBluetoothSupported();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Device</h1>
      {!bluetoothSupported && <BluetoothUnsupportedNotice />}
      <button
        onClick={() => void startDownload()}
        disabled={session.connecting || !bluetoothSupported}
        className="flex w-fit items-center gap-2 rounded-lg bg-slate-900 px-6 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {session.connecting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
        {session.connecting ? 'Connecting…' : 'Connect'}
      </button>
      {session.connecting && (
        <p className="text-xs text-slate-500">
          You can switch to another screen -- the download keeps going and finishes in the background.
        </p>
      )}
      {session.connecting && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <p className="font-medium text-slate-700">{session.stage ?? 'Starting…'}</p>
          {session.transfer && session.transfer.maximum > 0 && (
            <div className="flex flex-col gap-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-cyan-500 transition-[width]"
                  style={{ width: `${Math.min(100, (session.transfer.current / session.transfer.maximum) * 100)}%` }}
                />
              </div>
              {/* current/maximum are the device backend's own units (usually bytes
                  through the raw dump, not a dive count) -- see setProgressCallback's
                  doc comment for why this can't say "dive N of M". */}
              <p className="text-xs text-slate-500">
                {Math.min(100, Math.round((session.transfer.current / session.transfer.maximum) * 100))}% transferred
              </p>
            </div>
          )}
          {session.diveCount > 0 && (
            <p className="text-xs text-slate-500">
              {session.diveCount} dive{session.diveCount === 1 ? '' : 's'} downloaded so far
            </p>
          )}
        </div>
      )}
      {session.progress.length > 0 && (
        <ul className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          {session.progress.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {!session.connecting && sharedCode && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Diagnostic report sent. Quote this code to support:{' '}
          <span className="font-mono font-semibold">{sharedCode}</span>
        </div>
      )}
      {!session.connecting &&
        lastOutcome === 'error' &&
        optIn === 'unset' &&
        dismissedAttemptCode !== currentAttemptMeta().code && (
          <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
            <p className="font-medium text-amber-900">Something went wrong connecting.</p>
            <p className="text-amber-800">
              Share an anonymous diagnostic report to help us fix it? It includes your browser, the
              dive-computer model, and the connection log — <span className="font-medium">no dive data</span>.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setDiagOptIn('granted');
                  sendLastConnectEvent();
                  setOptIn('granted');
                  setSharedCode(currentAttemptMeta().code);
                }}
                className="rounded-lg bg-amber-900 px-4 py-2 font-semibold text-white hover:bg-amber-800"
              >
                Share report
              </button>
              <button
                onClick={() => {
                  dismissedAttemptCode = currentAttemptMeta().code;
                  setLastOutcome(null);
                }}
                className="rounded-lg border border-amber-300 px-4 py-2 font-medium text-amber-900 hover:bg-amber-100"
              >
                Not now
              </button>
              <button
                onClick={() => {
                  setDiagOptIn('denied');
                  setOptIn('denied');
                }}
                className="rounded-lg px-4 py-2 font-medium text-amber-800 underline"
              >
                Don't ask again
              </button>
            </div>
          </div>
        )}
      <details className="rounded-2xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-500">Log</summary>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">{session.log.join('\n')}</pre>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => void copyDiagnostics().then(setCopied)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
          >
            {copied ? 'Copied' : 'Copy diagnostics'}
          </button>
          <button
            onClick={downloadDiagnostics}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
          >
            Download diagnostics
          </button>
          {getDiagLog().length > 0 && (
            <p className="self-center text-xs text-slate-500">
              Diagnostic code: <span className="font-mono">{currentAttemptMeta().code}</span>
            </p>
          )}
        </div>
      </details>
      <DeviceHistoryList records={history} />
    </div>
  );
}
