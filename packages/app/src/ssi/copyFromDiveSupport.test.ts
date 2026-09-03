import { describe, expect, it } from 'vitest';
import { summaries, extraDetails, siteNames, mostRecentDive } from './copyFromDiveSupport';

describe('summaries', () => {
  it('sorts newest first by dive number', () => {
    const divelog = [
      { odin_user_log_nr: 5, odin_user_log_datetime: '2026-01-01 08:00' },
      { odin_user_log_nr: 8, odin_user_log_datetime: '2026-02-01 08:00' },
      { odin_user_log_nr: 3, odin_user_log_datetime: '2025-12-01 08:00' },
    ];
    const result = summaries(divelog);
    expect(result.map((s) => s.id)).toEqual([8, 5, 3]);
    expect(result.map((s) => s.date)).toEqual(['2026-02-01 08:00', '2026-01-01 08:00', '2025-12-01 08:00']);
  });

  it('skips records with no dive number', () => {
    expect(summaries([{ odin_user_log_datetime: '2026-01-01 08:00' }])).toEqual([]);
  });

  it('falls back to a dive-number label when datetime is missing', () => {
    expect(summaries([{ odin_user_log_nr: 7 }])[0].date).toBe('Dive #7');
  });
});

describe('extraDetails', () => {
  it('extracts all fields from a record', () => {
    const record = {
      odin_user_log_tank_vol_l: 11.1,
      odin_user_log_var_tanktype_id: 20,
      odin_user_log_var_divetype_id: 24,
      odin_user_log_var_entry_id: 22,
      odin_user_log_var_water_body_id: 13,
      odin_user_log_var_current_id: 6,
      odin_user_log_var_weather_id: 1,
      odin_user_log_dive_sites_id: 22489,
    };
    const details = extraDetails(record, { 22489: 'Some Site' });
    expect(details).toEqual({
      tankVolumeL: 11.1,
      tankTypeID: 20,
      diveTypeID: 24,
      entryID: 22,
      waterBodyID: 13,
      currentID: 6,
      weatherID: 1,
      siteID: 22489,
      siteName: 'Some Site',
    });
  });

  it('leaves fields undefined when absent from the record', () => {
    expect(extraDetails({}, {})).toEqual({});
  });

  it('has no siteName when siteID is not in the lookup', () => {
    const details = extraDetails({ odin_user_log_dive_sites_id: 999 }, {});
    expect(details.siteID).toBe(999);
    expect(details.siteName).toBeUndefined();
  });
});

describe('siteNames', () => {
  it('builds a lookup from logbook_sites records', () => {
    const logbookSites = [
      { odin_dive_sites_id: 22489, odin_dive_sites_name: 'Stillhouse Pavillion Buoy' },
      { odin_dive_sites_id: 11111, odin_dive_sites_name: 'Some Other Site' },
    ];
    expect(siteNames(logbookSites)).toEqual({ 22489: 'Stillhouse Pavillion Buoy', 11111: 'Some Other Site' });
  });

  it('skips records missing id or name', () => {
    expect(siteNames([{ odin_dive_sites_id: 1 }])).toEqual({});
  });
});

describe('mostRecentDive', () => {
  it('returns the highest dive number', () => {
    const divelog = [{ odin_user_log_nr: 5 }, { odin_user_log_nr: 8 }, { odin_user_log_nr: 3 }];
    expect(mostRecentDive(divelog)?.odin_user_log_nr).toBe(8);
  });

  it('returns undefined for an empty divelog', () => {
    expect(mostRecentDive([])).toBeUndefined();
  });

  it('returns the last record on a tie (matching the Swift source\'s max(by:) tie-break)', () => {
    const first = { odin_user_log_nr: 5, label: 'first' };
    const second = { odin_user_log_nr: 5, label: 'second' };
    expect(mostRecentDive([first, second])).toBe(second);
  });
});
