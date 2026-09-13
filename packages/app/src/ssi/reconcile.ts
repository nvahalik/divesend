// Pure logic for "connecting" local dives to dives that already exist in the
// user's SSI divelog, matched purely by timestamp (minute precision). A local
// dive that SSI already has should show as synced and carry its SSI ids --
// without this, "Sync" would upload it again as a duplicate. Ported from the
// iOS app's reconcile step. No UI or DB dependency, so it's unit-testable in
// isolation like copyFromDiveSupport.ts.

import { ssiDiveDateTimeKey } from '@divesend/core';
import type { StoredDive } from '../db/Dive';

export interface SSILink {
  ssiDiveID: number;
  ssiDiveNumber: number;
}

/**
 * Maps `"YYYY-MM-DD HH:MM"` (SSI's `odin_user_log_datetime`) -> that dive's
 * SSI ids, for every divelog record that has both an id and a dive number.
 * If SSI somehow returns two records for the same minute, the first wins --
 * later ones are ignored rather than silently overwriting.
 */
export function indexDivelogByDateTime(divelog: Record<string, unknown>[]): Map<string, SSILink> {
  const index = new Map<string, SSILink>();
  for (const record of divelog) {
    const datetime = record.odin_user_log_datetime;
    const ssiDiveID = record.odin_user_log_id;
    const ssiDiveNumber = record.odin_user_log_nr;
    if (
      typeof datetime !== 'string' ||
      typeof ssiDiveID !== 'number' ||
      typeof ssiDiveNumber !== 'number' ||
      index.has(datetime)
    ) {
      continue;
    }
    index.set(datetime, { ssiDiveID, ssiDiveNumber });
  }
  return index;
}

/**
 * Returns the subset of `dives` that match an SSI divelog record by timestamp
 * and aren't already linked -- each as a NEW object with `syncState: 'synced'`
 * and the SSI ids filled in. Callers persist these. Dives the user explicitly
 * marked `doNotSync` are left alone; already-`synced` dives are skipped (their
 * link came from a real upload and shouldn't be second-guessed by a timestamp).
 */
export function reconcileDives(
  dives: StoredDive[],
  divelog: Record<string, unknown>[]
): StoredDive[] {
  const index = indexDivelogByDateTime(divelog);
  const linked: StoredDive[] = [];
  for (const dive of dives) {
    if (dive.syncState !== 'notSynced') continue;
    const link = index.get(
      ssiDiveDateTimeKey(dive.canonicalDive.header.startTime, dive.canonicalDive.header.utcOffsetMinutes)
    );
    if (!link) continue;
    linked.push({
      ...dive,
      syncState: 'synced',
      ssiDiveID: link.ssiDiveID,
      ssiDiveNumber: link.ssiDiveNumber,
    });
  }
  return linked;
}

/**
 * Returns the subset of `dives` that are `synced` locally but whose `ssiDiveID`
 * no longer appears anywhere in `divelog` -- each as a NEW object reset to
 * `notSynced` with its SSI ids cleared, so it becomes eligible for `syncDive`/
 * `syncAllDives` again. Covers a dive deleted directly on SSI: DiveSend has no
 * other way to notice, since a `synced` dive is otherwise never re-checked.
 *
 * Skipped entirely when `divelog` is empty -- SSI returning nothing is far more
 * likely a transient fetch/auth glitch than every synced dive having been
 * deleted, and treating the former as the latter would unlink everything.
 */
export function unlinkDeletedDives(dives: StoredDive[], divelog: Record<string, unknown>[]): StoredDive[] {
  if (divelog.length === 0) return [];
  const stillPresent = new Set(
    divelog.map((record) => record.odin_user_log_id).filter((id): id is number => typeof id === 'number')
  );
  const unlinked: StoredDive[] = [];
  for (const dive of dives) {
    if (dive.syncState !== 'synced' || dive.ssiDiveID == null) continue;
    if (stillPresent.has(dive.ssiDiveID)) continue;
    unlinked.push({
      ...dive,
      syncState: 'notSynced',
      ssiDiveID: null,
      ssiDiveNumber: null,
    });
  }
  return unlinked;
}
