// Shared SSI `save_divelog` payload primitives. These were previously inline in
// payloadTransformer.ts as `divePhaseBitmask` / `alarmBitmask` / `alarmEntries`
// plus their bitmask/threshold consts. Lifted here verbatim so every converter
// (FIT, Shearwater XML, dctool) computes dive-phase / ascent-alarm bits and the
// alarm dataset the exact same way. This is a mechanical, behavior-preserving
// extraction -- do not "simplify" the thresholds or bit values.

import type { SsiSample } from './sample.js';

export const DIVE_PHASE_FLAGS = { DIVE: 0x08000000, SURFACED: 0x04000000 } as const;
export const ALARM_FLAGS = { ASCENT_ADVISORY: 0x000002, ASCENT_WARNING: 0x000004 } as const;
export const ASCENT_ADVISORY_M_PER_MIN = 5.0;
export const ASCENT_WARNING_M_PER_MIN = 6.0;
export const SURFACED_M = 1.0;
export const NDL_CAP = 99;

/** Exact port of payloadTransformer's `alarmBitmask`. */
export function ascentAlarmBits(ascentSpeedMPerMin: number): number {
  if (ascentSpeedMPerMin >= ASCENT_WARNING_M_PER_MIN) {
    return ALARM_FLAGS.ASCENT_ADVISORY | ALARM_FLAGS.ASCENT_WARNING;
  }
  if (ascentSpeedMPerMin >= ASCENT_ADVISORY_M_PER_MIN) {
    return ALARM_FLAGS.ASCENT_ADVISORY;
  }
  return 0;
}

/** Exact port of payloadTransformer's `divePhaseBitmask`. */
export function divePhaseBits(depthM: number): number {
  let mask = DIVE_PHASE_FLAGS.DIVE;
  if (depthM <= SURFACED_M) {
    mask |= DIVE_PHASE_FLAGS.SURFACED;
  }
  return mask;
}

/** Exact port of payloadTransformer's `alarmEntries`. */
function alarmEntries(samples: SsiSample[]): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  for (const record of samples) {
    if (record.a === 0) continue;
    entries.push({
      position: record.n,
      speed: (record.a & ALARM_FLAGS.ASCENT_ADVISORY) !== 0,
      fast_ascent: (record.a & ALARM_FLAGS.ASCENT_WARNING) !== 0,
      deco: false,
      violation: false,
    });
  }
  return entries;
}

/** JSON text of the sparse alarm dataset -- `JSON.stringify(alarmEntries(samples))`. */
export function alarmDataset(samples: SsiSample[]): string {
  return JSON.stringify(alarmEntries(samples));
}
