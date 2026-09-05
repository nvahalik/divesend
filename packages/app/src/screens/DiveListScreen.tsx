// app/src/screens/DiveListScreen.tsx
import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { getAllDives, setDiveHidden } from '../db/db';
import type { StoredDive } from '../db/Dive';
import { filterDives, DEFAULT_DIVE_LIST_FILTERS } from './diveListFilters';
import type { DiveListFilters, DiveTypeFilter, WaterTypeFilter, SyncStatusFilter } from './diveListFilters';
import { DiveProfileSparkline } from '../components/DiveProfileSparkline';
import { SsiSyncedBadge } from '../components/SsiSyncedBadge';
import { METERS_TO_FEET, formatDuration } from '@divesend/core';
import { syncDive, syncAllDives, reconcileWithSSI } from '../ssi/diveSyncEngine';
import type { ExtraDiveDetails } from '../ssi/extraDiveDetails';
import { ExtraDiveDetailsModal } from '../components/ExtraDiveDetailsModal';
import { importDiveFiles, type ImportResult } from '../import/importDiveFiles';
import { clearGuestSsiSession, getGuestSsiSession } from '../ssi/guestSsiSession';
import { SSIHttpError } from '../ssi/ssiClient';

interface Props {
  refreshKey: number;
  onSelectDive: (id: string) => void;
  ssiReady: boolean;
}

type PendingSync = { kind: 'single'; dive: StoredDive } | { kind: 'batch'; dives: StoredDive[] };

function summarizeImport(result: ImportResult): string {
  const successes = result.fileResults.filter((r) => r.status === 'ok');
  const failures = result.fileResults.filter((r) => r.status === 'error');
  const parts: string[] = [];
  parts.push(
    `Added ${result.addedDiveCount} dive${result.addedDiveCount === 1 ? '' : 's'} from ${successes.length} file${successes.length === 1 ? '' : 's'}.`
  );
  if (failures.length > 0) {
    const detail = failures
      .map((f) => `${f.fileName} (${(f.message ?? 'unknown error').slice(0, 80)})`)
      .join(', ');
    parts.push(`${failures.length} file${failures.length === 1 ? '' : 's'} skipped: ${detail}`);
  }
  return parts.join(' ');
}

export function DiveListScreen({ refreshKey, onSelectDive, ssiReady }: Props) {
  const [dives, setDives] = useState<StoredDive[] | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingSync, setPendingSync] = useState<PendingSync | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [filters, setFilters] = useState<DiveListFilters>(DEFAULT_DIVE_LIST_FILTERS);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Whenever SSI is connected, quietly link any local dives that already exist
  // in the user's SSI divelog (matched by timestamp) so they show as synced
  // and don't get re-uploaded. Fire-and-forget: a divelog fetch failure here
  // must never block the dive list from rendering.
  useEffect(() => {
    if (!ssiReady) return;
    let cancelled = false;
    reconcileWithSSI()
      .then((linked) => {
        if (!cancelled && linked.length > 0) refresh();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ssiReady]);

  const toggleHidden = async (dive: StoredDive) => {
    await setDiveHidden(dive.id, !dive.hidden);
    refresh();
  };

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

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setStatusMessage(`Importing ${files.length} file${files.length === 1 ? '' : 's'}…`);
    try {
      const result = await importDiveFiles(files);
      setStatusMessage(summarizeImport(result));
    } catch (err) {
      setStatusMessage(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    refresh();
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    void handleFiles(e.dataTransfer.files);
  };

  if (dives === null) {
    return <p className="text-center text-slate-500">Loading…</p>;
  }

  const selectedNotSyncedCount = dives.filter((d) => selectedIds.has(d.id) && d.syncState === 'notSynced').length;
  const visibleDives = filterDives(dives, filters);

  return (
    <div className="flex flex-col gap-4" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        // Format is detected from file content, not extension, so this accept
        // list is a hint, not a filter -- kept loose because iOS Safari's file
        // picker can grey out (or hide entirely) extensions it doesn't
        // recognize, like .fit/.uddf, if the list is too strict.
        accept=".fit,.xml,.uddf,application/octet-stream,*/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {dragActive && (
        <div className="rounded-2xl border-2 border-dashed border-cyan-500 bg-cyan-50 p-6 text-center text-sm font-medium text-cyan-700">
          Drop dive files to import
        </div>
      )}

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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Import files
          </button>
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
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500">Type</span>
          <select
            value={filters.diveType}
            onChange={(e) => setFilters((f) => ({ ...f, diveType: e.target.value as DiveTypeFilter }))}
            className="rounded-lg border border-slate-300 px-2 py-1"
          >
            <option value="all">All</option>
            <option value="scuba">Scuba</option>
            <option value="freedive">Freedive</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500">Water</span>
          <select
            value={filters.waterType}
            onChange={(e) => setFilters((f) => ({ ...f, waterType: e.target.value as WaterTypeFilter }))}
            className="rounded-lg border border-slate-300 px-2 py-1"
          >
            <option value="all">All</option>
            <option value="fresh">Fresh</option>
            <option value="salt">Salt</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500">Sync</span>
          <select
            value={filters.syncStatus}
            onChange={(e) => setFilters((f) => ({ ...f, syncStatus: e.target.value as SyncStatusFilter }))}
            className="rounded-lg border border-slate-300 px-2 py-1"
          >
            <option value="all">All</option>
            <option value="synced">Synced</option>
            <option value="unsynced">Unsynced</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={filters.showHidden}
            onChange={(e) => setFilters((f) => ({ ...f, showHidden: e.target.checked }))}
            className="h-4 w-4"
          />
          <span className="text-slate-500">Show hidden</span>
        </label>
      </div>

      {statusMessage && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{statusMessage}</p>
      )}

      {dives.length === 0 ? (
        <p className="text-center text-slate-500">
          No dives yet. Connect your dive computer, or drop / import dive files, to get started.
        </p>
      ) : visibleDives.length === 0 ? (
        <p className="text-center text-slate-500">No dives match the current filters.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visibleDives.map((dive) => (
            <li
              key={dive.id}
              onClick={() => (selectionMode ? toggleSelected(dive.id) : onSelectDive(dive.id))}
              className={`flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300 ${dive.hidden ? 'opacity-60' : ''}`}
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
                {dive.syncState === 'synced' && dive.ssiDiveNumber != null && (
                  <div className="mt-1">
                    <SsiSyncedBadge diveNumber={dive.ssiDiveNumber} />
                  </div>
                )}
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
              {!selectionMode && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleHidden(dive);
                  }}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
                >
                  {dive.hidden ? 'Unhide' : 'Hide'}
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
