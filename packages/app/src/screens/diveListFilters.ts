// app/src/screens/diveListFilters.ts
import type { StoredDive } from '../db/Dive';

export type DiveTypeFilter = 'all' | 'scuba' | 'freedive';
export type WaterTypeFilter = 'all' | 'fresh' | 'salt' | 'other';
export type SyncStatusFilter = 'all' | 'synced' | 'unsynced';

export interface DiveListFilters {
  diveType: DiveTypeFilter;
  waterType: WaterTypeFilter;
  syncStatus: SyncStatusFilter;
  showHidden: boolean;
}

export const DEFAULT_DIVE_LIST_FILTERS: DiveListFilters = {
  diveType: 'all',
  waterType: 'all',
  syncStatus: 'all',
  showHidden: false,
};

function matchesDiveType(dive: StoredDive, filter: DiveTypeFilter): boolean {
  if (filter === 'all') return true;
  const isFreedive = dive.canonicalDive.header.diveMode === 'freedive';
  return filter === 'freedive' ? isFreedive : !isFreedive;
}

function matchesWaterType(dive: StoredDive, filter: WaterTypeFilter): boolean {
  if (filter === 'all') return true;
  const salinity = dive.canonicalDive.header.salinity;
  if (filter === 'other') return salinity !== 'salt' && salinity !== 'fresh';
  return salinity === filter;
}

function matchesSyncStatus(dive: StoredDive, filter: SyncStatusFilter): boolean {
  if (filter === 'all') return true;
  // 'doNotSync' is bucketed with 'synced' here, not with 'unsynced': the user has
  // explicitly opted this dive out of syncing, so it isn't awaiting action the way
  // a genuinely-unsynced dive is -- it just isn't "pending" from their point of view.
  const isUnsynced = dive.syncState === 'notSynced';
  return filter === 'unsynced' ? isUnsynced : !isUnsynced;
}

/** Pure filtering predicate for the dive list screen, split out so it's unit-testable without rendering React. */
export function filterDives(dives: StoredDive[], filters: DiveListFilters): StoredDive[] {
  return dives.filter((dive) => {
    if (!filters.showHidden && dive.hidden) return false;
    if (!matchesDiveType(dive, filters.diveType)) return false;
    if (!matchesWaterType(dive, filters.waterType)) return false;
    if (!matchesSyncStatus(dive, filters.syncStatus)) return false;
    return true;
  });
}
