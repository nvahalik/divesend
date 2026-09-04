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

  it('golden: header-only dive output is stable', () => {
    expect(transformDive(makeDive())).toMatchInlineSnapshot(`
      {
        "odin_user_log_alarmDataset": "[]",
        "odin_user_log_avg_depth_ft": 0,
        "odin_user_log_avg_depth_m": 0,
        "odin_user_log_date": "2026-07-28",
        "odin_user_log_datetime": "2026-07-28 07:26",
        "odin_user_log_depthDataset": "[]",
        "odin_user_log_depth_ft": 32.8,
        "odin_user_log_depth_m": 10,
        "odin_user_log_diveComputer": "",
        "odin_user_log_diveSamples": "[]",
        "odin_user_log_divecomputer_dive_ref": "2026-07-28T12:26:00.000Z_0",
        "odin_user_log_divecomputer_imported": true,
        "odin_user_log_divecomputer_manufacturer": "Shearwater",
        "odin_user_log_divecomputer_name": "Teric",
        "odin_user_log_divecomputer_ref": "Teric",
        "odin_user_log_divetime": 10,
        "odin_user_log_ean": 0,
        "odin_user_log_ean_percent": 0,
        "odin_user_log_entry_time": "07:26",
        "odin_user_log_gfSurfDataset": "[]",
        "odin_user_log_gf_set": "50 / 85",
        "odin_user_log_gf_set_1": 50,
        "odin_user_log_gf_set_2": 85,
        "odin_user_log_gfnowDataset": "[]",
        "odin_user_log_pressure_end_bar": 100,
        "odin_user_log_pressure_end_psi": 1450.4,
        "odin_user_log_pressure_start_bar": 200,
        "odin_user_log_pressure_start_psi": 2900.8,
        "odin_user_log_tempDataset": "[]",
      }
    `);
  });

  it('golden: dive-with-samples output is stable', () => {
    const dive = makeDive({}, [
      { timeS: 0, depthM: 0, tempC: 24, ndlS: 5940, tankPressureBar: 200, decoStopDepthM: null, ttsS: null },
      { timeS: 30, depthM: 12.5, tempC: 22.1, ndlS: 3600, tankPressureBar: 190, decoStopDepthM: null, ttsS: null },
      { timeS: 60, depthM: 18, tempC: 21, ndlS: 1200, tankPressureBar: 182, decoStopDepthM: 3, ttsS: 300 },
    ]);
    expect(transformDive(dive)).toMatchInlineSnapshot(`
      {
        "odin_user_log_alarmDataset": "[]",
        "odin_user_log_avg_depth_ft": 33.4,
        "odin_user_log_avg_depth_m": 10.2,
        "odin_user_log_date": "2026-07-28",
        "odin_user_log_datetime": "2026-07-28 07:26",
        "odin_user_log_depthDataset": "[0.0,12.5,18.0]",
        "odin_user_log_depth_ft": 32.8,
        "odin_user_log_depth_m": 10,
        "odin_user_log_diveComputer": "",
        "odin_user_log_diveSamples": "[{"n":1,"t":0,"d":0.0,"s":0.0,"te":24.0,"ndl":99,"gs":0.0,"gn":0.0,"a":0,"mf":201326592,"o":false,"dr":false,"rv":3.0,"pressure":200.0},{"n":2,"t":30000,"d":12.5,"s":-25.0,"te":22.1,"ndl":60,"gs":0.0,"gn":0.0,"a":0,"mf":134217728,"o":false,"dr":false,"rv":3.0,"pressure":190.0},{"n":3,"t":60000,"d":18.0,"s":-11.0,"te":21.0,"ndl":20,"gs":0.0,"gn":0.0,"a":0,"mf":134217728,"o":false,"dr":true,"rv":3.0,"pressure":182.0}]",
        "odin_user_log_divecomputer_dive_ref": "2026-07-28T12:26:00.000Z_0",
        "odin_user_log_divecomputer_imported": true,
        "odin_user_log_divecomputer_manufacturer": "Shearwater",
        "odin_user_log_divecomputer_name": "Teric",
        "odin_user_log_divecomputer_ref": "Teric",
        "odin_user_log_divetime": 10,
        "odin_user_log_ean": 0,
        "odin_user_log_ean_percent": 0,
        "odin_user_log_entry_time": "07:26",
        "odin_user_log_gfSurfDataset": "[0.0,0.0,0.0]",
        "odin_user_log_gf_set": "50 / 85",
        "odin_user_log_gf_set_1": 50,
        "odin_user_log_gf_set_2": 85,
        "odin_user_log_gfnowDataset": "[0.0,0.0,0.0]",
        "odin_user_log_pressure_end_bar": 100,
        "odin_user_log_pressure_end_psi": 1450.4,
        "odin_user_log_pressure_start_bar": 200,
        "odin_user_log_pressure_start_psi": 2900.8,
        "odin_user_log_tankPressureDataset": "[200.0,190.0,182.0]",
        "odin_user_log_tempDataset": "[24.0,22.1,21.0]",
        "odin_user_log_watertemp_c": 21,
        "odin_user_log_watertemp_f": 69.8,
        "odin_user_log_watertemp_max_c": 24,
        "odin_user_log_watertemp_max_f": 75.2,
      }
    `);
  });
});

describe('transformDive enrichments — scalars', () => {
  it('emits firmware, cns_start, amv, water-type when set', () => {
    const payload = transformDive(
      makeDive({
        firmwareVersion: 'V92',
        cnsStartPercent: 1.234,
        sacVolumeLPerMin: 12.345,
        sacPressurePsiPerMin: 33.987,
        waterTypeId: 4,
      })
    );
    expect(payload.odin_user_log_divecomputer_firmware).toBe('V92');
    expect(payload.odin_user_log_cns_start).toBe(1.2);
    expect(payload.odin_user_log_amv_l).toBe(12.35);
    expect(payload.odin_user_log_amv_psi).toBe(33.99);
    expect(payload.odin_user_log_var_watertype_id).toBe(4);
  });

  it('omits every scalar enrichment key when unset', () => {
    const payload = transformDive(makeDive());
    for (const k of [
      'odin_user_log_divecomputer_firmware',
      'odin_user_log_cns_start',
      'odin_user_log_amv_l',
      'odin_user_log_amv_psi',
      'odin_user_log_var_watertype_id',
    ]) {
      expect(payload[k]).toBeUndefined();
    }
  });

  it('emits a GPS pair only when both lat and lon are set', () => {
    const both = transformDive(makeDive({ startLatitude: 34.05, startLongitude: -118.24 }));
    expect(both.odin_user_log_pos_start_latitude).toBe(34.05);
    expect(both.odin_user_log_pos_start_longitude).toBe(-118.24);

    const half = transformDive(makeDive({ startLatitude: 34.05 }));
    expect(half.odin_user_log_pos_start_latitude).toBeUndefined();
    expect(half.odin_user_log_pos_start_longitude).toBeUndefined();
  });

  it('emits the end GPS pair independently', () => {
    const payload = transformDive(makeDive({ endLatitude: 34.06, endLongitude: -118.25 }));
    expect(payload.odin_user_log_pos_end_latitude).toBe(34.06);
    expect(payload.odin_user_log_pos_end_longitude).toBe(-118.25);
  });
});

describe('transformDive enrichments — heart rate', () => {
  const hrSamples = [
    { timeS: 0, depthM: 0, tempC: 24, ndlS: null, tankPressureBar: null, decoStopDepthM: null, ttsS: null, heartRateBpm: 70 },
    { timeS: 30, depthM: 10, tempC: 22, ndlS: null, tankPressureBar: null, decoStopDepthM: null, ttsS: null, heartRateBpm: null },
    { timeS: 60, depthM: 15, tempC: 21, ndlS: null, tankPressureBar: null, decoStopDepthM: null, ttsS: null, heartRateBpm: 90 },
  ];

  it('builds the dataset and computes min/max/avg from samples', () => {
    const payload = transformDive(makeDive({}, hrSamples));
    expect(payload.odin_user_log_heartRateDataset).toBe('[70.0,null,90.0]');
    expect(payload.odin_user_log_heartRateMin).toBe(70);
    expect(payload.odin_user_log_heartRateMax).toBe(90);
    expect(payload.odin_user_log_heartRateAvg).toBe(80);
  });

  it('prefers header min/max/avg over sample-derived values', () => {
    const payload = transformDive(
      makeDive({ heartRateMinBpm: 55, heartRateMaxBpm: 165, heartRateAvgBpm: 120 }, hrSamples)
    );
    expect(payload.odin_user_log_heartRateMin).toBe(55);
    expect(payload.odin_user_log_heartRateMax).toBe(165);
    expect(payload.odin_user_log_heartRateAvg).toBe(120);
  });

  it('emits no heart-rate keys when there is no HR anywhere', () => {
    const payload = transformDive(makeDive({}, [
      { timeS: 0, depthM: 0, tempC: 24, ndlS: null, tankPressureBar: null, decoStopDepthM: null, ttsS: null },
    ]));
    for (const k of ['odin_user_log_heartRateDataset', 'odin_user_log_heartRateAvg', 'odin_user_log_heartRateMin', 'odin_user_log_heartRateMax']) {
      expect(payload[k]).toBeUndefined();
    }
  });
});
