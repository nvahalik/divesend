import { describe, it, expect } from 'vitest';
import {
  divePhaseBits,
  ascentAlarmBits,
  alarmDataset,
  DIVE_PHASE_FLAGS,
  ALARM_FLAGS,
} from './ssiPayload';
import type { SsiSample } from './sample';

function sample(overrides: Partial<SsiSample>): SsiSample {
  return {
    n: 1,
    t: 0,
    d: 0,
    s: 0,
    te: null,
    ndl: null,
    gs: 0,
    gn: 0,
    a: 0,
    mf: 0,
    o: false,
    dr: false,
    rv: 3.0,
    ...overrides,
  };
}

describe('divePhaseBits', () => {
  it('marks SURFACED at or below 1.0 m, DIVE only above', () => {
    expect(divePhaseBits(0.5)).toBe(DIVE_PHASE_FLAGS.DIVE | DIVE_PHASE_FLAGS.SURFACED);
    expect(divePhaseBits(1.0)).toBe(DIVE_PHASE_FLAGS.DIVE | DIVE_PHASE_FLAGS.SURFACED);
    expect(divePhaseBits(1.01)).toBe(DIVE_PHASE_FLAGS.DIVE);
  });
});

describe('ascentAlarmBits', () => {
  it('escalates at the 5 and 6 m/min thresholds', () => {
    expect(ascentAlarmBits(4.9)).toBe(0);
    expect(ascentAlarmBits(5)).toBe(ALARM_FLAGS.ASCENT_ADVISORY);
    expect(ascentAlarmBits(6)).toBe(ALARM_FLAGS.ASCENT_ADVISORY | ALARM_FLAGS.ASCENT_WARNING);
  });
});

describe('alarmDataset', () => {
  it('is sparse JSON -- omits samples with no alarm bits', () => {
    expect(alarmDataset([sample({ a: 0 })])).toBe('[]');
  });

  it('emits one entry per alarmed sample with the SSI key shape', () => {
    const one = JSON.parse(
      alarmDataset([sample({ n: 3, a: ALARM_FLAGS.ASCENT_ADVISORY })])
    );
    expect(one).toEqual([
      { position: 3, speed: true, fast_ascent: false, deco: false, violation: false },
    ]);

    const warn = JSON.parse(
      alarmDataset([
        sample({ n: 7, a: ALARM_FLAGS.ASCENT_ADVISORY | ALARM_FLAGS.ASCENT_WARNING }),
      ])
    );
    expect(warn).toEqual([
      { position: 7, speed: true, fast_ascent: true, deco: false, violation: false },
    ]);
  });
});
