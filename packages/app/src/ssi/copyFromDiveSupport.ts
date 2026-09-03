// Pure logic backing the extra-dive-details modal's "Copy From..." feature: turns a raw
// SSI getDivelog/getDiveSites response into picker-ready summaries and extracted
// ExtraDiveDetails. No UI dependency, so it's independently unit-testable. Ports
// SSICopyFromDiveSupport.swift.

import type { ExtraDiveDetails } from './extraDiveDetails';

export interface DiveSummary {
  /** `odin_user_log_nr` -- the account's human-facing dive number. */
  id: number;
  /** `odin_user_log_datetime` as SSI returns it, or a `"Dive #<nr>"` fallback when absent. */
  date: string;
  record: Record<string, unknown>;
}

function asNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function asString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/** Picker entries for every dive in `divelog` that has a dive number, newest first. */
export function summaries(divelog: Record<string, unknown>[]): DiveSummary[] {
  return divelog
    .map((record): DiveSummary | undefined => {
      const nr = asNumber(record, 'odin_user_log_nr');
      if (nr === undefined) return undefined;
      const date = asString(record, 'odin_user_log_datetime') ?? `Dive #${nr}`;
      return { id: nr, date, record };
    })
    .filter((s): s is DiveSummary => s !== undefined)
    .sort((a, b) => b.id - a.id);
}

/**
 * Extracts an ExtraDiveDetails from a raw SSI dive record -- used both to seed defaults
 * from the account's most recent dive and to populate from a user-picked "Copy From..."
 * source. Any field absent from `record` is left undefined.
 */
export function extraDetails(record: Record<string, unknown>, siteNamesByID: Record<number, string>): ExtraDiveDetails {
  const siteID = asNumber(record, 'odin_user_log_dive_sites_id');
  const details: ExtraDiveDetails = {
    tankVolumeL: asNumber(record, 'odin_user_log_tank_vol_l'),
    tankTypeID: asNumber(record, 'odin_user_log_var_tanktype_id'),
    diveTypeID: asNumber(record, 'odin_user_log_var_divetype_id'),
    entryID: asNumber(record, 'odin_user_log_var_entry_id'),
    waterBodyID: asNumber(record, 'odin_user_log_var_water_body_id'),
    currentID: asNumber(record, 'odin_user_log_var_current_id'),
    weatherID: asNumber(record, 'odin_user_log_var_weather_id'),
    siteID,
    siteName: siteID !== undefined ? siteNamesByID[siteID] : undefined,
  };
  // Drop undefined keys so object-equality assertions (e.g. toEqual({})) work in tests,
  // matching how an omitted Swift struct field behaves under Equatable.
  return Object.fromEntries(Object.entries(details).filter(([, v]) => v !== undefined)) as ExtraDiveDetails;
}

/** Builds an id->name lookup from getDiveSites's logbook_sites[] records. */
export function siteNames(logbookSites: Record<string, unknown>[]): Record<number, string> {
  const result: Record<number, string> = {};
  for (const record of logbookSites) {
    const id = asNumber(record, 'odin_dive_sites_id');
    const name = asString(record, 'odin_dive_sites_name');
    if (id !== undefined && name !== undefined) {
      result[id] = name;
    }
  }
  return result;
}

/**
 * The account's most-recent dive by `odin_user_log_nr` -- the same "most recent"
 * definition the sync engine uses (highest dive number, not most recent date).
 */
export function mostRecentDive(divelog: Record<string, unknown>[]): Record<string, unknown> | undefined {
  if (divelog.length === 0) return undefined;
  return divelog.reduce((best, current) => {
    const bestNr = asNumber(best, 'odin_user_log_nr') ?? -Infinity;
    const currentNr = asNumber(current, 'odin_user_log_nr') ?? -Infinity;
    return currentNr >= bestNr ? current : best;
  });
}
