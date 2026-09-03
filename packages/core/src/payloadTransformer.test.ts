import { describe, expect, it } from 'vitest';
import { transformDive } from './payloadTransformer';
import type { CanonicalDive } from '@divesend/core';

function makeDive(overrides: Partial<CanonicalDive['header']> = {}, samples: CanonicalDive['samples'] = []): CanonicalDive {
  return {
    header: {
      startTime: '2026-07-28T12:26:00Z',
      maxDepthM: 10.0,
      gasO2Percent: 21.0,
      gasHePercent: 0.0,
      tankBeginPressureBar: 200.0,
      tankEndPressureBar: 100.0,
      diveMode: 'oc',
      decoModel: 'buhlmann',
      gfLow: 50,
      gfHigh: 85,
      salinity: 'salt',
      deviceModel: 'Shearwater Teric',
      divetimeS: 600,
      minTemperatureC: null,
      maxTemperatureC: null,
      cnsPercent: null,
      ...overrides,
    },
    samples,
  };
}

describe('transformDive', () => {
  it('maps core header fields', () => {
    const payload = transformDive(makeDive());
    expect(payload.odin_user_log_depth_m).toBe(10.0);
    expect(payload.odin_user_log_ean).toBe(0);
    expect(payload.odin_user_log_gf_set).toBe('50 / 85');
    expect(payload.odin_user_log_gf_set_1).toBe(50);
    expect(payload.odin_user_log_gf_set_2).toBe(85);
    expect(payload.odin_user_log_divetime).toBe(10); // 600s / 60
  });

  it('sends pressure bar and psi keys when present', () => {
    const payload = transformDive(makeDive());
    expect(payload.odin_user_log_pressure_start_bar).toBeCloseTo(200.0, 1);
    expect(payload.odin_user_log_pressure_start_psi).toBeCloseTo(200.0 * 14.5038, 1);
    expect(payload.odin_user_log_pressure_end_bar).toBeCloseTo(100.0, 1);
    expect(payload.odin_user_log_pressure_end_psi).toBeCloseTo(100.0 * 14.5038, 1);
  });

  it('omits pressure keys entirely when both are null', () => {
    const payload = transformDive(makeDive({ tankBeginPressureBar: null, tankEndPressureBar: null }));
    expect(payload.odin_user_log_pressure_start_bar).toBeUndefined();
    expect(payload.odin_user_log_pressure_start_psi).toBeUndefined();
    expect(payload.odin_user_log_pressure_end_bar).toBeUndefined();
    expect(payload.odin_user_log_pressure_end_psi).toBeUndefined();
  });

  it('includes device serial number only when provided', () => {
    const withSerial = transformDive(makeDive(), '4C579D0F');
    expect(withSerial.odin_user_log_divecomputer_serial_nr).toBe('4C579D0F');

    const withoutSerial = transformDive(makeDive());
    expect(withoutSerial.odin_user_log_divecomputer_serial_nr).toBeUndefined();
  });

  it('produces dive samples as a JSON string', () => {
    const payload = transformDive(
      makeDive({}, [
        { timeS: 5, depthM: 1.28, tempC: 32.22, ndlS: 5940, tankPressureBar: 130.59, decoStopDepthM: null, ttsS: null },
      ])
    );
    const samples = JSON.parse(payload.odin_user_log_diveSamples as string);
    expect(samples).toHaveLength(1);
    expect(samples[0].n).toBe(1);
    expect(samples[0].t).toBe(5000); // ms
    expect(samples[0].d).toBe(1.28);
  });

  it('forces whole-number double fields to render with a decimal point in the raw JSON string', () => {
    const payload = transformDive(
      makeDive({}, [
        { timeS: 5, depthM: 10, tempC: 20, ndlS: 5940, tankPressureBar: 130, decoStopDepthM: null, ttsS: null },
      ])
    );
    const rawSamples = payload.odin_user_log_diveSamples as string;
    expect(rawSamples).toContain('"d":10.0');
    expect(rawSamples).not.toContain('"d":10,');
    expect(rawSamples).not.toContain('"d":10}');

    const rawDepthDataset = payload.odin_user_log_depthDataset as string;
    expect(rawDepthDataset).toBe('[10.0]');
  });
});
