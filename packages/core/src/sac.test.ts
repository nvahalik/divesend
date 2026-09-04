import { describe, expect, it } from 'vitest';
import { computeSacPsiPerMin } from './sac';
import type { CanonicalDive } from './types';

function makeDive(overrides: Partial<CanonicalDive['header']> = {}, samples: CanonicalDive['samples'] = []): CanonicalDive {
  return {
    header: {
      startTime: '2026-07-28T12:26:00Z',
      maxDepthM: 18,
      gasO2Percent: 21,
      gasHePercent: 0,
      tankBeginPressureBar: null,
      tankEndPressureBar: null,
      diveMode: 'oc',
      decoModel: 'buhlmann',
      gfLow: 50,
      gfHigh: 85,
      salinity: 'salt',
      deviceModel: 'Test',
      divetimeS: 1800,
      minTemperatureC: null,
      maxTemperatureC: null,
      cnsPercent: null,
      ...overrides,
    },
    samples,
  };
}

describe('computeSacPsiPerMin', () => {
  it('computes a plausible rate for a real-shaped dive', () => {
    // 200 -> 100 bar over 30 min at a flat 20m (3 ATA): 100bar / 30min / 3 = 1.111 bar/min -> psi.
    const dive = makeDive(
      { tankBeginPressureBar: 200, tankEndPressureBar: 100, divetimeS: 1800 },
      [
        { timeS: 0, depthM: 20, tempC: null, ndlS: null, tankPressureBar: null, decoStopDepthM: null, ttsS: null },
        { timeS: 1800, depthM: 20, tempC: null, ndlS: null, tankPressureBar: null, decoStopDepthM: null, ttsS: null },
      ]
    );
    const sac = computeSacPsiPerMin(dive);
    expect(sac).not.toBeNull();
    expect(sac).toBeCloseTo((100 / 30 / 3) * 14.5038, 1);
  });

  it('returns null when either tank pressure is missing', () => {
    expect(computeSacPsiPerMin(makeDive({ tankBeginPressureBar: 200, tankEndPressureBar: null }))).toBeNull();
    expect(computeSacPsiPerMin(makeDive({ tankBeginPressureBar: null, tankEndPressureBar: 100 }))).toBeNull();
  });

  it('returns null when there is no measurable duration', () => {
    expect(computeSacPsiPerMin(makeDive({ tankBeginPressureBar: 200, tankEndPressureBar: 100, divetimeS: 0 }))).toBeNull();
  });

  it('returns null when pressure did not drop (bad data)', () => {
    expect(computeSacPsiPerMin(makeDive({ tankBeginPressureBar: 100, tankEndPressureBar: 100 }))).toBeNull();
    expect(computeSacPsiPerMin(makeDive({ tankBeginPressureBar: 100, tankEndPressureBar: 150 }))).toBeNull();
  });

  it('treats a dive with no samples as surface-average (avgDepthM = 0, avgAtm = 1)', () => {
    const dive = makeDive({ tankBeginPressureBar: 200, tankEndPressureBar: 100, divetimeS: 600 }, []);
    const sac = computeSacPsiPerMin(dive);
    expect(sac).toBeCloseTo((100 / 10 / 1) * 14.5038, 1);
  });
});
