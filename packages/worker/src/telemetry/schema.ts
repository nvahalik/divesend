// worker/src/telemetry/schema.ts
// The one source of truth for the connect-telemetry wire shape, its validation,
// and its Analytics Engine column layout. The app (packages/app/src/engine/
// diagnostics.ts) builds the same shape independently — the two are kept in
// sync by hand; there is no shared package.

export const MAX_BODY_BYTES = 8192;
export const MAX_LOG_TAIL = 2048;

const OUTCOMES = ['success', 'no_new_dives', 'user_cancelled', 'error'] as const;
const STAGES = ['device_select', 'gatt_connect', 'service_probe', 'transport_open', 'open_device', 'download', 'persist'] as const;

export type ConnectOutcome = (typeof OUTCOMES)[number];
export type ConnectStage = (typeof STAGES)[number];

export interface ConnectEventPayload {
  diagnosticCode: string;
  outcome: ConnectOutcome;
  stage: ConnectStage;
  errorCode: string;
  vendor: string;
  product: string;
  fallbackMatch: boolean;
  diveCount: number;
  totalMs: number;
  gattMs: number;
  openDeviceMs: number;
  downloadMs: number;
  browserName: string;
  browserVersion: string;
  osName: string;
  appVersion: string;
  logTail?: string;
}

// Per-field string clamp lengths. Anything longer is truncated, not rejected —
// a slightly-too-long vendor string shouldn't lose us the whole event.
const STRING_MAX: Record<string, number> = {
  diagnosticCode: 32,
  errorCode: 64,
  vendor: 48,
  product: 64,
  browserName: 16,
  browserVersion: 12,
  osName: 16,
  appVersion: 24,
};

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampStr = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** Truncates to `maxBytes` UTF-8 bytes, not UTF-16 code units. Analytics
 *  Engine's ~5 KB per-data-point blob budget is byte-based, and an over-budget
 *  data point is rejected outright — a logTail of multi-byte characters that
 *  passed a code-unit clamp could be up to 3x over and lose the whole event.
 *  Truncation is backed off to the last whole character so the stored tail is
 *  never left with a mangled trailing code point. */
function clampBytes(s: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= maxBytes) return s;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, maxBytes)).replace(/�$/, '');
}

export function validateConnectEvent(body: unknown): ConnectEventPayload | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;

  if (typeof b.diagnosticCode !== 'string' || !/^DVS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(b.diagnosticCode)) return null;
  if (typeof b.outcome !== 'string' || !(OUTCOMES as readonly string[]).includes(b.outcome)) return null;
  if (typeof b.stage !== 'string' || !(STAGES as readonly string[]).includes(b.stage)) return null;
  if (typeof b.fallbackMatch !== 'boolean') return null;
  for (const k of ['diveCount', 'totalMs', 'gattMs', 'openDeviceMs', 'downloadMs']) {
    if (!isFiniteNumber(b[k])) return null;
  }
  for (const k of ['vendor', 'product', 'browserName', 'browserVersion', 'osName', 'appVersion']) {
    if (typeof b[k] !== 'string') return null;
  }

  const outcome = b.outcome as ConnectOutcome;
  const event: ConnectEventPayload = {
    diagnosticCode: b.diagnosticCode,
    outcome,
    stage: b.stage as ConnectStage,
    errorCode: outcome === 'error' ? clampStr(b.errorCode, STRING_MAX.errorCode) : '',
    vendor: clampStr(b.vendor, STRING_MAX.vendor),
    product: clampStr(b.product, STRING_MAX.product),
    fallbackMatch: b.fallbackMatch,
    diveCount: Math.max(0, Math.trunc(b.diveCount as number)),
    totalMs: Math.max(0, Math.trunc(b.totalMs as number)),
    gattMs: Math.max(0, Math.trunc(b.gattMs as number)),
    openDeviceMs: Math.max(0, Math.trunc(b.openDeviceMs as number)),
    downloadMs: Math.max(0, Math.trunc(b.downloadMs as number)),
    browserName: clampStr(b.browserName, STRING_MAX.browserName),
    browserVersion: clampStr(b.browserVersion, STRING_MAX.browserVersion),
    osName: clampStr(b.osName, STRING_MAX.osName),
    appVersion: clampStr(b.appVersion, STRING_MAX.appVersion),
  };
  if (outcome === 'error' && typeof b.logTail === 'string' && b.logTail.length > 0) {
    event.logTail = clampBytes(b.logTail, MAX_LOG_TAIL);
  }
  return event;
}

/** Canonical Analytics Engine layout. Keep in step with the SQL you query:
 *  blob1..blob11 and double1..double5 as ordered here. */
export function toDataPoint(p: ConnectEventPayload): AnalyticsEngineDataPoint {
  return {
    indexes: [p.diagnosticCode],
    blobs: [
      p.outcome,
      p.stage,
      p.errorCode,
      p.vendor,
      p.product,
      p.fallbackMatch ? '1' : '0',
      p.browserName,
      p.browserVersion,
      p.osName,
      p.appVersion,
      p.logTail ?? '',
    ],
    doubles: [p.diveCount, p.totalMs, p.gattMs, p.openDeviceMs, p.downloadMs],
  };
}
