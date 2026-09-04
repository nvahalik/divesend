// Port of `ShearwaterSSIPayloadTransformer.swift`
// (ios/DiveSend/Networking/ShearwaterSSIPayloadTransformer.swift in the sibling ssi repo).
// Translates a `CanonicalDive` into an SSI `save_divelog` overrides record. This is a
// mechanical, behavior-preserving port -- every rounding rule, fallback, and bitmask
// constant here mirrors a deliberate, already-tested fix on the iOS side. Do not simplify.

import type { CanonicalDive, DiveSample } from './types.js';
import { alarmDataset, ascentAlarmBits, divePhaseBits } from './ssiPayload.js';
import { serializeWithForcedDoubles, SAMPLE_DOUBLE_FIELDS } from './serialize.js';

const FT_TO_M = 0.3048;
const BAR_TO_PSI = 14.5038;

interface SSISample {
  n: number;
  t: number;
  d: number;
  s: number;
  te: number | null;
  ndl: number | null;
  gs: number;
  gn: number;
  a: number;
  mf: number;
  o: boolean;
  dr: boolean;
  rv: number;
  pressure?: number;
}

function roundTo(value: number, places: number): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function arrayMin(values: number[]): number | undefined {
  return values.length ? Math.min(...values) : undefined;
}

function arrayMax(values: number[]): number | undefined {
  return values.length ? Math.max(...values) : undefined;
}

function buildSSISamples(dive: CanonicalDive): SSISample[] {
  const samples: SSISample[] = [];
  let prevDepthM: number | undefined;
  let prevTimeS: number | undefined;

  dive.samples.forEach((s: DiveSample, index: number) => {
    let speed = 0.0;
    if (prevDepthM !== undefined && prevTimeS !== undefined && s.timeS > prevTimeS) {
      const dtMin = (s.timeS - prevTimeS) / 60;
      speed = roundTo((prevDepthM - s.depthM) / dtMin, 1);
    }

    const sample: SSISample = {
      n: index + 1,
      t: s.timeS * 1000,
      d: roundTo(s.depthM, 2),
      s: speed,
      te: s.tempC != null ? roundTo(s.tempC, 1) : null,
      ndl: s.ndlS != null ? Math.min(Math.floor(s.ndlS / 60), 99) : null,
      gs: 0.0,
      gn: 0.0,
      a: speed > 0 ? ascentAlarmBits(speed) : 0,
      mf: divePhaseBits(s.depthM),
      o: false,
      dr: (s.decoStopDepthM ?? 0) > 0,
      rv: 3.0,
    };
    if (s.tankPressureBar != null) {
      sample.pressure = s.tankPressureBar;
    }

    samples.push(sample);
    prevDepthM = s.depthM;
    prevTimeS = s.timeS;
  });

  return samples;
}

/// `CanonicalDive.header.deviceModel` carries libdc-swift's full device name (e.g.
/// "Shearwater Teric"), but the SSI payload's manufacturer/name fields are separate keys --
/// `odin_user_log_divecomputer_manufacturer` already supplies "Shearwater", so the name
/// field should just be the model, matching shearwater_transformers.py.
function shortDeviceName(full: string): string {
  const prefix = 'Shearwater ';
  return full.startsWith(prefix) ? full.slice(prefix.length) : full;
}

function diveRef(date: Date): string {
  // toISOString() always emits UTC with millisecond fractional precision, matching
  // ISO8601DateFormatter's [.withInternetDateTime, .withFractionalSeconds] output.
  return `${date.toISOString()}_0`;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/// Deliberately does NOT convert to UTC. `ShearwaterDiveDecoder` builds
/// `CanonicalDive.header.startTime` from libdivecomputer's raw (timezone-less) datetime
/// fields interpreted in the system's current default timezone, so formatting here must use
/// that same local timezone to round-trip the original wall-clock values correctly --
/// forcing UTC (or any fixed zone) here would silently produce a different wall-clock
/// string than what the dive computer actually displayed.
function formatDateTime(date: Date): string {
  return `${formatDate(date)} ${formatTime(date)}`;
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// `serializeWithForcedDoubles` + `SAMPLE_DOUBLE_FIELDS` now live in ./serialize.ts
// (shared with the CLI's converters); imported above. Behaviour unchanged.

function avgDepthM(samples: DiveSample[]): number {
  if (samples.length === 0) return 0.0;
  return samples.reduce((sum, s) => sum + s.depthM, 0) / samples.length;
}

/**
 * `deviceSerialNumber`, when available, is threaded into
 * `odin_user_log_divecomputer_serial_nr`. Confirmed against a real synced dive's SSI
 * read-back: without it, SSI's server never creates the dive's device-identity record, and
 * `odin_user_log_divecomputer_manufacturer`/`_name` silently persist as empty strings even
 * though this transformer sends non-empty values for them on write.
 */
export function transformDive(dive: CanonicalDive, deviceSerialNumber?: string): Record<string, unknown> {
  const header = dive.header;
  const samples = buildSSISamples(dive);
  const isNitrox = header.gasO2Percent > 22.0;
  const startTime = new Date(header.startTime);

  const temps: number[] = samples.filter((s) => s.te != null).map((s) => s.te as number);
  const pressuresPresent = samples.some((s) => s.pressure != null);

  const payload: Record<string, unknown> = {
    odin_user_log_datetime: formatDateTime(startTime),
    odin_user_log_date: formatDate(startTime),
    odin_user_log_entry_time: formatTime(startTime),
    odin_user_log_depth_m: roundTo(header.maxDepthM, 2),
    odin_user_log_depth_ft: roundTo(header.maxDepthM / FT_TO_M, 1),
    odin_user_log_avg_depth_m: roundTo(avgDepthM(dive.samples), 1),
    odin_user_log_avg_depth_ft: roundTo(avgDepthM(dive.samples) / FT_TO_M, 1),
    odin_user_log_divetime:
      header.divetimeS != null
        ? Math.round(header.divetimeS / 60)
        : dive.samples.length > 0
          ? Math.round(dive.samples[dive.samples.length - 1].timeS / 60)
          : 0,
    odin_user_log_ean: isNitrox ? 1 : 0,
    odin_user_log_ean_percent: isNitrox ? Math.round(header.gasO2Percent) : 0,
    odin_user_log_gf_set: `${header.gfLow} / ${header.gfHigh}`,
    odin_user_log_gf_set_1: header.gfLow,
    odin_user_log_gf_set_2: header.gfHigh,
    odin_user_log_diveComputer: '',
    odin_user_log_divecomputer_manufacturer: 'Shearwater',
    odin_user_log_divecomputer_name: shortDeviceName(header.deviceModel),
    odin_user_log_divecomputer_ref: shortDeviceName(header.deviceModel),
    odin_user_log_divecomputer_dive_ref: diveRef(startTime),
    odin_user_log_divecomputer_imported: true,
    odin_user_log_diveSamples: serializeWithForcedDoubles(
      samples,
      (path) => typeof path[1] === 'string' && SAMPLE_DOUBLE_FIELDS.has(path[1])
    ),
    odin_user_log_depthDataset: serializeWithForcedDoubles(
      samples.map((s) => s.d),
      () => true
    ),
    odin_user_log_tempDataset: serializeWithForcedDoubles(
      samples.map((s) => s.te),
      () => true
    ),
    odin_user_log_gfSurfDataset: serializeWithForcedDoubles(
      samples.map((s) => s.gs),
      () => true
    ),
    odin_user_log_gfnowDataset: serializeWithForcedDoubles(
      samples.map((s) => s.gn),
      () => true
    ),
    odin_user_log_alarmDataset: alarmDataset(samples),
  };

  if (deviceSerialNumber !== undefined) {
    payload.odin_user_log_divecomputer_serial_nr = deviceSerialNumber;
  }

  if (header.tankBeginPressureBar != null) {
    payload.odin_user_log_pressure_start_bar = roundTo(header.tankBeginPressureBar, 1);
    payload.odin_user_log_pressure_start_psi = roundTo(header.tankBeginPressureBar * BAR_TO_PSI, 1);
  }
  if (header.tankEndPressureBar != null) {
    payload.odin_user_log_pressure_end_bar = roundTo(header.tankEndPressureBar, 1);
    payload.odin_user_log_pressure_end_psi = roundTo(header.tankEndPressureBar * BAR_TO_PSI, 1);
  }

  // Prefer the firmware-tracked extremes (DC_FIELD_TEMPERATURE_MINIMUM/MAXIMUM) over
  // scanning the (coarser, 5s-interval) profile samples -- fall back to the scan only when
  // the header doesn't carry them (e.g. a hand-built CanonicalDive, or a future device
  // family whose parser doesn't report these fields).
  const minC = header.minTemperatureC ?? arrayMin(temps);
  const maxC = header.maxTemperatureC ?? arrayMax(temps);
  if (minC != null && maxC != null) {
    payload.odin_user_log_watertemp_c = roundTo(minC, 1);
    payload.odin_user_log_watertemp_f = roundTo((minC * 9) / 5 + 32, 1);
    payload.odin_user_log_watertemp_max_c = roundTo(maxC, 1);
    payload.odin_user_log_watertemp_max_f = roundTo((maxC * 9) / 5 + 32, 1);
  }

  if (pressuresPresent) {
    payload.odin_user_log_tankPressureDataset = serializeWithForcedDoubles(
      samples.map((s) => (s.pressure != null ? s.pressure : null)),
      () => true
    );
  }

  if (header.cnsPercent != null) {
    payload.odin_user_log_cns_end = roundTo(header.cnsPercent, 1);
  }

  if (header.firmwareVersion != null) {
    payload.odin_user_log_divecomputer_firmware = header.firmwareVersion;
  }
  if (header.cnsStartPercent != null) {
    payload.odin_user_log_cns_start = roundTo(header.cnsStartPercent, 1);
  }
  if (header.sacVolumeLPerMin != null) {
    payload.odin_user_log_amv_l = roundTo(header.sacVolumeLPerMin, 2);
  }
  if (header.sacPressurePsiPerMin != null) {
    payload.odin_user_log_amv_psi = roundTo(header.sacPressurePsiPerMin, 2);
  }
  if (header.waterTypeId != null) {
    payload.odin_user_log_var_watertype_id = header.waterTypeId;
  }
  if (header.startLatitude != null && header.startLongitude != null) {
    payload.odin_user_log_pos_start_latitude = header.startLatitude;
    payload.odin_user_log_pos_start_longitude = header.startLongitude;
  }
  if (header.endLatitude != null && header.endLongitude != null) {
    payload.odin_user_log_pos_end_latitude = header.endLatitude;
    payload.odin_user_log_pos_end_longitude = header.endLongitude;
  }

  const hrValues = dive.samples
    .map((s) => s.heartRateBpm)
    .filter((v): v is number => v != null);
  const hasHeaderHr =
    header.heartRateAvgBpm != null || header.heartRateMinBpm != null || header.heartRateMaxBpm != null;
  if (hrValues.length > 0 || hasHeaderHr) {
    payload.odin_user_log_heartRateDataset = serializeWithForcedDoubles(
      dive.samples.map((s) => s.heartRateBpm ?? null),
      () => true
    );
    const hrMin = header.heartRateMinBpm ?? arrayMin(hrValues);
    const hrMax = header.heartRateMaxBpm ?? arrayMax(hrValues);
    const hrAvg =
      header.heartRateAvgBpm ??
      (hrValues.length > 0 ? roundTo(hrValues.reduce((a, b) => a + b, 0) / hrValues.length, 0) : undefined);
    if (hrMin != null) payload.odin_user_log_heartRateMin = hrMin;
    if (hrMax != null) payload.odin_user_log_heartRateMax = hrMax;
    if (hrAvg != null) payload.odin_user_log_heartRateAvg = hrAvg;
  }

  return payload;
}
