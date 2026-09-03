// Ports DiveSyncEngine.swift's sync/syncAll/performSync (reconcile/backfillDiveNumbers are
// out of scope for this port -- see the design spec's non-goals).

import { putDive } from '../db/db';
import type { StoredDive } from '../db/Dive';
import type { ExtraDiveDetails } from './extraDiveDetails';
import { toOverrides } from './extraDiveDetails';
import { buildCreatePayload, transformDive } from '@divesend/core';
import { getDivelog, saveDivelog } from './ssiClient';

export class DiveSyncError extends Error {}

function mostRecentDive(divelog: Record<string, unknown>[]): Record<string, unknown> {
  return divelog.reduce<Record<string, unknown>>((best, current) => {
    const nr = (record: Record<string, unknown>) => (typeof record.odin_user_log_nr === 'number' ? record.odin_user_log_nr : -Infinity);
    return nr(current) >= nr(best) ? current : best;
  }, {});
}

function nextDiveNumber(divelog: Record<string, unknown>[]): number {
  const max = divelog.reduce((m, record) => {
    const nr = record.odin_user_log_nr;
    return typeof nr === 'number' && nr > m ? nr : m;
  }, 0);
  return max + 1;
}

async function performSync(
  dive: StoredDive,
  accountRecord: Record<string, unknown>,
  diveNr: number,
  extraDetails: ExtraDiveDetails | undefined
): Promise<number> {
  const overrides = transformDive(dive.canonicalDive, dive.deviceSerialNumber ?? undefined);
  if (extraDetails) {
    Object.assign(overrides, toOverrides(extraDetails));
  }
  const payload = buildCreatePayload(accountRecord, overrides, diveNr);

  const response = await saveDivelog(payload);
  const success = response.success as Record<string, unknown> | undefined;
  const ssiDiveID = success?.odin_user_log_id;
  if (typeof ssiDiveID !== 'number') {
    throw new DiveSyncError('SSI response did not include odin_user_log_id');
  }

  dive.ssiDiveID = ssiDiveID;
  dive.ssiDiveNumber = diveNr;
  dive.syncState = 'synced';
  await putDive(dive);
  return ssiDiveID;
}

/** Syncs a single dive, fetching the account's current divelog to compute its dive number. */
export async function syncDive(dive: StoredDive, extraDetails?: ExtraDiveDetails): Promise<number> {
  const divelog = await getDivelog();
  return performSync(dive, mostRecentDive(divelog), nextDiveNumber(divelog), extraDetails);
}

/**
 * Syncs every `notSynced` dive in `dives` (skipping `synced`/`doNotSync`). A failure on one
 * dive doesn't stop the others -- each is attempted independently and every failure is
 * collected and returned. The account's divelog is fetched once for the whole batch, and
 * the dive number is incremented locally after each successful create. `extraDetails`, when
 * present, applies identically to every dive in the batch. Callers are responsible for
 * sorting `dives` chronologically (oldest first) before calling this -- it assigns numbers
 * sequentially in whatever order it's given, matching DiveSyncEngine.swift's division of
 * responsibility (the caller sorts, the engine just assigns).
 */
export async function syncAllDives(
  dives: StoredDive[],
  extraDetails?: ExtraDiveDetails
): Promise<{ dive: StoredDive; error: Error }[]> {
  const toSync = dives.filter((d) => d.syncState === 'notSynced');
  if (toSync.length === 0) return [];

  const divelog = await getDivelog();
  const accountRecord = mostRecentDive(divelog);
  let nextNr = nextDiveNumber(divelog);

  const failures: { dive: StoredDive; error: Error }[] = [];
  for (const dive of toSync) {
    try {
      await performSync(dive, accountRecord, nextNr, extraDetails);
      nextNr += 1;
    } catch (error) {
      failures.push({ dive, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
  return failures;
}
