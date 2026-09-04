// app/src/screens/DiveListScreen.tsx
import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { getAllDives } from '../db/db';
import type { StoredDive } from '../db/Dive';
import { DiveProfileSparkline } from '../components/DiveProfileSparkline';
import { METERS_TO_FEET, formatDuration } from '@divesend/core';
import { syncDive, syncAllDives } from '../ssi/diveSyncEngine';
import type { ExtraDiveDetails } from '../ssi/extraDiveDetails';
import { ExtraDiveDetailsModal } from '../components/ExtraDiveDetailsModal';
import { importDiveFiles, type ImportResult } from '../import/importDiveFiles';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        setStatusMessage(`Failed to sync dive: ${err instanceof Error ? err.message : String(err)}`);
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
        setStatusMessage(`Failed to sync dives: ${err instanceof Error ? err.message : String(err)}`);
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

  return (
    <div className="flex flex-col gap-4" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".fit,.xml,.uddf"
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

      {statusMessage && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{statusMessage}</p>
      )}

      {dives.length === 0 ? (
        <p className="text-center text-slate-500">
          No dives yet. Connect your dive computer, or drop / import dive files, to get started.
        </p>
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
