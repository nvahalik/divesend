// Faithful 1:1 port of fit_ssi_convert.py.
//
// Convert a Garmin Descent Mk2 .fit activity file into the field schema SSI's
// app API (divelog_api_client.py / ssi/client.ts) expects for a save_divelog
// payload -- one SSI divelog per FIT file.
//
// parseFit() produces a plain normalized object, then convertToSsiPayload() is a
// pure transform that dispatches on the dive's sub_sport:
//
//   * singleGasDiving / multiGasDiving / gaugeDiving -> scuba path
//     (gas, tank pressure, GF, CNS, SAC, GPS, per-sample NDL/deco).
//   * apneaDiving -> apnea path: whole-session profile, generic SSI schema
//     only (no gas/tank/GF/deco), alarms suppressed, ndl null.
// Both paths downsample the profile to 5 s (SSI's native sample cadence).
//
// NOTE on the FIT SDK: the Python garmin_fit_sdk yields snake_case message +
// field names and snake_case enum string values (e.g. "single_gas_diving").
// @garmin/fitsdk (JS) yields camelCase message keys, camelCase field names, and
// camelCase enum string values (e.g. "singleGasDiving", "descentMk2",
// "creator", "session", "salt"). This port targets the JS SDK's names.

import { Decoder, Stream } from '@garmin/fitsdk';
import {
  FT_TO_M,
  PSI_TO_BAR,
  SEMICIRCLE_TO_DEG,
  FIT_EPOCH_MS,
  NDL_CAP,
  roundHalfToEven,
  divePhaseBits,
  ascentAlarmBits,
  ALARM_FLAGS,
  serializeWithForcedDoubles,
  SAMPLE_DOUBLE_FIELDS,
  type SsiSample,
  type CanonicalDive,
  type DiveHeader,
  type DiveSample,
} from '@divesend/core';

/**
 * Sample-object serializer: force the float-typed sample keys to render "6.0".
 *
 * `SAMPLE_DOUBLE_FIELDS` includes `te`, so an integer temperature renders as
 * `"te":26.0` here. This is an intentional deviation from `fit_ssi_convert.py`,
 * whose `"te": round(temp, 1)` returns an *int* (`round(int, 1)` -> `int`) only
 * because FIT's `temperature` is a `sint8` that decodes as an int -- an accident,
 * not intent. The real SSI payload types `te` as a double: captured SSI dives
 * (19.json / 22.json at repo root) show decimals, and the Swift
 * `ShearwaterSSIPayloadTransformer` this port descends from types `te` as a
 * `Double` (added to fix a confirmed int-vs-double SSI rejection bug); the
 * Shearwater Python path likewise casts `waterTemp` to `float`. Keep `te` a
 * double. TODO: file back against `fit_ssi_convert.py` so the two agree.
 */
const forceSampleDoubles = (path: (string | number)[]): boolean =>
  typeof path[1] === 'string' && SAMPLE_DOUBLE_FIELDS.has(path[1]);

// --- constants local to this converter -------------------------------------

const SUBMERGED_M = 0.5; // working-depth threshold for avg_depth
const DOWNSAMPLE_S = 5; // scuba/apnea profile is resampled to this fixed cadence
const SCUBA_SUB_SPORTS = new Set(['singleGasDiving', 'multiGasDiving', 'gaugeDiving']);

// garmin_product enum value -> SSI-facing model name. Fallback below handles
// anything not listed.
const GARMIN_PRODUCT_NAMES: Record<string, string> = { descentMk2: 'Descent Mk2' };

// --- types ---------------------------------------------------------------------

export interface FitRecord {
  timestamp: Date;
  depth?: number | null;
  ascentRate?: number | null;
  temperature?: number | null;
  heartRate?: number | null;
  ndlTime?: number | null;
  nextStopDepth?: number | null;
  [k: string]: unknown;
}

export interface FitTankUpdate {
  timestamp: Date;
  pressure?: number | null;
  [k: string]: unknown;
}

export interface ParsedDevice {
  manufacturer: string;
  productName: string;
  serialNumber: number | string | bigint | null;
  softwareVersion: number | string | null;
}

export interface ParsedFit {
  session: Record<string, any>;
  activity: Record<string, any>;
  records: FitRecord[];
  diveSummaries: Array<Record<string, any>>;
  device: ParsedDevice;
  subSport: string;
  diveGas: Record<string, any>;
  diveSettings: Record<string, any>;
  tankUpdates: FitTankUpdate[];
  tankSummary: Record<string, any>;
  startPosition: [number, number] | null;
  endPosition: [number, number] | null;
}

export class FitParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FitParseError';
  }
}

// --- small helpers -----------------------------------------------------------

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Port of `_product_name`. */
export function productName(garminProduct: unknown): string {
  if (typeof garminProduct === 'string' && garminProduct in GARMIN_PRODUCT_NAMES) {
    return GARMIN_PRODUCT_NAMES[garminProduct];
  }
  return titleCase(String(garminProduct).replace(/_/g, ' '));
}

/** Port of `_position`. */
export function position(sessionMesg: Record<string, any>, which: 'start' | 'end'): [number, number] | null {
  const lat = sessionMesg[`${which}PositionLat`];
  const lon = sessionMesg[`${which}PositionLong`];
  if (lat == null || lon == null) return null;
  return [lat, lon];
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Python `"%g" % float(v)` for the small values firmware versions take. */
function formatG(v: number | string): string {
  const n = Number(v);
  if (!isFinite(n)) return String(n);
  let s = n.toPrecision(6);
  if (s.indexOf('e') === -1 && s.indexOf('.') !== -1) s = s.replace(/\.?0+$/, '');
  return s;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/** "%Y-%m-%d" of a local-wall-clock instant given as ms. */
function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "%Y-%m-%d %H:%M" */
function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${fmtDate(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "%H:%M" */
function fmtEntryTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** naive datetime .isoformat(timespec="milliseconds") -> "YYYY-MM-DDTHH:MM:SS.mmm" */
function fmtIsoMs(ms: number): string {
  const d = new Date(ms);
  return (
    `${fmtDate(ms)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:` +
    `${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
  );
}

// --- profile helpers -------------------------------------------------------

/** Port of `_downsample`. */
export function downsample(
  records: FitRecord[],
  sessionStartMs: number,
  intervalS: number = DOWNSAMPLE_S,
): FitRecord[] {
  if (!records.length) return [];
  const offsets = records.map((r) => (r.timestamp.getTime() - sessionStartMs) / 1000);
  const last = offsets[offsets.length - 1];
  const picked = new Set<number>();
  let k = 0;
  while (k * intervalS <= last) {
    const target = k * intervalS;
    // nearest offset; ties resolve to the earlier record (min abs delta, then
    // min offset) -- Python's `key=lambda j: (abs(offsets[j]-target), offsets[j])`
    let best = 0;
    let bestDelta = Math.abs(offsets[0] - target);
    let bestOffset = offsets[0];
    for (let j = 1; j < offsets.length; j++) {
      const delta = Math.abs(offsets[j] - target);
      if (delta < bestDelta || (delta === bestDelta && offsets[j] < bestOffset)) {
        best = j;
        bestDelta = delta;
        bestOffset = offsets[j];
      }
    }
    picked.add(best);
    k += 1;
  }
  picked.add(0);
  picked.add(records.length - 1);
  return [...picked].sort((a, b) => a - b).map((i) => records[i]);
}

/** Port of `_tank_pressure_at`. */
export function tankPressureAt(tsMs: number, tankUpdates: FitTankUpdate[]): number | null {
  if (!tankUpdates.length) return null;
  if (tsMs <= tankUpdates[0].timestamp.getTime()) return tankUpdates[0].pressure ?? null;
  const lastU = tankUpdates[tankUpdates.length - 1];
  if (tsMs >= lastU.timestamp.getTime()) return lastU.pressure ?? null;
  let nearest = tankUpdates[0];
  let bestDelta = Math.abs(nearest.timestamp.getTime() - tsMs);
  for (const u of tankUpdates) {
    const delta = Math.abs(u.timestamp.getTime() - tsMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      nearest = u;
    }
  }
  return nearest.pressure ?? null;
}

type SampleCore = Omit<SsiSample, 'ndl' | 'a' | 'dr'>;

/** Port of `_sample_common`. */
export function sampleCommon(i: number, rec: FitRecord, sessionStartMs: number): SampleCore {
  const depthM = roundHalfToEven((rec.depth || 0.0), 2);
  // float() in the Python forces JSON float output when ascent_rate is an int;
  // in JS every number is a float already.
  const s = roundHalfToEven((rec.ascentRate || 0.0) * 60, 1);
  const temp = rec.temperature;
  return {
    n: i + 1,
    t: roundHalfToEven((rec.timestamp.getTime() - sessionStartMs)),
    d: depthM,
    s,
    // `te` is intentionally widened to a double at serialization time (see
    // `forceSampleDoubles` / `SAMPLE_DOUBLE_FIELDS`), unlike `fit_ssi_convert.py`
    // whose `round(int, 1)` yields an int only because FIT temperature decodes as
    // an int -- the real SSI payload types `te` as a double. TODO: file back
    // against `fit_ssi_convert.py`.
    te: temp != null ? roundHalfToEven(temp, 1) : null,
    gs: 0.0,
    gn: 0.0,
    mf: divePhaseBits(depthM),
    o: false,
    rv: 3.0,
  };
}

/** Port of `_build_scuba_samples`. */
export function buildScubaSamples(
  dsr: FitRecord[],
  sessionStartMs: number,
  tankUpdates: FitTankUpdate[],
): SsiSample[] {
  const samples: SsiSample[] = [];
  for (let i = 0; i < dsr.length; i++) {
    const rec = dsr[i];
    const core = sampleCommon(i, rec, sessionStartMs);
    const ndlTime = rec.ndlTime;
    const sample: SsiSample = {
      ...core,
      ndl: ndlTime != null ? Math.min(Math.max(ndlTime, 0), NDL_CAP) : null,
      a: ascentAlarmBits(core.s),
      dr: (rec.nextStopDepth || 0) > 0,
    };
    const pressure = tankPressureAt(rec.timestamp.getTime(), tankUpdates);
    if (pressure != null) sample.pressure = roundHalfToEven(pressure, 2);
    samples.push(sample);
  }
  return samples;
}

/** Port of `_build_apnea_samples`. */
export function buildApneaSamples(dsr: FitRecord[], sessionStartMs: number): SsiSample[] {
  const samples: SsiSample[] = [];
  for (let i = 0; i < dsr.length; i++) {
    const core = sampleCommon(i, dsr[i], sessionStartMs);
    samples.push({ ...core, ndl: null, a: 0, dr: false });
  }
  return samples;
}

// --- shared payload blocks -------------------------------------------------

/** Port of `_local_start`; returns a local-wall-clock instant as ms. */
export function localStart(parsed: ParsedFit): number {
  const activity = parsed.activity ?? {};
  const startMs = (parsed.session.startTime as Date).getTime();
  if (activity.localTimestamp != null && activity.timestamp != null) {
    const offset = FIT_EPOCH_MS + activity.localTimestamp * 1000 - (activity.timestamp as Date).getTime();
    return startMs + offset;
  }
  return startMs;
}

/** Port of `_computer_identity`. */
export function computerIdentity(device: ParsedDevice, startLocalMs: number): Record<string, unknown> {
  const sv = device.softwareVersion;
  return {
    odin_user_log_diveComputer: '',
    odin_user_log_diveComputerData: '',
    odin_user_log_divecomputer_manufacturer: 'Garmin',
    odin_user_log_divecomputer_name: device.productName,
    odin_user_log_divecomputer_ref: device.productName,
    odin_user_log_divecomputer_dive_ref: fmtIsoMs(startLocalMs) + '_0',
    odin_user_log_divecomputer_serial_nr:
      device.serialNumber != null ? String(device.serialNumber) : '',
    odin_user_log_divecomputer_firmware: sv != null ? formatG(sv) : '',
    odin_user_log_divecomputer_imported: true,
  };
}

/** Port of `_temp_block`. */
export function tempBlock(payload: Record<string, unknown>, records: FitRecord[]): void {
  const temps = records.filter((r) => r.temperature != null).map((r) => r.temperature as number);
  if (temps.length) {
    const lo = Math.min(...temps);
    const hi = Math.max(...temps);
    payload.odin_user_log_watertemp_c = roundHalfToEven(lo);
    payload.odin_user_log_watertemp_f = roundHalfToEven((lo * 9) / 5 + 32);
    payload.odin_user_log_watertemp_max_c = roundHalfToEven(hi);
    payload.odin_user_log_watertemp_max_f = roundHalfToEven((hi * 9) / 5 + 32);
  }
}

/** Port of `_hr_block`. */
export function hrBlock(
  payload: Record<string, unknown>,
  records: FitRecord[],
  dsr: FitRecord[],
  session: Record<string, any>,
): void {
  payload.odin_user_log_heartRateDataset = JSON.stringify(dsr.map((r) => r.heartRate ?? null));
  const hrs = records.filter((r) => r.heartRate != null).map((r) => r.heartRate as number);
  if (hrs.length) {
    payload.odin_user_log_heartRateMin = Math.min(...hrs);
    payload.odin_user_log_heartRateMax = Math.max(...hrs);
    payload.odin_user_log_heartRateAvg = session.avgHeartRate || roundHalfToEven(mean(hrs));
  }
}

// --- scuba / apnea conversion --------------------------------------------

/** Port of `_convert_scuba`. */
export function convertScuba(parsed: ParsedFit): Record<string, unknown> {
  const session = parsed.session;
  const records = parsed.records;
  const device = parsed.device;
  const diveGas = parsed.diveGas ?? {};
  const diveSettings = parsed.diveSettings ?? {};
  const tankSummary = parsed.tankSummary ?? {};
  const tankUpdates = parsed.tankUpdates ?? [];
  const ds =
    (parsed.diveSummaries ?? []).find((s) => s.referenceMesg === 'session') ?? {};

  const startLocalMs = localStart(parsed);
  const sessionStartMs = (session.startTime as Date).getTime();
  const dsr = downsample(records, sessionStartMs);
  const samples = buildScubaSamples(dsr, sessionStartMs, tankUpdates);

  const sampleDepths = samples.map((s) => s.d);
  // depth_m/avg_depth come off the full-resolution profile so a 5 s downsample
  // gap can't clip the true peak; the datasets stay downsampled.
  const depths = records.filter((r) => r.depth != null).map((r) => r.depth as number);

  const depthM = depths.length ? roundHalfToEven(Math.max(...depths), 1) : 0.0;
  let avgDepthM: number;
  if (ds.avgDepth != null) {
    avgDepthM = roundHalfToEven(ds.avgDepth, 1);
  } else if (depths.length) {
    const submerged = depths.filter((d) => d > SUBMERGED_M);
    avgDepthM = roundHalfToEven(mean(submerged.length ? submerged : depths), 1);
  } else {
    avgDepthM = 0.0;
  }

  const o2 = diveGas.oxygenContent;
  const isNitrox = o2 != null && o2 > 22;

  const payload: Record<string, unknown> = {
    odin_user_log_datetime: fmtDateTime(startLocalMs),
    odin_user_log_date: fmtDate(startLocalMs),
    odin_user_log_entry_time: fmtEntryTime(startLocalMs),
    odin_user_log_divetime: roundHalfToEven(session.totalElapsedTime / 60),
    odin_user_log_dive_type: 0,
    odin_user_log_depth_m: depthM,
    odin_user_log_depth_ft: roundHalfToEven(depthM / FT_TO_M, 1),
    odin_user_log_avg_depth_m: avgDepthM,
    odin_user_log_avg_depth_ft: roundHalfToEven(avgDepthM / FT_TO_M, 1),
    odin_user_log_ean: isNitrox ? 1 : 0,
    odin_user_log_ean_percent: isNitrox ? roundHalfToEven(o2) : 0,
    odin_user_log_diveSamples: serializeWithForcedDoubles(samples, forceSampleDoubles),
    odin_user_log_depthDataset: serializeWithForcedDoubles(sampleDepths, () => true),
    // tempDataset entries are forced to doubles (e.g. `26.0`), an intentional
    // deviation from `fit_ssi_convert.py` (whose `round(int, 1)` returns an int
    // because FIT temperature decodes as an int) -- the real SSI payload types
    // temperature as a double, matching the Shearwater/Swift transformer.
    // TODO: file back against `fit_ssi_convert.py`.
    odin_user_log_tempDataset: serializeWithForcedDoubles(
      samples.map((s) => s.te),
      () => true,
    ),
    odin_user_log_gfSurfDataset: serializeWithForcedDoubles(
      new Array(samples.length).fill(0.0),
      () => true,
    ),
    odin_user_log_gfnowDataset: serializeWithForcedDoubles(
      new Array(samples.length).fill(0.0),
      () => true,
    ),
    odin_user_log_deepestDecoDataset: '',
    odin_user_log_alarmDataset: JSON.stringify(
      samples
        .filter((s) => s.a || s.dr)
        .map((s) => ({
          position: s.n,
          speed: Boolean(s.a & ALARM_FLAGS.ASCENT_ADVISORY),
          fast_ascent: Boolean(s.a & ALARM_FLAGS.ASCENT_WARNING),
          deco: s.dr,
          violation: false,
        })),
    ),
  };
  Object.assign(payload, computerIdentity(device, startLocalMs));
  tempBlock(payload, records);
  hrBlock(payload, records, dsr, session);

  let startBar = tankSummary.startPressure;
  let endBar = tankSummary.endPressure;
  if (startBar == null && tankUpdates.length) startBar = tankUpdates[0].pressure;
  if (endBar == null && tankUpdates.length) endBar = tankUpdates[tankUpdates.length - 1].pressure;
  if (startBar != null) {
    payload.odin_user_log_pressure_start_bar = roundHalfToEven(startBar);
    payload.odin_user_log_pressure_start_psi = roundHalfToEven(startBar / PSI_TO_BAR);
  }
  if (endBar != null) {
    payload.odin_user_log_pressure_end_bar = roundHalfToEven(endBar);
    payload.odin_user_log_pressure_end_psi = roundHalfToEven(endBar / PSI_TO_BAR);
  }
  if (tankUpdates.length || Object.keys(tankSummary).length) {
    payload.odin_user_log_tankPressureDataset = serializeWithForcedDoubles(
      samples.map((s) => s.pressure ?? null),
      () => true,
    );
  } else {
    payload.odin_user_log_tankPressureDataset = '';
  }

  if (ds.avgVolumeSac != null) payload.odin_user_log_amv_l = roundHalfToEven(ds.avgVolumeSac, 2);
  if (ds.avgPressureSac != null) payload.odin_user_log_amv_psi = roundHalfToEven(ds.avgPressureSac, 2);

  const gfLow = diveSettings.gfLow;
  const gfHigh = diveSettings.gfHigh;
  if (gfLow != null && gfHigh != null) {
    payload.odin_user_log_gf_set = `${gfLow} / ${gfHigh}`;
    payload.odin_user_log_gf_set_1 = gfLow;
    payload.odin_user_log_gf_set_2 = gfHigh;
  }

  if (ds.startCns != null) payload.odin_user_log_cns_start = ds.startCns;
  if (ds.endCns != null) payload.odin_user_log_cns_end = ds.endCns;

  if (diveSettings.waterType === 'salt') payload.odin_user_log_var_watertype_id = 4;

  const startPos = parsed.startPosition ?? position(session, 'start');
  const endPos = parsed.endPosition ?? position(session, 'end');
  if (startPos) {
    const lat = startPos[0] * SEMICIRCLE_TO_DEG;
    const lon = startPos[1] * SEMICIRCLE_TO_DEG;
    payload.log_extended_data_latitude = lat;
    payload.log_extended_data_longitude = lon;
    payload.odin_user_log_pos_start_latitude = lat;
    payload.odin_user_log_pos_start_longitude = lon;
  }
  if (endPos) {
    payload.odin_user_log_pos_end_latitude = endPos[0] * SEMICIRCLE_TO_DEG;
    payload.odin_user_log_pos_end_longitude = endPos[1] * SEMICIRCLE_TO_DEG;
  }

  return payload;
}

/** Port of `_convert_apnea`. */
export function convertApnea(parsed: ParsedFit): Record<string, unknown> {
  const session = parsed.session;
  const records = parsed.records;
  const device = parsed.device;

  const startLocalMs = localStart(parsed);
  const sessionStartMs = (session.startTime as Date).getTime();
  const dsr = downsample(records, sessionStartMs);
  const samples = buildApneaSamples(dsr, sessionStartMs);

  const depths = records.filter((r) => r.depth != null).map((r) => r.depth as number);
  const depthM = depths.length ? roundHalfToEven(Math.max(...depths), 1) : 0.0;
  let avgDepthM: number;
  if (depths.length) {
    const submerged = depths.filter((d) => d > SUBMERGED_M);
    avgDepthM = roundHalfToEven(mean(submerged.length ? submerged : depths), 1);
  } else {
    avgDepthM = 0.0;
  }

  const payload: Record<string, unknown> = {
    odin_user_log_datetime: fmtDateTime(startLocalMs),
    odin_user_log_date: fmtDate(startLocalMs),
    odin_user_log_entry_time: fmtEntryTime(startLocalMs),
    odin_user_log_divetime: roundHalfToEven(session.totalElapsedTime / 60),
    odin_user_log_dive_type: 0,
    odin_user_log_depth_m: depthM,
    odin_user_log_depth_ft: roundHalfToEven(depthM / FT_TO_M, 1),
    odin_user_log_avg_depth_m: avgDepthM,
    odin_user_log_avg_depth_ft: roundHalfToEven(avgDepthM / FT_TO_M, 1),
    odin_user_log_ean: 0,
    odin_user_log_ean_percent: 0,
    odin_user_log_diveSamples: serializeWithForcedDoubles(samples, forceSampleDoubles),
    odin_user_log_depthDataset: serializeWithForcedDoubles(
      samples.map((s) => s.d),
      () => true,
    ),
    // tempDataset entries are forced to doubles (e.g. `26.0`), an intentional
    // deviation from `fit_ssi_convert.py` (whose `round(int, 1)` returns an int
    // because FIT temperature decodes as an int) -- the real SSI payload types
    // temperature as a double, matching the Shearwater/Swift transformer.
    // TODO: file back against `fit_ssi_convert.py`.
    odin_user_log_tempDataset: serializeWithForcedDoubles(
      samples.map((s) => s.te),
      () => true,
    ),
    odin_user_log_gfSurfDataset: serializeWithForcedDoubles(
      new Array(samples.length).fill(0.0),
      () => true,
    ),
    odin_user_log_gfnowDataset: serializeWithForcedDoubles(
      new Array(samples.length).fill(0.0),
      () => true,
    ),
    odin_user_log_deepestDecoDataset: '',
    odin_user_log_alarmDataset: '[]',
    odin_user_log_tankPressureDataset: '',
  };
  Object.assign(payload, computerIdentity(device, startLocalMs));
  tempBlock(payload, records);
  hrBlock(payload, records, dsr, session);
  return payload;
}

/** Port of `convert_to_ssi_payload` dispatch. */
export function convertToSsiPayload(parsed: ParsedFit): Record<string, unknown> {
  const sub = parsed.subSport;
  if (sub === 'apneaDiving') return convertApnea(parsed);
  if (!SCUBA_SUB_SPORTS.has(sub)) {
    process.stderr.write(
      `warning: sub_sport '${sub}' is not a known scuba type; ` +
        `attempting scuba conversion anyway\n`,
    );
  }
  return convertScuba(parsed);
}

/**
 * Thin projection of a parsed FIT dive onto `@divesend/core`'s `CanonicalDive`
 * -- the shape `toUddf` consumes. Used only by `divesend convert --to uddf`: it
 * carries the depth / time / temperature / tank-pressure profile plus the gas,
 * gradient-factor, device and start-time header fields UDDF needs, and leaves
 * the richer SSI-only data (GPS, heart rate, alarms, CNS) behind. The SSI path
 * (`convertToSsiPayload`) does NOT route through here.
 */
export function toCanonicalDive(parsed: ParsedFit): CanonicalDive {
  const session = parsed.session ?? {};
  const diveGas = parsed.diveGas ?? {};
  const diveSettings = parsed.diveSettings ?? {};
  const tankSummary = parsed.tankSummary ?? {};
  const tankUpdates = parsed.tankUpdates ?? [];
  const records = parsed.records ?? [];
  const isApnea = parsed.subSport === 'apneaDiving';

  const sessionStartMs = (session.startTime as Date).getTime();
  const dsr = downsample(records, sessionStartMs);
  const ssiSamples = isApnea
    ? buildApneaSamples(dsr, sessionStartMs)
    : buildScubaSamples(dsr, sessionStartMs, tankUpdates);

  const samples: DiveSample[] = ssiSamples.map((s) => ({
    timeS: s.t / 1000,
    depthM: s.d,
    tempC: s.te,
    ndlS: null,
    tankPressureBar: s.pressure ?? null,
    decoStopDepthM: null,
    ttsS: null,
  }));

  const depths = records.filter((r) => r.depth != null).map((r) => r.depth as number);
  const maxDepthM = depths.length ? roundHalfToEven(Math.max(...depths), 2) : 0;

  let beginBar: number | null | undefined = tankSummary.startPressure;
  let endBar: number | null | undefined = tankSummary.endPressure;
  if (beginBar == null && tankUpdates.length) beginBar = tankUpdates[0].pressure;
  if (endBar == null && tankUpdates.length) endBar = tankUpdates[tankUpdates.length - 1].pressure;

  const o2 = diveGas.oxygenContent;
  const he = diveGas.heliumContent;

  const header: DiveHeader = {
    startTime: (session.startTime as Date).toISOString(),
    maxDepthM,
    gasO2Percent: o2 != null ? o2 : 21,
    gasHePercent: he != null ? he : 0,
    tankBeginPressureBar: beginBar != null ? roundHalfToEven(beginBar, 2) : null,
    tankEndPressureBar: endBar != null ? roundHalfToEven(endBar, 2) : null,
    diveMode: isApnea ? 'freedive' : 'oc',
    decoModel: 'buhlmann',
    gfLow: diveSettings.gfLow != null ? diveSettings.gfLow : 0,
    gfHigh: diveSettings.gfHigh != null ? diveSettings.gfHigh : 0,
    salinity: diveSettings.waterType === 'salt' ? 'salt' : 'fresh',
    deviceModel: parsed.device.productName,
    divetimeS:
      session.totalElapsedTime != null
        ? Math.round(session.totalElapsedTime)
        : samples.length
          ? samples[samples.length - 1].timeS
          : 0,
    minTemperatureC: null,
    maxTemperatureC: null,
    cnsPercent: null,
  };

  return { header, samples };
}

// --- FIT decode ------------------------------------------------------------

/** Port of `parse_fit`, taking bytes instead of a path. */
export function parseFit(bytes: Uint8Array): ParsedFit {
  let messages: Record<string, any>;
  let errors: unknown[];
  try {
    const stream = Stream.fromByteArray(bytes);
    const decoded = new Decoder(stream).read();
    messages = decoded.messages;
    errors = decoded.errors;
  } catch (exc) {
    throw new FitParseError(`FIT decode failed: ${(exc as Error).message}`);
  }
  if (errors && errors.length) {
    throw new FitParseError(`FIT decode errors: ${errors}`);
  }

  const sessions: Array<Record<string, any>> = messages.sessionMesgs ?? [];
  const records: FitRecord[] = messages.recordMesgs ?? [];
  const activities: Array<Record<string, any>> = messages.activityMesgs ?? [];
  if (!sessions.length) throw new FitParseError('no session_mesgs in FIT file');
  if (!records.length) throw new FitParseError('no record_mesgs in FIT file');
  const activity = activities.length ? activities[0] : {};
  if ((activity.numSessions ?? 1) !== 1) {
    throw new FitParseError(
      `multi-session FIT files are not supported (num_sessions=${activity.numSessions})`,
    );
  }

  // Python's `messages.get('file_id_mesgs') or [{}]` yields `{}` for an empty
  // list; JS `?? [{}]` does not (an empty array is not nullish), so `[0]` would
  // be `undefined` and the field reads below would throw a raw TypeError instead
  // of a clean FitParseError. Guard the element, not just the array.
  const fileId: Record<string, any> = (messages.fileIdMesgs ?? [])[0] ?? {};
  const creator: Record<string, any> =
    (messages.deviceInfoMesgs ?? []).find((d: Record<string, any>) => d.deviceIndex === 'creator') ?? {};
  const device: ParsedDevice = {
    manufacturer: fileId.manufacturer ?? '',
    productName: productName(fileId.garminProduct),
    serialNumber: fileId.serialNumber ?? null,
    softwareVersion: creator.softwareVersion ?? null,
  };

  const session = sessions[0];
  return {
    session,
    activity,
    records,
    diveSummaries: messages.diveSummaryMesgs ?? [],
    device,
    subSport: session.subSport ?? '',
    diveGas: (messages.diveGasMesgs ?? [{}])[0],
    diveSettings: (messages.diveSettingsMesgs ?? [{}])[0],
    tankUpdates: messages.tankUpdateMesgs ?? [],
    tankSummary: (messages.tankSummaryMesgs ?? [{}])[0],
    startPosition: position(session, 'start'),
    endPosition: position(session, 'end'),
  };
}
