// Mirrors webble/src/dive_decode.c's JSON output exactly — field names,
// types, and nullability. Do not rename fields here without also updating
// the C side; JSON.parse gives no compile-time cross-check between them.

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
}

export interface DiveSample {
  timeS: number;
  depthM: number;
  tempC: number | null;
  ndlS: number | null;
  tankPressureBar: number | null;
  decoStopDepthM: number | null;
  ttsS: number | null;
}

export interface CanonicalDive {
  header: DiveHeader;
  samples: DiveSample[];
}
