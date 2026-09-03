// app/src/screens/DiveListScreen.tsx
import { useEffect, useState } from 'react';
import { getAllDives } from '../db/db';
import type { StoredDive } from '../db/Dive';
import { DiveProfileSparkline } from '../components/DiveProfileSparkline';
import { METERS_TO_FEET, formatDuration } from '@divesend/core';
import { syncDive, syncAllDives } from '../ssi/diveSyncEngine';
import type { ExtraDiveDetails } from '../ssi/extraDiveDetails';
import { ExtraDiveDetailsModal } from '../components/ExtraDiveDetailsModal';
import { clearGuestSsiSession, getGuestSsiSession } from '../ssi/guestSsiSession';
import { SSIHttpError } from '../ssi/ssiClient';

interface Props {
  refreshKey: number;
  onSelectDive: (id: string) => void;
  ssiReady: boolean;
}

type PendingSync = { kind: 'single'; dive: StoredDive } | { kind: 'batch'; dives: StoredDive[] };

export function DiveListScreen({ refreshKey, onSelectDive, ssiReady }: Props) {
  const [dives, setDives] = useState<StoredDive[] | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingSync, setPendingSync] = useState<PendingSync | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);

  const describeSyncError = (err: unknown): string => {
    // Only an auth/upstream failure means the guest token is actually dead. A transient
    // network blip must not force the guest through a full SSI re-auth.
    if (getGuestSsiSession() && err instanceof SSIHttpError && (err.status === 401 || err.status === 502)) {
      clearGuestSsiSession();
      return 'Your SSI session expired — reconnect on the Account screen.';
    }
    return err instanceof Error ? err.message : String(err);
  };

  useEffect(() => {
    let cancelled = false;
    getAllDives().then((loaded) => {
      if (!cancelled) setDives(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, localRefreshKey]);

  const refresh = () => setLocalRefreshKey((k) => k + 1);

  const toggleSelectionMode = () => {
    setSelectionMode((mode) => !mode);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const openSingleSync = (dive: StoredDive) => {
    setStatusMessage(null);
    setPendingSync({ kind: 'single', dive });
  };

  const openBatchSync = () => {
    setStatusMessage(null);
    const toSync = (dives ?? [])
      .filter((d) => selectedIds.has(d.id) && d.syncState === 'notSynced')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (toSync.length === 0) {
      setSelectionMode(false);
      setSelectedIds(new Set());
      return;
    }
    setPendingSync({ kind: 'batch', dives: toSync });
  };

  const performSync = async (target: PendingSync, extraDetails?: ExtraDiveDetails) => {
    if (!ssiReady) return;
    setPendingSync(null);

    if (target.kind === 'single') {
      try {
        await syncDive(target.dive, extraDetails);
        setStatusMessage('Dive synced successfully.');
      } catch (err) {
        setStatusMessage(`Failed to sync: ${describeSyncError(err)}`);
      }
    } else {
      try {
        const failures = await syncAllDives(target.dives, extraDetails);
        const successCount = target.dives.length - failures.length;
        if (failures.length === 0) {
          setStatusMessage(`Synced ${successCount} dive${successCount === 1 ? '' : 's'} successfully.`);
        } else {
          setStatusMessage(`Synced ${successCount} of ${target.dives.length} dives -- ${failures.length} failed.`);
        }
      } catch (err) {
        setStatusMessage(`Failed to sync: ${describeSyncError(err)}`);
      }
    }

    setSelectionMode(false);
    setSelectedIds(new Set());
    refresh();
  };

  if (dives === null) {
    return <p className="text-center text-slate-500">Loading…</p>;
  }

  const selectedNotSyncedCount = dives.filter((d) => selectedIds.has(d.id) && d.syncState === 'notSynced').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {selectionMode && (
            <button
              type="button"
              onClick={openBatchSync}
              disabled={!ssiReady || selectedNotSyncedCount === 0}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send Selected ({selectedNotSyncedCount})
            </button>
          )}
        </div>
        {dives.length > 0 && (
          <button
            type="button"
            onClick={toggleSelectionMode}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            {selectionMode ? 'Cancel' : 'Select'}
          </button>
        )}
      </div>

      {statusMessage && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{statusMessage}</p>
      )}

      {dives.length === 0 ? (
        <p className="text-center text-slate-500">No dives yet. Connect your dive computer to download dives.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {dives.map((dive) => (
            <li
              key={dive.id}
              onClick={() => (selectionMode ? toggleSelected(dive.id) : onSelectDive(dive.id))}
              className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300"
            >
              {selectionMode && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(dive.id)}
                  onChange={() => {}}
                  className="h-5 w-5 shrink-0"
                />
              )}
              <div className="flex-1">
                <div className="font-semibold">{new Date(dive.date).toLocaleString()}</div>
                <div className="text-sm text-slate-500">
                  {Math.round(dive.maxDepthM * METERS_TO_FEET)}ft &middot; {formatDuration(dive.canonicalDive.header.divetimeS)}
                </div>
              </div>
              {dive.canonicalDive.samples.length > 1 && <DiveProfileSparkline samples={dive.canonicalDive.samples} />}
              {!selectionMode && dive.syncState === 'notSynced' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openSingleSync(dive);
                  }}
                  disabled={!ssiReady}
                  title={ssiReady ? undefined : 'Log in to your SSI account to sync'}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Send
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {pendingSync && ssiReady && (
        <ExtraDiveDetailsModal
          onSkip={() => void performSync(pendingSync)}
          onSync={(details) => void performSync(pendingSync, details)}
          onClose={() => setPendingSync(null)}
        />
      )}
    </div>
  );
}
