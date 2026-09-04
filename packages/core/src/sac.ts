// packages/core/src/sac.ts
// Surface Air Consumption (SAC) rate, pressure-based -- the standard diving
// metric (how fast a diver breathes down their tank, normalized to what that
// rate would be at the surface). Computed purely from tank pressure + depth +
// time, so it works for any CanonicalDive with a pressure sensor, regardless
// of source format -- unlike a volumetric (L/min) SAC, it needs no tank size.

import type { CanonicalDive } from './types.js';
import { BAR_TO_PSI, roundHalfToEven } from './units.js';

const MSW_PER_ATM = 10; // meters of seawater per additional atmosphere

/**
 * SAC rate in psi/min, surface-normalized. `null` when either tank pressure
 * reading is missing, the dive has no measurable duration, or the pressure
 * "dropped" by zero or a negative amount (bad data -- e.g. a tank swap
 * mid-dive that this simple formula can't account for).
 */
export function computeSacPsiPerMin(dive: CanonicalDive): number | null {
  const { tankBeginPressureBar, tankEndPressureBar, divetimeS } = dive.header;
  if (tankBeginPressureBar == null || tankEndPressureBar == null) return null;
  if (!(divetimeS > 0)) return null;

  const pressureDropBar = tankBeginPressureBar - tankEndPressureBar;
  if (!(pressureDropBar > 0)) return null;

  const depths = dive.samples.map((s) => s.depthM);
  const avgDepthM = depths.length > 0 ? depths.reduce((sum, d) => sum + d, 0) / depths.length : 0;
  const avgAtm = 1 + avgDepthM / MSW_PER_ATM;

  const sacBarPerMin = pressureDropBar / (divetimeS / 60) / avgAtm;
  return roundHalfToEven(sacBarPerMin * BAR_TO_PSI, 2);
}
