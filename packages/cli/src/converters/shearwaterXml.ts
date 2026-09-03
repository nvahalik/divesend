// Faithful 1:1 port of shearwater_xml_convert.py.
//
// Convert a Shearwater Cloud XML dive export into the field schema SSI's
// save_divelog payload expects. See the Python module's docstring for how
// each field/quirk was confirmed against a real captured dive.
//
// Shearwater's XML always ships a bogus `encoding="utf-16"` declaration even
// though the bytes are UTF-8/ASCII; we patch the declaration before parsing
// (matching the Python `re.sub(..., count=1)`).
//
// Unit handling: when <imperialUnits> is "true", <currentDepth> is feet,
// <waterTemp> is Fahrenheit, and *PSI tank pressures are PSI.

import { XMLParser } from 'fast-xml-parser';
import {
  FT_TO_M,
  PSI_TO_BAR,
  roundHalfToEven,
  divePhaseBits,
  ascentAlarmBits,
  alarmDataset,
  serializeWithForcedDoubles,
  SAMPLE_DOUBLE_FIELDS,
  type SsiSample,
  type CanonicalDive,
  type DiveHeader,
  type DiveSample,
} from '@divesend/core';

// Confirmed from a real export cross-checked against its UDDF sibling.
export const PRODUCT_CODES: Record<number, string> = {
  8: 'Teric',
};

const forceSampleDoubles = (path: (string | number)[]): boolean =>
  typeof path[1] === 'string' && SAMPLE_DOUBLE_FIELDS.has(path[1]);

export interface ParsedShearwater {
  header: Record<string, string | null>;
  records: Array<Record<string, string | null>>;
}

/**
 * Port of `_num`: parse a field that's sometimes a real value and sometimes
 * a placeholder like "N/A" / "AI is off". `null` / empty / non-numeric -> null.
 */
export function num(text: string | null | undefined, cast: 'float' | 'int' = 'float'): number | null {
  if (text == null) return null;
  const t = text.trim();
  if (t === '') return null;
  if (cast === 'int') {
    if (!/^[+-]?\d+$/.test(t)) return null;
    return parseInt(t, 10);
  }
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

function textVal(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v === '' ? null : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // element had attributes/children — take '#text' if present
  const t = (v as Record<string, unknown>)['#text'];
  return t == null ? null : String(t);
}

/** Port of `parse_shearwater_xml`, taking text instead of a path. */
export function parseShearwaterXml(xmlText: string): ParsedShearwater {
  const patched = xmlText.replace(/encoding="utf-16"/, 'encoding="utf-8"');
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
  });
  const root = parser.parse(patched) as Record<string, any>;

  let diveLog: Record<string, any> | undefined;
  if (root.diveLog) {
    diveLog = root.diveLog;
  } else {
    for (const v of Object.values(root)) {
      if (v && typeof v === 'object' && 'diveLog' in v) {
        diveLog = (v as Record<string, any>).diveLog;
        break;
      }
    }
  }
  if (!diveLog) throw new Error('no <diveLog> element in Shearwater XML');

  const header: Record<string, string | null> = {};
  for (const [tag, value] of Object.entries(diveLog)) {
    if (tag === 'diveLogRecords') continue;
    header[tag] = textVal(value);
  }

  const recContainer = diveLog.diveLogRecords;
  let rawRecords: Record<string, any>[] = [];
  if (recContainer && typeof recContainer === 'object') {
    const r = recContainer.diveLogRecord;
    rawRecords = Array.isArray(r) ? r : r != null ? [r] : [];
  }
  const records = rawRecords.map((rec) => {
    const out: Record<string, string | null> = {};
    for (const [tag, value] of Object.entries(rec)) {
      out[tag] = textVal(value);
    }
    return out;
  });

  return { header, records };
}

interface NaiveDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Port of `_parse_shearwater_datetime` ("%m/%d/%Y %I:%M:%S %p"). */
export function parseShearwaterDatetime(value: string): NaiveDateTime {
  const m = value
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!m) throw new Error(`unrecognised Shearwater datetime: ${JSON.stringify(value)}`);
  let hour = parseInt(m[4], 10) % 12;
  if (m[7].toUpperCase() === 'PM') hour += 12;
  return {
    year: parseInt(m[3], 10),
    month: parseInt(m[1], 10),
    day: parseInt(m[2], 10),
    hour,
    minute: parseInt(m[5], 10),
    second: parseInt(m[6], 10),
  };
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

function fmtDate(d: NaiveDateTime): string {
  return `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;
}
function fmtDateTime(d: NaiveDateTime): string {
  return `${fmtDate(d)} ${pad(d.hour)}:${pad(d.minute)}`;
}
function fmtTime(d: NaiveDateTime): string {
  return `${pad(d.hour)}:${pad(d.minute)}`;
}
/** naive `datetime.isoformat(timespec="milliseconds")`. */
function fmtIsoMs(d: NaiveDateTime): string {
  return `${fmtDate(d)}T${pad(d.hour)}:${pad(d.minute)}:${pad(d.second)}.000`;
}

/** Port of `_build_samples`. */
export function buildSamples(
  records: Array<Record<string, string | null>>,
  imperial: boolean,
): SsiSample[] {
  const samples: SsiSample[] = [];
  let prevDepthM: number | null = null;
  let prevTimeS: number | null = null;

  records.forEach((rec, i) => {
    const timeMs = num(rec.currentTime, 'int') ?? 0;
    const rawDepth = num(rec.currentDepth) ?? 0.0;
    const depthM = imperial ? rawDepth * FT_TO_M : rawDepth;

    const rawTemp = num(rec.waterTemp);
    const tempC = imperial && rawTemp !== null ? ((rawTemp - 32) * 5) / 9 : rawTemp;

    let ndl = num(rec.currentNdl, 'int');
    if (ndl !== null) ndl = Math.min(ndl, 99);

    const tank0 = num(rec.tank0pressurePSI);
    const pressureBar =
      imperial && tank0 !== null ? roundHalfToEven(tank0 * PSI_TO_BAR, 2) : tank0;

    const timeS = timeMs / 1000;
    let speed: number;
    if (prevDepthM !== null && prevTimeS !== null && timeS > prevTimeS) {
      const dtMin = (timeS - prevTimeS) / 60;
      speed = roundHalfToEven((prevDepthM - depthM) / dtMin, 1);
    } else {
      speed = 0.0;
    }

    const firstStop = num(rec.firstStopDepth, 'int') ?? 0;
    const decoRequired = firstStop > 0;

    const sample: SsiSample = {
      n: i + 1,
      t: timeMs,
      d: roundHalfToEven(depthM, 2),
      s: speed,
      te: tempC !== null ? roundHalfToEven(tempC, 1) : null,
      ndl,
      gs: 0.0,
      gn: 0.0,
      a: speed > 0 ? ascentAlarmBits(speed) : 0,
      mf: divePhaseBits(depthM),
      o: false,
      dr: decoRequired,
      rv: 3.0,
    };
    if (pressureBar !== null) sample.pressure = pressureBar;

    samples.push(sample);
    prevDepthM = depthM;
    prevTimeS = timeS;
  });

  return samples;
}

/** Port of `convert_to_ssi_payload`. */
export function convertToSsiPayload(parsed: ParsedShearwater): Record<string, unknown> {
  const { header, records } = parsed;
  const imperial = header.imperialUnits === 'true';

  const samples = buildSamples(records, imperial);
  const depthsM = samples.map((s) => s.d);
  const tempsC = samples.filter((s) => s.te !== null).map((s) => s.te as number);
  const pressuresBar = samples.filter((s) => s.pressure !== undefined).map((s) => s.pressure as number);

  const maxDepthRaw = Number(header.maxDepth);
  const maxDepthM = imperial ? maxDepthRaw * FT_TO_M : maxDepthRaw;
  const avgDepthM = depthsM.length ? depthsM.reduce((a, b) => a + b, 0) / depthsM.length : 0;

  const divetimeMin = roundHalfToEven(parseInt(header.maxTime ?? '0', 10) / 60);

  const startDt = parseShearwaterDatetime(header.startDate ?? '');

  const productCode = header.product != null ? parseInt(header.product, 10) : -1;
  const model = PRODUCT_CODES[productCode] ?? `Shearwater (product ${productCode})`;

  const firstFracRaw = records.length ? records[0].fractionO2 : null;
  const o2Fraction =
    firstFracRaw != null && firstFracRaw.trim() !== '' ? Number(firstFracRaw) : 0.21;
  const isNitrox = o2Fraction > 0.22;

  const payload: Record<string, unknown> = {
    odin_user_log_datetime: fmtDateTime(startDt),
    odin_user_log_date: fmtDate(startDt),
    odin_user_log_entry_time: fmtTime(startDt),
    odin_user_log_depth_m: roundHalfToEven(maxDepthM, 1),
    odin_user_log_depth_ft: roundHalfToEven(maxDepthM / FT_TO_M, 1),
    odin_user_log_avg_depth_m: roundHalfToEven(avgDepthM, 1),
    odin_user_log_avg_depth_ft: roundHalfToEven(avgDepthM / FT_TO_M, 1),
    odin_user_log_divetime: divetimeMin,
    odin_user_log_ean: isNitrox ? 1 : 0,
    odin_user_log_ean_percent: isNitrox ? roundHalfToEven(o2Fraction * 100) : 0,
    odin_user_log_cns_start: num(header.startCns, 'int'),
    odin_user_log_cns_end: num(header.endCns, 'int'),
    odin_user_log_gf_set: `${header.gfMin} / ${header.gfMax}`,
    odin_user_log_gf_set_1: num(header.gfMin, 'int'),
    odin_user_log_gf_set_2: num(header.gfMax, 'int'),
    odin_user_log_diveComputer: '',
    odin_user_log_divecomputer_manufacturer: 'Shearwater',
    odin_user_log_divecomputer_name: model,
    odin_user_log_divecomputer_ref: model,
    odin_user_log_divecomputer_dive_ref: `${fmtIsoMs(startDt)}_0`,
    odin_user_log_divecomputer_serial_nr: header.computerSerial,
    odin_user_log_divecomputer_firmware: header.computerFirmware,
    odin_user_log_divecomputer_imported: true,
    odin_user_log_diveSamples: serializeWithForcedDoubles(samples, forceSampleDoubles),
    odin_user_log_depthDataset: serializeWithForcedDoubles(
      samples.map((s) => s.d),
      () => true,
    ),
    odin_user_log_tempDataset: serializeWithForcedDoubles(
      samples.map((s) => s.te),
      () => true,
    ),
    odin_user_log_gfSurfDataset: serializeWithForcedDoubles(
      samples.map((s) => s.gs),
      () => true,
    ),
    odin_user_log_gfnowDataset: serializeWithForcedDoubles(
      samples.map((s) => s.gn),
      () => true,
    ),
    odin_user_log_alarmDataset: alarmDataset(samples),
  };

  if (tempsC.length) {
    const lo = Math.min(...tempsC);
    const hi = Math.max(...tempsC);
    payload.odin_user_log_watertemp_c = roundHalfToEven(lo, 1);
    payload.odin_user_log_watertemp_f = roundHalfToEven((lo * 9) / 5 + 32, 1);
    payload.odin_user_log_watertemp_max_c = roundHalfToEven(hi, 1);
    payload.odin_user_log_watertemp_max_f = roundHalfToEven((hi * 9) / 5 + 32, 1);
  }

  if (pressuresBar.length) {
    payload.odin_user_log_pressure_start_bar = pressuresBar[0];
    payload.odin_user_log_pressure_start_psi = roundHalfToEven(pressuresBar[0] / PSI_TO_BAR);
    payload.odin_user_log_pressure_end_bar = pressuresBar[pressuresBar.length - 1];
    payload.odin_user_log_pressure_end_psi = roundHalfToEven(
      pressuresBar[pressuresBar.length - 1] / PSI_TO_BAR,
    );
    payload.odin_user_log_tankPressureDataset = serializeWithForcedDoubles(
      samples.map((s) => (s.pressure !== undefined ? s.pressure : null)),
      () => true,
    );
  }

  return payload;
}

/**
 * Thin projection of a parsed Shearwater dive onto `@divesend/core`'s
 * `CanonicalDive` -- the shape `toUddf` consumes. Used only by `divesend
 * convert --to uddf`: it carries the depth / time / temperature / tank-pressure
 * profile plus the gas, gradient-factor, device and start-time header fields
 * UDDF needs, and leaves the SSI-only extras (CNS, alarm bits, firmware)
 * behind. The SSI path (`convertToSsiPayload`) does NOT route through here.
 */
export function toCanonicalDive(parsed: ParsedShearwater): CanonicalDive {
  const { header, records } = parsed;
  const imperial = header.imperialUnits === 'true';
  const ssiSamples = buildSamples(records, imperial);

  const samples: DiveSample[] = ssiSamples.map((s) => ({
    timeS: s.t / 1000,
    depthM: s.d,
    tempC: s.te,
    ndlS: s.ndl != null ? s.ndl * 60 : null,
    tankPressureBar: s.pressure ?? null,
    decoStopDepthM: null,
    ttsS: null,
  }));

  const withPressure = samples.filter((s) => s.tankPressureBar != null);

  const maxDepthRaw = Number(header.maxDepth);
  const maxDepthM = Number.isFinite(maxDepthRaw)
    ? roundHalfToEven(imperial ? maxDepthRaw * FT_TO_M : maxDepthRaw, 2)
    : samples.length
      ? Math.max(...samples.map((s) => s.depthM))
      : 0;

  const productCode = header.product != null ? parseInt(header.product, 10) : -1;
  const model = PRODUCT_CODES[productCode] ?? `Shearwater (product ${productCode})`;

  const firstFracRaw = records.length ? records[0].fractionO2 : null;
  const o2Fraction =
    firstFracRaw != null && firstFracRaw.trim() !== '' ? Number(firstFracRaw) : 0.21;

  const startDt = parseShearwaterDatetime(header.startDate ?? '');

  const canonicalHeader: DiveHeader = {
    startTime: fmtIsoMs(startDt),
    maxDepthM,
    gasO2Percent: roundHalfToEven(o2Fraction * 100, 1),
    gasHePercent: 0,
    tankBeginPressureBar: withPressure.length ? withPressure[0].tankPressureBar : null,
    tankEndPressureBar: withPressure.length
      ? withPressure[withPressure.length - 1].tankPressureBar
      : null,
    diveMode: 'oc',
    decoModel: 'buhlmann',
    gfLow: num(header.gfMin, 'int') ?? 0,
    gfHigh: num(header.gfMax, 'int') ?? 0,
    salinity: 'salt',
    deviceModel: model,
    divetimeS: parseInt(header.maxTime ?? '0', 10) || 0,
    minTemperatureC: null,
    maxTemperatureC: null,
    cnsPercent: null,
  };

  return { header: canonicalHeader, samples };
}
