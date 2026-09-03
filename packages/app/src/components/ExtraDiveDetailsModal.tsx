// app/src/components/ExtraDiveDetailsModal.tsx
//
// Modal shown before syncing a dive to SSI, letting the user fill in the fields the dive
// computer never reports (tank volume/type, dive type, entry, water body, current, weather,
// site). Seeds from the last-used local defaults, or -- if none exist yet -- from the
// account's most recent SSI dive. Also offers a "Copy from..." picker over the account's
// other logged dives. Ports the iOS app's SSIExtraDiveDetailsSheet.

import { useEffect, useState } from 'react';
import { getDivelog, getDiveSites } from '../ssi/ssiClient';
import { sortedOptions, type EnumCategory } from '@divesend/core';
import type { ExtraDiveDetails } from '../ssi/extraDiveDetails';
import { loadLastUsed, saveLastUsed } from '../ssi/extraDiveDetailsStorage';
import { summaries, extraDetails, siteNames, mostRecentDive, type DiveSummary } from '../ssi/copyFromDiveSupport';

interface Props {
  onSkip: () => void;
  onSync: (details: ExtraDiveDetails) => void;
  onClose: () => void;
}

const SELECT_CLASS =
  'w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500';

const INPUT_CLASS = SELECT_CLASS;

const ENUM_FIELDS: { category: EnumCategory; key: keyof ExtraDiveDetails; label: string }[] = [
  { category: 'tankType', key: 'tankTypeID', label: 'Tank Type' },
  { category: 'diveType', key: 'diveTypeID', label: 'Dive Type' },
  { category: 'entry', key: 'entryID', label: 'Entry' },
  { category: 'waterBody', key: 'waterBodyID', label: 'Water Body' },
  { category: 'current', key: 'currentID', label: 'Current' },
  { category: 'weather', key: 'weatherID', label: 'Weather' },
];

export function ExtraDiveDetailsModal({ onSkip, onSync, onClose }: Props) {
  const [details, setDetails] = useState<ExtraDiveDetails>({});
  const [divelog, setDivelog] = useState<Record<string, unknown>[]>([]);
  const [sites, setSites] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyFromID, setCopyFromID] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    const lastUsed = loadLastUsed();
    if (lastUsed !== undefined) {
      setDetails(lastUsed);
    }

    (async () => {
      try {
        const [fetchedDivelog, fetchedSites] = await Promise.all([getDivelog(), getDiveSites()]);
        if (cancelled) return;
        setDivelog(fetchedDivelog);
        setSites(fetchedSites);
        if (lastUsed === undefined) {
          const recent = mostRecentDive(fetchedDivelog);
          if (recent !== undefined) {
            setDetails(extraDetails(recent, siteNames(fetchedSites)));
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const diveSummaries: DiveSummary[] = summaries(divelog);
  const siteNamesByID = siteNames(sites);

  const handleCopyFrom = (id: string) => {
    setCopyFromID(id);
    if (id === '') return;
    const source = diveSummaries.find((s) => String(s.id) === id);
    if (source === undefined) return;
    setDetails(extraDetails(source.record, siteNamesByID));
  };

  const handleSync = () => {
    saveLastUsed(details);
    onSync(details);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Dive Details</h2>
        <p className="text-sm text-slate-500">
          Fill in the details SSI needs that your dive computer doesn't record.
        </p>

        {loading && <p className="text-sm text-slate-500">Loading dive history…</p>}
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Couldn't load dive history: {error}
          </p>
        )}

        {diveSummaries.length > 0 && (
          <div className="flex flex-col gap-1">
            <label htmlFor="copy-from" className="text-sm font-medium">
              Copy from…
            </label>
            <select
              id="copy-from"
              value={copyFromID}
              onChange={(e) => handleCopyFrom(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Select a previous dive</option>
              {diveSummaries.map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.id} &middot; {s.date}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="tank-volume" className="text-sm font-medium">
            Tank Volume (L)
          </label>
          <input
            id="tank-volume"
            type="number"
            min={0}
            step="0.1"
            value={details.tankVolumeL ?? ''}
            onChange={(e) =>
              setDetails((d) => ({
                ...d,
                tankVolumeL: e.target.value === '' ? undefined : Number(e.target.value),
              }))
            }
            className={INPUT_CLASS}
          />
        </div>

        {ENUM_FIELDS.map(({ category, key, label }) => (
          <div key={category} className="flex flex-col gap-1">
            <label htmlFor={`field-${category}`} className="text-sm font-medium">
              {label}
            </label>
            <select
              id={`field-${category}`}
              value={(details[key] as number | undefined) ?? ''}
              onChange={(e) =>
                setDetails((d) => ({
                  ...d,
                  [key]: e.target.value === '' ? undefined : Number(e.target.value),
                }))
              }
              className={SELECT_CLASS}
            >
              <option value="">Unset</option>
              {sortedOptions(category).map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ))}

        <div className="flex flex-col gap-1">
          <label htmlFor="site" className="text-sm font-medium">
            Site
          </label>
          <select
            id="site"
            value={details.siteID ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              setDetails((d) => ({
                ...d,
                siteID: value === '' ? undefined : Number(value),
                siteName: value === '' ? undefined : siteNamesByID[Number(value)],
              }));
            }}
            className={SELECT_CLASS}
          >
            <option value="">None</option>
            {Object.entries(siteNamesByID).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-2 flex justify-end gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg border border-slate-300 px-6 py-3 font-semibold text-slate-700 hover:bg-slate-50"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleSync}
            className="rounded-lg bg-slate-900 px-6 py-3 font-semibold text-white hover:bg-slate-800"
          >
            Sync
          </button>
        </div>
      </div>
    </div>
  );
}
