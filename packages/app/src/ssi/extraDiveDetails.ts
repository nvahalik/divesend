// SSI dive-log fields the dive computer never reports (tank volume/type, dive type, entry,
// water body, current, weather, site). Populated either from local last-used defaults
// (extraDiveDetailsStorage.ts) or copied from another dive already in the account
// (copyFromDiveSupport.ts), and merged into a sync's write payload as overrides.

export interface ExtraDiveDetails {
  tankVolumeL?: number;
  tankTypeID?: number;
  diveTypeID?: number;
  entryID?: number;
  waterBodyID?: number;
  currentID?: number;
  weatherID?: number;
  siteID?: number;
  /** Display-only (e.g. site select label). Never sent to SSI. */
  siteName?: string;
}

const LITER_TO_CUBIC_FEET = 0.0353147;

/**
 * Converts the populated fields into SSI write-payload overrides. An undefined field is
 * simply omitted -- the write-payload builder already defaults every omitted key to null,
 * so there's no need to send an explicit null for a field the user left blank or
 * deliberately cleared (e.g. picking "None" for site).
 */
export function toOverrides(details: ExtraDiveDetails): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  if (details.tankVolumeL !== undefined) {
    overrides.odin_user_log_tank_vol_l = details.tankVolumeL;
    const cuft = Math.round(details.tankVolumeL * LITER_TO_CUBIC_FEET * 10) / 10;
    overrides.odin_user_log_tank_vol_cuft = cuft;
  }
  if (details.tankTypeID !== undefined) overrides.odin_user_log_var_tanktype_id = details.tankTypeID;
  if (details.diveTypeID !== undefined) overrides.odin_user_log_var_divetype_id = details.diveTypeID;
  if (details.entryID !== undefined) overrides.odin_user_log_var_entry_id = details.entryID;
  if (details.waterBodyID !== undefined) overrides.odin_user_log_var_water_body_id = details.waterBodyID;
  if (details.currentID !== undefined) overrides.odin_user_log_var_current_id = details.currentID;
  if (details.weatherID !== undefined) overrides.odin_user_log_var_weather_id = details.weatherID;
  if (details.siteID !== undefined) overrides.odin_user_log_dive_sites_id = details.siteID;
  return overrides;
}
