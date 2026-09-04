// app/src/screens/DiveDetailScreen.tsx
import { useEffect, useState } from 'react';
import { getDive } from '../db/db';
import type { StoredDive } from '../db/Dive';
import { DiveProfileChart } from '../components/DiveProfileChart';
import { METERS_TO_FEET, BAR_TO_PSI, celsiusToFahrenheit, formatDuration, computeSacPsiPerMin } from '@divesend/core';

interface Props {
  diveId: string;
  onBack: () => void;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

export function DiveDetailScreen({ diveId, onBack }: Props) {
  const [dive, setDive] = useState<StoredDive | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setDive(undefined);
    getDive(diveId).then((loaded) => {
      if (!cancelled) setDive(loaded ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [diveId]);

  if (dive === undefined) return <p className="text-center text-slate-500">Loading…</p>;
  if (dive === null) return <p className="text-center text-slate-500">Dive not found.</p>;

  const { header, samples } = dive.canonicalDive;
  const avgDepthM = samples.length > 0 ? samples.reduce((sum, s) => sum + s.depthM, 0) / samples.length : 0;
  const tempSamples = samples.map((s) => s.tempC).filter((t): t is number => t != null);
  const ndlSamples = samples.map((s) => s.ndlS).filter((n): n is number => n != null);
  const hadDecoStop = samples.some((s) => (s.decoStopDepthM ?? 0) > 0);
  const sacPsiPerMin = computeSacPsiPerMin(dive.canonicalDive);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <button onClick={onBack} className="text-sm font-medium text-slate-500 hover:text-slate-900">
          &larr; Back
        </button>
        <h1 className="mt-2 text-2xl font-bold">{new Date(dive.date).toLocaleString()}</h1>
      </div>

      <section className="grid grid-cols-3 gap-4 rounded-2xl border border-slate-200 bg-white p-4">
        <Stat label="Max depth" value={`${Math.round(dive.maxDepthM * METERS_TO_FEET)} ft`} />
        <Stat label="Duration" value={formatDuration(header.divetimeS)} />
        <Stat label="Computer" value={dive.computerModel} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Profile</h2>
        <DiveProfileChart samples={samples} />
      </section>

      <details className="rounded-2xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-500">
          Dive computer detail
        </summary>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">Gas</dt>
          <dd>{Math.round(header.gasO2Percent)}% O2</dd>
          {header.tankBeginPressureBar !== null && header.tankEndPressureBar !== null && (
            <>
              <dt className="text-slate-500">Tank pressure</dt>
              <dd>
                {Math.round(header.tankBeginPressureBar * BAR_TO_PSI)} &rarr; {Math.round(header.tankEndPressureBar * BAR_TO_PSI)} psi
              </dd>
            </>
          )}
          {sacPsiPerMin !== null && (
            <>
              <dt className="text-slate-500">SAC rate</dt>
              <dd>{sacPsiPerMin.toFixed(1)} psi/min</dd>
            </>
          )}
          <dt className="text-slate-500">Gradient factors</dt>
          <dd>
            {header.gfLow} / {header.gfHigh}
          </dd>
          <dt className="text-slate-500">Dive mode</dt>
          <dd>{header.diveMode}</dd>
          <dt className="text-slate-500">Deco model</dt>
          <dd>{header.decoModel}</dd>
          <dt className="text-slate-500">Salinity</dt>
          <dd>{header.salinity}</dd>
          <dt className="text-slate-500">Samples</dt>
          <dd>{samples.length}</dd>
          <dt className="text-slate-500">Average depth</dt>
          <dd>{Math.round(avgDepthM * METERS_TO_FEET)} ft</dd>
          {tempSamples.length > 0 && (
            <>
              <dt className="text-slate-500">Water temp</dt>
              <dd>
                {Math.round(celsiusToFahrenheit(Math.min(...tempSamples)))} - {Math.round(celsiusToFahrenheit(Math.max(...tempSamples)))}{' '}
                &deg;F
              </dd>
            </>
          )}
          {ndlSamples.length > 0 && (
            <>
              <dt className="text-slate-500">Min NDL</dt>
              <dd>{Math.round(Math.min(...ndlSamples) / 60)} min</dd>
            </>
          )}
          <dt className="text-slate-500">Deco required</dt>
          <dd>{hadDecoStop ? 'Yes' : 'No'}</dd>
        </dl>
      </details>
    </div>
  );
}
