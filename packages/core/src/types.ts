// Mirrors webble/src/dive_decode.c's JSON output exactly — field names,
// types, and nullability. Do not rename fields here without also updating
// the C side; JSON.parse gives no compile-time cross-check between them.
//
// The trailing optional fields on DiveHeader/DiveSample below (firmwareVersion
// through gasMixes; heartRateBpm, gasMixIndex) are enrichments the C decoder does
// not emit yet -- they arrive from file importers (Garmin FIT, Shearwater UDDF).
// Adding an OPTIONAL nullable field here needs no C change: the C JSON simply
// omits it and JSON.parse yields undefined. Only renaming or retyping an existing
// field requires touching the C side.

export interface DiveHeader {
  startTime: string; // ISO 8601, e.g. "2026-08-22T11:42:10Z" -- always true UTC ("Z")
  /**
   * Minutes east of UTC the dive computer had configured at dive time (DST folded
   * in), kept separate from `startTime` so the diver's local wall-clock is
   * recoverable. `null`/absent when the device reports no offset -- as of this
   * writing only the Shearwater Teric (logversion >= 9) populates it.
   */
  utcOffsetMinutes?: number | null;
  maxDepthM: number;
  gasO2Percent: number;
  gasHePercent: number;
  tankBeginPressureBar: number | null;
  tankEndPressureBar: number | null;
  diveMode: string; // "oc" | "ccr" | "scr" | "gauge" | "freedive"
  decoModel: string; // "buhlmann" | "vpm" | "rgbm" | "dciem" | "none"
  gfLow: number;
  gfHigh: number;
  salinity: string; // "salt" | "fresh"
  deviceModel: string;
  divetimeS: number;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  cnsPercent: number | null;
  // --- enrichments (see file header) ---
  firmwareVersion?: string | null;
  cnsStartPercent?: number | null;
  sacVolumeLPerMin?: number | null;
  sacPressurePsiPerMin?: number | null;
  startLatitude?: number | null;
  startLongitude?: number | null;
  endLatitude?: number | null;
  endLongitude?: number | null;
  heartRateAvgBpm?: number | null;
  heartRateMinBpm?: number | null;
  heartRateMaxBpm?: number | null;
  waterTypeId?: number | null;
  gasMixes?: GasMix[] | null;
  // avgDepthM/surfacePressureBar/surfaceTemperatureC/tanks are BLE-only
  // (DC_FIELD_AVGDEPTH/ATMOSPHERIC/TEMPERATURE_SURFACE/TANK) -- absent/null for
  // file-imported dives and any BLE device/parser that doesn't report them.
  avgDepthM?: number | null;
  surfacePressureBar?: number | null;
  surfaceTemperatureC?: number | null;
  /** Every tank the device reports, in device order. tankBeginPressureBar/tankEndPressureBar above are tank 0. */
  tanks?: TankInfo[];
}

export interface TankInfo {
  beginPressureBar: number;
  endPressureBar: number;
  /** Index into header.gasMixes, or null when the device doesn't say which mix this tank holds. */
  gasMixIndex: number | null;
}

export interface DiveSample {
  timeS: number;
  depthM: number;
  tempC: number | null;
  ndlS: number | null;
  tankPressureBar: number | null;
  decoStopDepthM: number | null;
  ttsS: number | null;
  heartRateBpm?: number | null;
  gasMixIndex?: number | null;
  // BLE-only (DC_SAMPLE_SETPOINT/PPO2/CNS/RBT/BEARING/EVENT) -- absent/empty for
  // file-imported dives and any device/parser that doesn't report them.
  setpointBar?: number | null;
  ppo2Bar?: number | null;
  cnsPercent?: number | null;
  remainingBottomTimeMin?: number | null;
  bearingDeg?: number | null;
  /** Named alarms/markers at this instant (e.g. "ceiling", "safetystop", "bookmark"); empty if none. */
  events?: string[];
}

export interface GasMix {
  o2Percent: number;
  hePercent: number;
}

export interface CanonicalDive {
  header: DiveHeader;
  samples: DiveSample[];
  // Hex-encoded verbatim device buffer (the exact bytes dc_parser_new saw),
  // present only for BLE downloads. Exists purely to support "export raw
  // dive data" round-tripping -- not for any parsing/decoding use.
  rawDataHex?: string | null;
}
