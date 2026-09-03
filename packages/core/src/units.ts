// packages/core/src/units.ts
// Shared unit conversions and formatting. The display helpers
// (METERS_TO_FEET / BAR_TO_PSI / celsiusToFahrenheit / formatDuration /
// formatMinutesSeconds) match the iOS app's imperial display convention and
// were previously in app/src/lib/units.ts -- single source of truth so a
// precision fix can't drift between copies.
//
// The conversion CONSTANTS below (FT_TO_M, PSI_TO_BAR, SEMICIRCLE_TO_DEG,
// BAR_TO_PA, KELVIN_OFFSET, FIT_EPOCH_MS) and roundHalfToEven are for
// byte-exact parity with the Python FIT/Shearwater converters -- do not
// "simplify" them to the display constants above; the values differ.

export const METERS_TO_FEET = 3.28084;
export const BAR_TO_PSI = 14.5038;

export function metersToFeet(meters: number): number {
  return meters * METERS_TO_FEET;
}

export function barToPsi(bar: number): number {
  return bar * BAR_TO_PSI;
}

export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

/** "H:MM:SS" — matches DiveDetailView.swift/DiveListView.swift's durationString. */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** "M:SS" — used for chart axis/tooltip time labels, not full dive duration. */
export function formatMinutesSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// --- Python-parity conversion constants ---------------------------------------

/** Feet -> metres. Exact value the Python converters use (`app/`'s
 *  METERS_TO_FEET = 3.28084 differs by ~5e-8 and can flip a round() at a
 *  boundary). */
export const FT_TO_M = 0.3048;

/** psi -> bar, matching the Python converters (not 1 / BAR_TO_PSI). */
export const PSI_TO_BAR = 0.0689476;

/** FIT/Garmin semicircle unit -> degrees. */
export const SEMICIRCLE_TO_DEG = 180 / 2 ** 31;

/** bar -> pascal, for UDDF output. */
export const BAR_TO_PA = 100_000;

/** 0 degC in kelvin, for UDDF output. */
export const KELVIN_OFFSET = 273.15;

/** FIT epoch: 1989-12-31T00:00:00Z, as milliseconds since the Unix epoch. */
export const FIT_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0);

/**
 * Round half to even ("banker's rounding") -- the behaviour of Python's
 * built-in `round()`, which the ported converters' tests assert against
 * (documented case: `round(194.5) == 194`). JS `Math.round` rounds half up,
 * so it can't be used where the Python relied on this.
 */
export function roundHalfToEven(x: number, digits = 0): number {
  const m = 10 ** digits;
  const scaled = x * m;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let r: number;
  if (Math.abs(diff - 0.5) < 1e-9) {
    r = floor % 2 === 0 ? floor : floor + 1;
  } else if (diff > 0.5) {
    r = floor + 1;
  } else {
    r = floor;
  }
  return r / m;
}
