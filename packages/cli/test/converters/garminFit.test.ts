// TS port of tests/test_fit_ssi_convert.py, case-by-case, same expected values.
//
// Divergences from the Python assertions (documented, not loosened):
//  * enum string values are the @garmin/fitsdk camelCase form
//    ("singleGasDiving" / "apneaDiving" / "descentMk2") not garmin_fit_sdk's
//    snake_case ("single_gas_diving" ...).
//  * ParsedFit keys are camelCase ("startTime", "diveGas", ...).
//  * JS `JSON.stringify` emits `"o":false` (no space) where Python's
//    `json.dumps` emits `"o": false`; the substring check matches the JS form.
//  * `test_parse_fit_raises_on_missing_file` becomes "reading a missing file
//    throws" (parseFit takes bytes, not a path).

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { FIT_EPOCH_MS, roundHalfToEven } from '@divesend/core';
import {
  parseFit,
  convertToSsiPayload,
  downsample,
  tankPressureAt,
  buildScubaSamples,
  buildApneaSamples,
  type FitRecord,
  type FitTankUpdate,
  type ParsedFit,
} from '../../src/converters/garminFit.js';

const APNEA_FIXTURE = new URL('../fixtures/garmin_apnea_descent_mk2.fit', import.meta.url);
const SCUBA_FIXTURE = new URL('../fixtures/garmin_scuba_saint_catherine.fit', import.meta.url);
const SCUBA_UDDF = new URL('../fixtures/garmin_scuba_saint_catherine.uddf', import.meta.url);

const apneaBytes = () => new Uint8Array(readFileSync(APNEA_FIXTURE));
const scubaBytes = () => new Uint8Array(readFileSync(SCUBA_FIXTURE));

// --- parse_fit --------------------------------------------------------------

describe('parseFit', () => {
  it('returns a normalized object (apnea fixture)', () => {
    const parsed = parseFit(apneaBytes());

    for (const k of ['session', 'activity', 'records', 'diveSummaries', 'device', 'subSport']) {
      expect(parsed).toHaveProperty(k);
    }
    expect(parsed.subSport).toBe('apneaDiving');
    expect(parsed.records.length).toBe(6660);
    expect((parsed.session.startTime as Date).getUTCFullYear()).toBe(2025);
    expect(parsed.activity.numSessions).toBe(1);

    const dev = parsed.device;
    expect(dev.manufacturer).toBe('garmin');
    expect(dev.productName).toBe('Descent Mk2');
    expect(String(dev.serialNumber)).toBe('3386258516');
    expect(Number(dev.softwareVersion)).toBe(28.0);

    const ts = parsed.records.map((r) => r.timestamp.getTime());
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it('reading a missing file throws', () => {
    const missing = new URL('../fixtures/does_not_exist.fit', import.meta.url);
    expect(() => readFileSync(missing)).toThrow();
  });

  it('surfaces scuba dive messages (scuba fixture)', () => {
    const parsed = parseFit(scubaBytes());

    expect(parsed.subSport).toBe('singleGasDiving');
    expect(parsed.diveGas.oxygenContent).toBe(21);
    expect(parsed.diveSettings.gfLow).toBe(40);
    expect(parsed.diveSettings.gfHigh).toBe(85);
    expect(parsed.tankUpdates.length).toBe(575);
    expect(parsed.tankSummary.startPressure).toBe(194.5);
    expect(parsed.startPosition).not.toBeNull();
    expect(parsed.endPosition).not.toBeNull();
    expect(parsed.records.length).toBe(2595);
  });

  it('apnea still parses with the scuba keys empty', () => {
    const parsed = parseFit(apneaBytes());
    expect(parsed.diveGas).toEqual({});
    expect(parsed.tankUpdates).toEqual([]);
    expect(parsed.startPosition).toBeNull();
    expect(parsed.subSport).toBe('apneaDiving');
  });
});

// --- downsample -----------------------------------------------------------

const DS_START = Date.UTC(2025, 0, 1, 0, 0, 0);

function tsr(secs: number, extra: Partial<FitRecord> = {}): FitRecord {
  return { timestamp: new Date(DS_START + secs * 1000), depth: 0.0, ...extra };
}

describe('downsample', () => {
  it('picks the nearest record to each 5 s mark', () => {
    const records = Array.from({ length: 13 }, (_, s) => tsr(s, { depth: s }));
    const ds = downsample(records, DS_START, 5);
    const offsets = ds.map((r) => (r.timestamp.getTime() - DS_START) / 1000);
    expect(offsets[0]).toBe(0);
    expect(offsets).toContain(5);
    expect(offsets).toContain(10);
    expect(offsets[offsets.length - 1]).toBe(12);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(new Set(offsets).size).toBe(offsets.length);
  });

  it('dedups a sparse profile and keeps the ends', () => {
    const records = [tsr(0), tsr(3), tsr(30)];
    const ds = downsample(records, DS_START, 5);
    expect(ds.map((r) => (r.timestamp.getTime() - DS_START) / 1000)).toEqual([0, 3, 30]);
  });

  it('empty in, empty out', () => {
    expect(downsample([], DS_START)).toEqual([]);
  });
});

// --- tankPressureAt ------------------------------------------------------

describe('tankPressureAt', () => {
  it('clamps to the ends and picks the nearest otherwise', () => {
    const base = Date.UTC(2025, 0, 1, 0, 0, 0);
    const ups: FitTankUpdate[] = [
      { timestamp: new Date(base + 10_000), pressure: 200.0 },
      { timestamp: new Date(base + 20_000), pressure: 180.0 },
      { timestamp: new Date(base + 30_000), pressure: 150.0 },
    ];
    expect(tankPressureAt(base, ups)).toBe(200.0);
    expect(tankPressureAt(base + 99_000, ups)).toBe(150.0);
    expect(tankPressureAt(base + 21_000, ups)).toBe(180.0);
    expect(tankPressureAt(base + 26_000, ups)).toBe(150.0);
    expect(tankPressureAt(base, [])).toBeNull();
  });
});

// --- build*Samples synthetic --------------------------------------------

const S0 = Date.UTC(2025, 0, 1, 12, 0, 0);

interface SrOpts {
  ascentRate?: number;
  temp?: number | null;
  ndlTime?: number | null;
  nextStopDepth?: number;
}
function sr(secs: number, depth: number, o: SrOpts = {}): FitRecord {
  const { ascentRate = 0.0, temp = 26, ndlTime = null, nextStopDepth = 0.0 } = o;
  return {
    timestamp: new Date(S0 + secs * 1000),
    depth,
    ascentRate,
    temperature: temp,
    ndlTime,
    nextStopDepth,
  };
}

const DIVE = 0x08000000;
const SURFACED = 0x04000000;
const ADV = 0x000002;
const WARN = 0x000004;

describe('buildScubaSamples', () => {
  it('core shape and types', () => {
    const dsr = [
      sr(0, 0.4, { ascentRate: 0.0, ndlTime: null }),
      sr(5, 12.0, { ascentRate: -0.3, ndlTime: 3124 }),
      sr(10, 5.0, { ascentRate: 0.12, ndlTime: 45, nextStopDepth: 3.0 }),
    ];
    const samples = buildScubaSamples(dsr, S0, []);

    expect(samples.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(samples.map((s) => s.t)).toEqual([0, 5000, 10000]);
    expect(samples[1].d).toBe(12.0);
    expect(typeof samples[1].s).toBe('number');
    expect(samples[1].s).toBe(-18.0);
    expect(samples[2].s).toBe(7.2);
    expect(samples[0].ndl).toBeNull();
    expect(samples[1].ndl).toBe(99);
    expect(samples[2].ndl).toBe(45);
    expect(samples[0].mf).toBe(DIVE | SURFACED);
    expect(samples[1].mf).toBe(DIVE);
    expect(samples[2].dr).toBe(true);
    expect(samples[1].dr).toBe(false);
    expect(samples[0].dr).toBe(false);
    expect(samples.every((s) => s.gs === 0.0 && s.gn === 0.0 && s.rv === 3.0)).toBe(true);
    expect(samples.every((s) => s.o === false)).toBe(true);
    expect(samples.every((s) => !('pressure' in s))).toBe(true);
  });

  it('ascent alarm bits', () => {
    const dsr = [
      sr(0, 20.0, { ascentRate: 0.05 }),
      sr(5, 18.0, { ascentRate: 0.1 }),
      sr(10, 17.0, { ascentRate: 0.09 }),
    ];
    const samples = buildScubaSamples(dsr, S0, []);
    expect(samples[0].a).toBe(0);
    expect(samples[1].a).toBe(ADV | WARN);
    expect(samples[2].a).toBe(ADV);
  });

  it('attaches tank pressure', () => {
    const ups: FitTankUpdate[] = [
      { timestamp: new Date(S0), pressure: 200.0 },
      { timestamp: new Date(S0 + 10_000), pressure: 190.0 },
    ];
    const dsr = [sr(0, 1.0), sr(5, 10.0), sr(10, 12.0)];
    const samples = buildScubaSamples(dsr, S0, ups);
    expect(samples[0].pressure).toBe(200.0);
    expect(samples[2].pressure).toBe(190.0);
    expect(typeof samples[1].pressure).toBe('number');
  });

  it('missing temp and ascent', () => {
    const dsr: FitRecord[] = [{ timestamp: new Date(S0), depth: 3.0 }];
    const samples = buildScubaSamples(dsr, S0, []);
    expect(samples[0].te).toBeNull();
    expect(samples[0].s).toBe(0.0);
    expect(samples[0].ndl).toBeNull();
  });
});

describe('buildApneaSamples', () => {
  it('shape and apnea specifics', () => {
    const dsr = [
      sr(0, 0.4, { ascentRate: 0.0 }),
      sr(5, 12.0, { ascentRate: -0.3, ndlTime: 3124, nextStopDepth: 3.0 }),
      sr(10, 1.0, { ascentRate: 0.5 }),
    ];
    const samples = buildApneaSamples(dsr, S0);

    expect(samples.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(samples.map((s) => s.t)).toEqual([0, 5000, 10000]);
    expect(samples[1].d).toBe(12.0);
    expect(typeof samples[1].s).toBe('number');
    expect(samples[1].s).toBe(-18.0);
    expect(samples[0].mf).toBe(DIVE | SURFACED);
    expect(samples[1].mf).toBe(DIVE);
    expect(samples[2].mf).toBe(DIVE | SURFACED);
    expect(samples.every((s) => s.ndl === null)).toBe(true);
    expect(samples.every((s) => s.a === 0)).toBe(true);
    expect(samples.every((s) => s.dr === false)).toBe(true);
    expect(samples.every((s) => !('pressure' in s))).toBe(true);
    expect(samples.every((s) => s.gs === 0.0 && s.gn === 0.0 && s.rv === 3.0)).toBe(true);
    expect(samples.every((s) => s.o === false)).toBe(true);
  });

  it('missing fields', () => {
    const samples = buildApneaSamples([{ timestamp: new Date(S0), depth: 3.0 }], S0);
    expect(samples[0].te).toBeNull();
    expect(samples[0].s).toBe(0.0);
    expect(samples[0].ndl).toBeNull();
  });
});

// --- synthetic parsed builders ----------------------------------------

const SYN_START = Date.UTC(2025, 5, 1, 5, 0, 0);
const SYN_LOCAL_SECS = Math.trunc((SYN_START + 3 * 3600 * 1000 - FIT_EPOCH_MS) / 1000); // +03:00

type SynRow = [number, number, number, number, number, number | null];
const DEFAULT_ROWS: SynRow[] = [
  [0, 0.3, 0.0, 27, 70, null],
  [5, 8.0, -0.4, 26, 90, 999],
  [10, 20.0, -0.2, 25, 95, 300],
  [15, 6.0, 0.3, 26, 88, 20],
  [20, 0.1, 0.1, 27, 80, null],
];

function rowsToRecords(rows: SynRow[]): FitRecord[] {
  return rows.map(([t, d, ar, te, hr, ndl]) => ({
    timestamp: new Date(SYN_START + t * 1000),
    depth: d,
    ascentRate: ar,
    temperature: te,
    heartRate: hr,
    ndlTime: ndl,
    nextStopDepth: 0.0,
  }));
}

function syntheticScuba(over: Partial<ParsedFit> & { subSport?: string } = {}): ParsedFit {
  const base: ParsedFit = {
    session: {
      startTime: new Date(SYN_START),
      totalElapsedTime: 1230.0,
      avgHeartRate: 86,
      subSport: over.subSport ?? 'singleGasDiving',
      startPositionLat: 339274237,
      startPositionLong: 411110331,
      endPositionLat: 339271676,
      endPositionLong: 411106879,
    },
    activity: { timestamp: new Date(SYN_START), localTimestamp: SYN_LOCAL_SECS, numSessions: 1 },
    records: rowsToRecords(DEFAULT_ROWS),
    diveSummaries: [
      {
        referenceMesg: 'session',
        avgDepth: 9.6,
        startCns: 0,
        endCns: 4,
        avgVolumeSac: 13.4,
        avgPressureSac: 1.11,
      },
    ],
    device: {
      manufacturer: 'garmin',
      productName: 'Descent Mk2',
      serialNumber: 3386258516,
      softwareVersion: 28.0,
    },
    subSport: over.subSport ?? 'singleGasDiving',
    diveGas: { oxygenContent: 21 },
    diveSettings: { gfLow: 40, gfHigh: 85, waterType: 'salt' },
    tankUpdates: [
      { timestamp: new Date(SYN_START), pressure: 200.0 },
      { timestamp: new Date(SYN_START + 20_000), pressure: 120.0 },
    ],
    tankSummary: { startPressure: 200.0, endPressure: 120.0 },
    startPosition: null,
    endPosition: null,
  };
  const { subSport: _drop, ...rest } = over;
  return { ...base, ...rest };
}

const syntheticApnea = (over: Partial<ParsedFit> = {}): ParsedFit =>
  syntheticScuba({ subSport: 'apneaDiving', ...over });

// --- convert dispatch ---------------------------------------------------

describe('convertToSsiPayload dispatch', () => {
  it('apnea sub_sport takes the apnea path', () => {
    const payload = convertToSsiPayload(syntheticScuba({ subSport: 'apneaDiving' }));
    expect(payload.odin_user_log_alarmDataset).toBe('[]');
    expect(payload.odin_user_log_tankPressureDataset).toBe('');
    expect(payload).not.toHaveProperty('odin_user_log_gf_set');
    expect(payload).not.toHaveProperty('odin_user_log_pressure_start_bar');
    expect(payload).not.toHaveProperty('odin_user_log_var_watertype_id');
    const samples = JSON.parse(payload.odin_user_log_diveSamples as string);
    expect(samples.every((s: any) => s.ndl === null && s.a === 0)).toBe(true);
    expect(samples.every((s: any) => !('pressure' in s))).toBe(true);
  });

  it('unknown sub_sport warns but still converts', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const payload = convertToSsiPayload(syntheticScuba({ subSport: 'whatever' }));
    const err = spy.mock.calls.map((c) => String(c[0])).join('');
    spy.mockRestore();
    expect(payload.odin_user_log_divetime).toBe(20);
    expect(err).toContain('not a known scuba type');
  });
});

// --- convert scuba ----------------------------------------------------

describe('convertScuba', () => {
  it('header fields', () => {
    const payload = convertToSsiPayload(syntheticScuba());

    expect(payload.odin_user_log_datetime).toBe('2025-06-01 08:00'); // +03:00
    expect(payload.odin_user_log_date).toBe('2025-06-01');
    expect(payload.odin_user_log_divetime).toBe(20);
    expect(payload.odin_user_log_depth_m).toBe(20.0);
    expect(payload.odin_user_log_avg_depth_m).toBe(9.6); // from dive_summary
    expect(payload.odin_user_log_watertemp_c).toBe(25);
    expect(payload.odin_user_log_watertemp_max_c).toBe(27);
    expect(payload.odin_user_log_ean).toBe(0);
    expect(payload.odin_user_log_ean_percent).toBe(0);
    expect(payload.odin_user_log_pressure_start_bar).toBe(200);
    expect(payload.odin_user_log_pressure_start_psi).toBe(roundHalfToEven(200.0 / 0.0689476));
    expect(payload.odin_user_log_pressure_end_bar).toBe(120);
    expect(payload.odin_user_log_gf_set).toBe('40 / 85');
    expect(payload.odin_user_log_gf_set_1).toBe(40);
    expect(payload.odin_user_log_gf_set_2).toBe(85);
    expect(payload.odin_user_log_cns_start).toBe(0);
    expect(payload.odin_user_log_cns_end).toBe(4);
    expect(payload.odin_user_log_amv_l).toBe(13.4);
    expect(payload.odin_user_log_amv_psi).toBe(1.11);
    expect(payload.odin_user_log_var_watertype_id).toBe(4);
    expect(payload.odin_user_log_divecomputer_manufacturer).toBe('Garmin');
    expect(payload.odin_user_log_divecomputer_firmware).toBe('28');
    expect(payload.odin_user_log_divecomputer_imported).toBe(true);
    expect(Math.abs((payload.odin_user_log_pos_start_latitude as number) - 28.4376)).toBeLessThan(1e-3);
    expect(Math.abs((payload.log_extended_data_longitude as number) - 34.4589)).toBeLessThan(1e-3);
    expect(payload).toHaveProperty('odin_user_log_pos_end_latitude');
  });

  it('datasets are equal length and there is no hr key on samples', () => {
    const payload = convertToSsiPayload(syntheticScuba());
    const samples = JSON.parse(payload.odin_user_log_diveSamples as string);
    const n = samples.length;
    for (const key of [
      'odin_user_log_depthDataset',
      'odin_user_log_tempDataset',
      'odin_user_log_heartRateDataset',
      'odin_user_log_tankPressureDataset',
      'odin_user_log_gfSurfDataset',
      'odin_user_log_gfnowDataset',
    ]) {
      expect(JSON.parse(payload[key] as string).length).toBe(n);
    }
    expect(payload.odin_user_log_deepestDecoDataset).toBe('');
    expect('hr' in samples[0]).toBe(false);
    expect('heart_rate' in samples[0]).toBe(false);
    // o/dr stay real booleans; the float-typed sample keys are forced to render
    // with a decimal point so SSI's type-strict parser keeps them as doubles.
    expect(payload.odin_user_log_diveSamples).toContain('"o":false');
    expect(payload.odin_user_log_diveSamples).toContain('"gs":0.0');
    expect(payload.odin_user_log_diveSamples).toContain('"gn":0.0');
    expect(payload.odin_user_log_diveSamples).toContain('"rv":3.0');
    expect((payload.odin_user_log_gfSurfDataset as string).startsWith('[0.0,')).toBe(true);
  });

  it('integer temperature still serializes `te` as a double (X.0)', () => {
    // DEFAULT_ROWS temps are whole numbers (27/26/25). Unlike fit_ssi_convert.py
    // (whose `round(int, 1)` yields an int), the port forces `te` to a double.
    const payload = convertToSsiPayload(syntheticScuba());
    const raw = payload.odin_user_log_diveSamples as string;
    expect(raw).toMatch(/"te":2[567]\.0/);
    expect(raw).not.toMatch(/"te":2[567][,}]/); // never a bare int
    const tempDs = payload.odin_user_log_tempDataset as string;
    expect(tempDs).toMatch(/\d\.0/);
    expect(tempDs).not.toMatch(/(^|[,[])2[567]([,\]])/);
    // the parsed values are still numerically whole
    expect(JSON.parse(tempDs).every((t: number) => Number.isInteger(t))).toBe(true);
  });

  it('no tank data omits pressure', () => {
    const payload = convertToSsiPayload(syntheticScuba({ tankUpdates: [], tankSummary: {} }));
    expect(payload).not.toHaveProperty('odin_user_log_pressure_start_bar');
    expect(payload.odin_user_log_tankPressureDataset).toBe('');
    const samples = JSON.parse(payload.odin_user_log_diveSamples as string);
    expect(samples.every((s: any) => !('pressure' in s))).toBe(true);
  });

  it('fresh water omits watertype', () => {
    const payload = convertToSsiPayload(
      syntheticScuba({ diveSettings: { gfLow: 40, gfHigh: 85, waterType: 'fresh' } }),
    );
    expect(payload).not.toHaveProperty('odin_user_log_var_watertype_id');
  });

  it('nitrox gas', () => {
    const payload = convertToSsiPayload(syntheticScuba({ diveGas: { oxygenContent: 32 } }));
    expect(payload.odin_user_log_ean).toBe(1);
    expect(payload.odin_user_log_ean_percent).toBe(32);
  });

  it('alarm dataset wiring is sparse and 1-based', () => {
    const rows: SynRow[] = [
      [0, 0.3, 0.0, 26, 85, null],
      [5, 18.0, 0.0, 26, 85, null],
      [10, 12.0, 0.13, 26, 85, null], // s = 7.8, above the 6.0 warning threshold
      [15, 8.0, 0.0, 26, 85, null],
      [20, 0.2, 0.0, 26, 85, null],
    ];
    const payload = convertToSsiPayload(syntheticScuba({ records: rowsToRecords(rows) }));
    const samples = JSON.parse(payload.odin_user_log_diveSamples as string);
    const fastIdx = samples.findIndex((s: any) => Math.abs(s.s - 7.8) < 1e-9);

    const alarms = JSON.parse(payload.odin_user_log_alarmDataset as string);
    expect(alarms.length).toBe(1);
    const entry = alarms[0];
    expect(entry.speed).toBe(true);
    expect(entry.fast_ascent).toBe(true);
    expect(entry.deco).toBe(false);
    expect(entry.violation).toBe(false);
    expect(entry.position).toBe(fastIdx + 1);
  });

  it('missing device info', () => {
    const payload = convertToSsiPayload(
      syntheticScuba({
        device: {
          manufacturer: 'garmin',
          productName: 'Descent Mk2',
          serialNumber: null,
          softwareVersion: null,
        },
      }),
    );
    expect(payload.odin_user_log_divecomputer_firmware).toBe('');
    expect(payload.odin_user_log_divecomputer_serial_nr).toBe('');
  });

  it('real fixture', () => {
    const payload = convertToSsiPayload(parseFit(scubaBytes()));

    expect(payload.odin_user_log_datetime).toBe('2025-10-28 11:06');
    expect(payload.odin_user_log_divetime).toBe(49);
    expect(Math.abs((payload.odin_user_log_depth_m as number) - 40.1)).toBeLessThan(0.15);
    expect(payload.odin_user_log_avg_depth_m).toBe(13.5);
    expect(payload.odin_user_log_watertemp_c).toBe(26);
    expect(payload.odin_user_log_watertemp_max_c).toBe(27);
    expect(payload.odin_user_log_ean).toBe(0);
    expect(payload.odin_user_log_gf_set).toBe('40 / 85');
    expect(payload.odin_user_log_pressure_start_bar).toBe(194); // roundHalfToEven(194.5) -> 194
    expect(payload.odin_user_log_pressure_end_bar).toBe(79);
    expect(payload.odin_user_log_cns_end).toBe(3);
    expect(payload.odin_user_log_var_watertype_id).toBe(4);
    expect(payload.odin_user_log_divecomputer_serial_nr).toBe('3386258516');
    expect(Math.abs((payload.odin_user_log_pos_start_latitude as number) - 28.437638)).toBeLessThan(1e-4);
    expect(Math.abs((payload.odin_user_log_pos_start_longitude as number) - 34.458870)).toBeLessThan(1e-4);

    const samples = JSON.parse(payload.odin_user_log_diveSamples as string);
    expect(samples.length).toBe(592);
    expect(samples[0].t).toBe(0);
    for (const k of ['n', 't', 'd', 's', 'te', 'ndl', 'gs', 'gn', 'a', 'mf', 'o', 'dr', 'rv']) {
      expect(samples[0]).toHaveProperty(k);
    }
    expect('hr' in samples[0]).toBe(false);
    for (const key of [
      'odin_user_log_depthDataset',
      'odin_user_log_tempDataset',
      'odin_user_log_heartRateDataset',
      'odin_user_log_tankPressureDataset',
    ]) {
      expect(JSON.parse(payload[key] as string).length).toBe(592);
    }

    // T3 fix: the datasets are string-serialized with forced doubles so SSI's
    // type-strict parser keeps them as floats. Assert the actual rendering, not
    // just the element count (previously only gfSurfDataset guarded this).
    const depthDs = payload.odin_user_log_depthDataset as string;
    expect(depthDs.startsWith('[')).toBe(true);
    expect(depthDs).toContain('.'); // at least one decimal point
    expect(payload.odin_user_log_tankPressureDataset as string).toMatch(/\d\.\d/);
  });
});

// --- UDDF cross-check --------------------------------------------------

function uddfWaypoints(url: URL): Array<[number, number]> {
  const xml = readFileSync(url, 'utf8');
  const out: Array<[number, number]> = [];
  for (const m of xml.matchAll(/<waypoint>([\s\S]*?)<\/waypoint>/g)) {
    const d = /<depth>([^<]+)<\/depth>/.exec(m[1]);
    const t = /<divetime>([^<]+)<\/divetime>/.exec(m[1]);
    if (d && t) out.push([parseFloat(t[1]), parseFloat(d[1])]);
  }
  return out;
}

function uddfTankBar(url: URL): [number, number] {
  const xml = readFileSync(url, 'utf8');
  const b = /<tankpressurebegin>([^<]+)<\/tankpressurebegin>/.exec(xml)!;
  const e = /<tankpressureend>([^<]+)<\/tankpressureend>/.exec(xml)!;
  return [parseFloat(b[1]) / 1e5, parseFloat(e[1]) / 1e5];
}

describe('scuba converter agrees with the sibling UDDF', () => {
  it('depth / divetime / tank pressure / per-sample depth align', () => {
    const payload = convertToSsiPayload(parseFit(scubaBytes()));
    const wps = uddfWaypoints(SCUBA_UDDF);
    expect(wps.length).toBeGreaterThan(1000);

    const uddfMaxDepth = Math.max(...wps.map(([, d]) => d));
    const uddfMaxTime = Math.max(...wps.map(([t]) => t));
    const [ub, ue] = uddfTankBar(SCUBA_UDDF);

    expect(Math.abs((payload.odin_user_log_depth_m as number) - uddfMaxDepth)).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs((payload.odin_user_log_divetime as number) - Math.round(uddfMaxTime / 60)),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs((payload.odin_user_log_pressure_start_bar as number) - ub)).toBeLessThanOrEqual(3);
    expect(Math.abs((payload.odin_user_log_pressure_end_bar as number) - ue)).toBeLessThanOrEqual(3);

    const samples = JSON.parse(payload.odin_user_log_diveSamples as string);
    const byTime = [...wps].sort((a, b) => a[0] - b[0]);
    const step = Math.max(1, Math.floor(samples.length / 5));
    for (let i = 0; i < samples.length; i += step) {
      const s = samples[i];
      const tS = s.t / 1000;
      let best = byTime[0];
      for (const td of byTime) {
        if (Math.abs(td[0] - tS) < Math.abs(best[0] - tS)) best = td;
      }
      expect(Math.abs(s.d - best[1])).toBeLessThanOrEqual(0.7);
    }
  });
});

// --- convert apnea --------------------------------------------------

describe('convertApnea', () => {
  it('header fields', () => {
    const payload = convertToSsiPayload(syntheticApnea());
    expect(payload.odin_user_log_datetime).toBe('2025-06-01 08:00');
    expect(payload.odin_user_log_divetime).toBe(20);
    expect(payload.odin_user_log_depth_m).toBe(20.0);
    expect(payload.odin_user_log_avg_depth_m).toBe(Number(((8 + 20 + 6) / 3).toFixed(1))); // 11.3
    expect(payload.odin_user_log_watertemp_c).toBe(25);
    expect(payload.odin_user_log_watertemp_max_c).toBe(27);
    expect(payload.odin_user_log_heartRateMin).toBe(70);
    expect(payload.odin_user_log_heartRateMax).toBe(95);
    expect(payload.odin_user_log_heartRateAvg).toBe(86);
    expect(payload.odin_user_log_ean).toBe(0);
    expect(payload.odin_user_log_ean_percent).toBe(0);
    expect(payload.odin_user_log_dive_type).toBe(0);
    expect(payload.odin_user_log_divecomputer_manufacturer).toBe('Garmin');
    expect(payload.odin_user_log_divecomputer_firmware).toBe('28');
    expect(payload.odin_user_log_divecomputer_imported).toBe(true);
    for (const k of [
      'odin_user_log_gf_set',
      'odin_user_log_cns_start',
      'odin_user_log_amv_l',
      'odin_user_log_pos_start_latitude',
      'log_extended_data_latitude',
    ]) {
      expect(payload).not.toHaveProperty(k);
    }
  });

  it('avg depth falls back to plain mean when all samples are shallow', () => {
    const start = Date.UTC(2025, 5, 1, 5, 0, 0);
    const recs: FitRecord[] = ([[0, 0.1], [5, 0.3], [10, 0.2]] as Array<[number, number]>).map(
      ([t, d]) => ({
        timestamp: new Date(start + t * 1000),
        depth: d,
        ascentRate: 0.0,
        temperature: 26,
        heartRate: 70,
      }),
    );
    const payload = convertToSsiPayload(
      syntheticApnea({
        records: recs,
        session: {
          startTime: new Date(start),
          totalElapsedTime: 60.0,
          avgHeartRate: 70,
          subSport: 'apneaDiving',
        },
        activity: {
          timestamp: new Date(start),
          localTimestamp: Math.trunc((start + 3 * 3600 * 1000 - FIT_EPOCH_MS) / 1000),
          numSessions: 1,
        },
      }),
    );
    expect(payload.odin_user_log_avg_depth_m).toBe(0.2);
    expect(payload.odin_user_log_depth_m).toBe(0.3);
  });

  it('emits only the generic key set', () => {
    const payload = convertToSsiPayload(syntheticApnea());
    expect(new Set(Object.keys(payload))).toEqual(
      new Set([
        'odin_user_log_datetime',
        'odin_user_log_date',
        'odin_user_log_entry_time',
        'odin_user_log_divetime',
        'odin_user_log_dive_type',
        'odin_user_log_depth_m',
        'odin_user_log_depth_ft',
        'odin_user_log_avg_depth_m',
        'odin_user_log_avg_depth_ft',
        'odin_user_log_ean',
        'odin_user_log_ean_percent',
        'odin_user_log_diveSamples',
        'odin_user_log_depthDataset',
        'odin_user_log_tempDataset',
        'odin_user_log_heartRateDataset',
        'odin_user_log_gfSurfDataset',
        'odin_user_log_gfnowDataset',
        'odin_user_log_deepestDecoDataset',
        'odin_user_log_alarmDataset',
        'odin_user_log_tankPressureDataset',
        'odin_user_log_diveComputer',
        'odin_user_log_diveComputerData',
        'odin_user_log_divecomputer_manufacturer',
        'odin_user_log_divecomputer_name',
        'odin_user_log_divecomputer_ref',
        'odin_user_log_divecomputer_dive_ref',
        'odin_user_log_divecomputer_serial_nr',
        'odin_user_log_divecomputer_firmware',
        'odin_user_log_divecomputer_imported',
        'odin_user_log_watertemp_c',
        'odin_user_log_watertemp_f',
        'odin_user_log_watertemp_max_c',
        'odin_user_log_watertemp_max_f',
        'odin_user_log_heartRateMin',
        'odin_user_log_heartRateMax',
        'odin_user_log_heartRateAvg',
      ]),
    );
  });

  it('datasets are equal length', () => {
    const payload = convertToSsiPayload(syntheticApnea());
    const samples = JSON.parse(payload.odin_user_log_diveSamples as string);
    const n = samples.length;
    for (const key of [
      'odin_user_log_depthDataset',
      'odin_user_log_tempDataset',
      'odin_user_log_heartRateDataset',
      'odin_user_log_gfSurfDataset',
      'odin_user_log_gfnowDataset',
    ]) {
      expect(JSON.parse(payload[key] as string).length).toBe(n);
    }
    expect(payload.odin_user_log_deepestDecoDataset).toBe('');
    expect(payload.odin_user_log_alarmDataset).toBe('[]');
    expect(payload.odin_user_log_tankPressureDataset).toBe('');
    expect('hr' in samples[0]).toBe(false);
    expect(payload.odin_user_log_diveSamples).toContain('"o":false');
    expect(payload.odin_user_log_diveSamples).toContain('"rv":3.0');
    expect((payload.odin_user_log_gfSurfDataset as string).startsWith('[0.0,')).toBe(true);
  });

  it('real fixture', () => {
    const payload = convertToSsiPayload(parseFit(apneaBytes()));
    expect(payload.odin_user_log_datetime).toBe('2025-10-16 18:13');
    expect(payload.odin_user_log_divetime).toBe(111);
    expect(payload.odin_user_log_depth_m).toBe(7.8);
    expect(payload.odin_user_log_avg_depth_m).toBe(4.6);
    expect(payload.odin_user_log_watertemp_c).toBe(30);
    expect(payload.odin_user_log_watertemp_max_c).toBe(31);
    expect(payload.odin_user_log_heartRateMin).toBe(51);
    expect(payload.odin_user_log_heartRateMax).toBe(107);
    expect(payload.odin_user_log_heartRateAvg).toBe(82);
    expect(payload.odin_user_log_divecomputer_serial_nr).toBe('3386258516');

    const samples = JSON.parse(payload.odin_user_log_diveSamples as string);
    expect(samples.length).toBe(1333);
    expect(samples[0].t).toBe(0);
    expect(samples[0].s).toBe(-15.0);
    expect(samples[0].mf).toBe(0x08000000);
    expect(new Set(Object.keys(samples[0]))).toEqual(
      new Set(['n', 't', 'd', 's', 'te', 'ndl', 'gs', 'gn', 'a', 'mf', 'o', 'dr', 'rv']),
    );
    for (const key of [
      'odin_user_log_depthDataset',
      'odin_user_log_tempDataset',
      'odin_user_log_heartRateDataset',
    ]) {
      expect(JSON.parse(payload[key] as string).length).toBe(1333);
    }
    for (const k of [
      'odin_user_log_gf_set',
      'odin_user_log_pressure_start_bar',
      'odin_user_log_var_watertype_id',
      'odin_user_log_pos_start_latitude',
    ]) {
      expect(payload).not.toHaveProperty(k);
    }

    // Deliberate deviation from fit_ssi_convert.py: `te` is widened to a double.
    // This fixture's temps are whole numbers (30/31), so `round(int, 1)` in the
    // Python would emit a bare int (`"te":31` / `[31,...]`); the TS port forces
    // `"te":31.0` / `[31.0,...]` to match the real SSI payload + Swift/Shearwater
    // transformer. Assert the string rendering so a regression is loud.
    expect(payload.odin_user_log_diveSamples as string).toContain('"te":31.0');
    const tempDs = payload.odin_user_log_tempDataset as string;
    expect(tempDs).toContain('31.0');
    expect(tempDs).not.toMatch(/(^|[,[])31([,\]])/); // no bare integer "31," / "31]"

    // T3 fix (forced doubles) — widen the guard past gfSurfDataset.
    const depthDs = payload.odin_user_log_depthDataset as string;
    expect(depthDs.startsWith('[')).toBe(true);
    expect(depthDs).toContain('.');
  });
});
