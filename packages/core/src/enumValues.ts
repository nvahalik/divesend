// Id->label tables for SSI's small dive-log enums. SSI's API exposes no endpoint that
// returns these mappings -- they're reverse-engineered from the SSI Android app's bundled
// dive_form_values.json and already captured in this project's Python reference at
// ssi_mcp/data/enum_values.json (and ported once already for the iOS app's
// SSIEnumValues.swift, which this file mirrors exactly).

export type EnumCategory = 'diveType' | 'entry' | 'tankType' | 'waterBody' | 'current' | 'weather';

export const ENUM_VALUES: Record<EnumCategory, Record<number, string>> = {
  diveType: {
    23: 'Education',
    24: 'Fun',
    138: 'Scientific',
    139: 'Work',
  },
  entry: {
    21: 'Shore',
    22: 'Boat',
    35: 'Other',
  },
  tankType: {
    19: 'Steel',
    20: 'Aluminum',
  },
  waterBody: {
    13: 'Ocean',
    14: 'River',
    15: 'Quarry',
    16: 'Lake',
    17: 'Indoor',
    18: 'Artificial Lake',
    52: 'Pool',
    53: 'Confined',
    54: 'Open Water',
    84: 'Dry Land',
    123: 'Blue Hole',
    124: 'Cave',
    125: 'Cavern/Cenote',
    140: 'Spring',
  },
  current: {
    6: 'No Current',
    7: 'Light Current',
    8: 'Strong Current',
    9: 'Ripping Current',
  },
  weather: {
    1: 'Sunny',
    2: 'Cloudy',
    3: 'Rainy',
    121: 'Snow',
  },
};

/** (id, label) pairs sorted alphabetically by label, for stable `<select>` ordering. */
export function sortedOptions(category: EnumCategory): { id: number; label: string }[] {
  return Object.entries(ENUM_VALUES[category])
    .map(([id, label]) => ({ id: Number(id), label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
