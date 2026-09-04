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
  startTime: string; // ISO 8601, e.g. "2026-08-22T11:42:10Z"
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
}

export interface GasMix {
  o2Percent: number;
  hePercent: number;
}

export interface CanonicalDive {
  header: DiveHeader;
  samples: DiveSample[];
}
