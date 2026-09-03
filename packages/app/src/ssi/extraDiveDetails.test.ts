import { describe, expect, it } from 'vitest';
import { toOverrides, type ExtraDiveDetails } from './extraDiveDetails';

describe('toOverrides', () => {
  it('omits all keys when everything is undefined', () => {
    expect(toOverrides({})).toEqual({});
  });

  it('includes only the populated fields', () => {
    const details: ExtraDiveDetails = { diveTypeID: 24, entryID: 22 };
    const overrides = toOverrides(details);
    expect(Object.keys(overrides)).toHaveLength(2);
    expect(overrides.odin_user_log_var_divetype_id).toBe(24);
    expect(overrides.odin_user_log_var_entry_id).toBe(22);
  });

  it('maps every field', () => {
    const details: ExtraDiveDetails = {
      tankVolumeL: 11.1,
      tankTypeID: 20,
      diveTypeID: 24,
      entryID: 22,
      waterBodyID: 13,
      currentID: 6,
      weatherID: 1,
      siteID: 22489,
      siteName: 'Some Site',
    };
    const overrides = toOverrides(details);

    expect(overrides.odin_user_log_tank_vol_l).toBe(11.1);
    // 11.1 L * 0.0353147 cuft/L = 0.39199317 -> rounded to 1 decimal place.
    expect(overrides.odin_user_log_tank_vol_cuft).toBe(0.4);
    expect(overrides.odin_user_log_var_tanktype_id).toBe(20);
    expect(overrides.odin_user_log_var_divetype_id).toBe(24);
    expect(overrides.odin_user_log_var_entry_id).toBe(22);
    expect(overrides.odin_user_log_var_water_body_id).toBe(13);
    expect(overrides.odin_user_log_var_current_id).toBe(6);
    expect(overrides.odin_user_log_var_weather_id).toBe(1);
    expect(overrides.odin_user_log_dive_sites_id).toBe(22489);
    // siteName is display-only -- never sent to SSI.
    expect(Object.keys(overrides)).toHaveLength(9);
  });
});
