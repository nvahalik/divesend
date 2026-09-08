// app/src/engine/diagnostics.ts
// Local capture + (opt-in) telemetry for the BLE connect/download flow. This
// file owns the diagnostic log ring buffer, the per-attempt diagnostic code,
// coarse environment parsing, and the human-readable export. Attempt lifecycle,
// the opt-in preference, and the telemetry POST are added in a second slice
// further down this file.
//
// Privacy: nothing here writes dive data, fingerprints, serials, or the
// user-set Bluetooth device name anywhere it can leave the device except the
// user-initiated export (which is explicitly labelled).

import { readLocalStorage, writeLocalStorage } from '../lib/storage';

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export const RING_MAX_ENTRIES = 4000;
export const RING_MAX_CHARS = 512 * 1024;

export interface DiagLogEntry {
  /** ms since this attempt's epoch (see resetDiagLog). */
  t: number;
  src: 'js' | 'dc';
  /** raw dc_loglevel_t int as a string, for 'dc' entries only. */
  level?: string;
  line: string;
}

let ringEntries: DiagLogEntry[] = [];
let ringChars = 0;
let epoch = Date.now();

export function resetDiagLog(): void {
  ringEntries = [];
  ringChars = 0;
  epoch = Date.now();
}

export function pushDiagLog(src: 'js' | 'dc', line: string, level?: string): void {
  const entry: DiagLogEntry = { t: Date.now() - epoch, src, line, ...(level !== undefined ? { level } : {}) };
  ringEntries.push(entry);
  ringChars += line.length;
  while (ringEntries.length > RING_MAX_ENTRIES || (ringChars > RING_MAX_CHARS && ringEntries.length > 1)) {
    const dropped = ringEntries.shift()!;
    ringChars -= dropped.line.length;
  }
}

export function getDiagLog(): DiagLogEntry[] {
  return ringEntries.slice();
}

// ---- diagnostic code -------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** DVS-XXXX-XXXX, X ∈ Crockford base32. ~1e12 space — collision-tolerant for a
 *  support handle, not a security token. */
export function makeDiagnosticCode(): string {
  const bytes = new Uint8Array(8);
  (globalThis.crypto ?? crypto).getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => CROCKFORD[b % 32]);
  return `DVS-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}`;
}

// ---- coarse environment --------------------------------------------------

export interface CoarseUA {
  browserName: string;
  browserVersion: string;
  osName: string;
}

/** Deliberately tiny bucketer — enough to answer "which browsers/OSes fail",
 *  not a UA-parsing library. Order matters: Edge/Chrome both contain "Chrome". */
export function parseUserAgent(ua: string): CoarseUA {
  const s = ua || '';
  let browserName = 'other';
  let browserVersion = '';
  const grab = (re: RegExp): string => {
    const m = s.match(re);
    return m ? m[1] : '';
  };
  if (/\bEdg\//.test(s)) {
    browserName = 'edge';
    browserVersion = grab(/\bEdg\/(\d+)/);
  } else if (/\bFirefox\//.test(s)) {
    browserName = 'firefox';
    browserVersion = grab(/\bFirefox\/(\d+)/);
  } else if (/\bChrome\//.test(s)) {
    browserName = 'chrome';
    browserVersion = grab(/\bChrome\/(\d+)/);
  } else if (/\bVersion\/[\d.]+ .*Safari\//.test(s) || (/\bSafari\//.test(s) && !/\bChrome\//.test(s))) {
    browserName = 'safari';
    browserVersion = grab(/\bVersion\/(\d+)/);
  }

  let osName = 'other';
  if (/Android/.test(s)) osName = 'android';
  else if (/iPhone|iPad|iPod/.test(s)) osName = 'ios';
  else if (/Mac OS X/.test(s)) osName = 'macos';
  else if (/Windows/.test(s)) osName = 'windows';
  else if (/Linux/.test(s)) osName = 'linux';

  return { browserName, browserVersion, osName };
}

export function currentUA(): CoarseUA {
  return parseUserAgent(typeof navigator !== 'undefined' ? navigator.userAgent : '');
}

// ---- export text -------------------------------------------------------

export interface DiagTimings {
  totalMs: number;
  gattMs: number;
  openDeviceMs: number;
  downloadMs: number;
}

export interface DiagnosticsTextMeta {
  code: string;
  generatedAt: string;
  appVersion: string;
  ua: CoarseUA;
  vendor: string;
  product: string;
  fallbackMatch: boolean;
  timings: DiagTimings;
}

export function buildDiagnosticsText(meta: DiagnosticsTextMeta, entries: DiagLogEntry[]): string {
  const lines = entries.map((e) => `  +${e.t}ms [${e.src}${e.level ? '/' + e.level : ''}] ${e.line}`);
  return [
    'DiveSend connect diagnostics',
    `Generated: ${meta.generatedAt}`,
    `App version: ${meta.appVersion}`,
    `Diagnostic code: ${meta.code}`,
    `Browser: ${meta.ua.browserName} ${meta.ua.browserVersion}   OS: ${meta.ua.osName}`,
    `Device: ${meta.vendor || '(unknown)'} ${meta.product || ''}  (fallback match: ${meta.fallbackMatch ? 'yes' : 'no'})`,
    `Timings: total ${meta.timings.totalMs}ms  gatt ${meta.timings.gattMs}ms  openDevice ${meta.timings.openDeviceMs}ms  download ${meta.timings.downloadMs}ms`,
    '',
    'NOTE: the log below can contain the Bluetooth name you gave your dive',
    'computer. Remove it before sharing publicly if that name is personal.',
    '',
    '--- log ---',
    ...lines,
    '',
  ].join('\n');
}

// ==========================================================================
// Attempt lifecycle + opt-in + telemetry
// ==========================================================================

export type DiagStage =
  | 'device_select'
  | 'gatt_connect'
  | 'service_probe'
  | 'transport_open'
  | 'open_device'
  | 'download'
  | 'persist';

export type DiagOutcome = 'success' | 'no_new_dives' | 'user_cancelled' | 'error';
export type DiagOptIn = 'granted' | 'denied' | 'unset';

export const DIAG_OPTIN_KEY = 'divesend-diagnostics-optin';
const TELEMETRY_ENDPOINT = '/api/telemetry/connect';
const LOG_TAIL_MAX = 2048;

export function getDiagOptIn(): DiagOptIn {
  const v = readLocalStorage(DIAG_OPTIN_KEY);
  return v === 'granted' || v === 'denied' ? v : 'unset';
}

export function setDiagOptIn(v: 'granted' | 'denied'): void {
  writeLocalStorage(DIAG_OPTIN_KEY, v);
}

interface AttemptState {
  code: string;
  startedAt: number;
  stageAt: Partial<Record<DiagStage, number>>;
  lastStage: DiagStage;
  vendor: string;
  product: string;
  fallbackMatch: boolean;
  deviceName: string;
  outcome: DiagOutcome | null;
  errorCode: string;
  diveCount: number;
  finishedAt: number | null;
}

function freshAttempt(code: string): AttemptState {
  return {
    code,
    startedAt: Date.now(),
    stageAt: {},
    lastStage: 'device_select',
    vendor: '',
    product: '',
    fallbackMatch: false,
    deviceName: '',
    outcome: null,
    errorCode: '',
    diveCount: 0,
    finishedAt: null,
  };
}

let attempt: AttemptState = freshAttempt(makeDiagnosticCode());
let lastAttempt: AttemptState | null = null;

export function startAttempt(): string {
  resetDiagLog();
  attempt = freshAttempt(makeDiagnosticCode());
  attempt.stageAt.device_select = Date.now();
  return attempt.code;
}

export function markStage(stage: DiagStage): void {
  attempt.lastStage = stage;
  if (attempt.stageAt[stage] === undefined) attempt.stageAt[stage] = Date.now();
}

export function setAttemptDevice(vendor: string, product: string, fallbackMatch: boolean): void {
  attempt.vendor = vendor;
  attempt.product = product;
  attempt.fallbackMatch = fallbackMatch;
}

export function setAttemptDeviceName(name: string): void {
  attempt.deviceName = name;
}

function timingsFor(a: AttemptState): DiagTimings {
  const end = a.finishedAt ?? Date.now();
  const span = (from?: number, to?: number): number => (from !== undefined && to !== undefined ? Math.max(0, to - from) : 0);
  return {
    totalMs: Math.max(0, end - a.startedAt),
    gattMs: span(a.stageAt.gatt_connect, a.stageAt.service_probe ?? a.stageAt.transport_open),
    openDeviceMs: span(a.stageAt.open_device, a.stageAt.download ?? end),
    downloadMs: span(a.stageAt.download, end),
  };
}

export function currentTimings(): DiagTimings {
  return timingsFor(attempt);
}

export function currentAttemptMeta(): { code: string; vendor: string; product: string; fallbackMatch: boolean } {
  return { code: attempt.code, vendor: attempt.vendor, product: attempt.product, fallbackMatch: attempt.fallbackMatch };
}

export function getLastAttemptOutcome(): DiagOutcome | null {
  return lastAttempt?.outcome ?? null;
}

export function classifyError(e: unknown): string {
  if (typeof DOMException !== 'undefined' && e instanceof DOMException) return `dom:${e.name}`;
  if (e instanceof Error) return 'exception';
  return 'unknown';
}

function scrub(text: string, deviceName: string): string {
  if (!deviceName) return text;
  return text.split(deviceName).join('<device-name>');
}

export interface ConnectEventPayload {
  diagnosticCode: string;
  outcome: DiagOutcome;
  stage: DiagStage;
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

function buildConnectEventFrom(a: AttemptState): ConnectEventPayload {
  const ua = currentUA();
  const t = timingsFor(a);
  const payload: ConnectEventPayload = {
    diagnosticCode: a.code,
    outcome: a.outcome ?? 'error',
    stage: a.lastStage,
    errorCode: a.outcome === 'error' ? a.errorCode : '',
    vendor: a.vendor,
    product: a.product,
    fallbackMatch: a.fallbackMatch,
    diveCount: a.diveCount,
    totalMs: t.totalMs,
    gattMs: t.gattMs,
    openDeviceMs: t.openDeviceMs,
    downloadMs: t.downloadMs,
    browserName: ua.browserName,
    browserVersion: ua.browserVersion,
    osName: ua.osName,
    appVersion: APP_VERSION,
  };
  if (payload.outcome === 'error') {
    const tail = getDiagLog()
      .map((e) => `+${e.t}ms [${e.src}${e.level ? '/' + e.level : ''}] ${e.line}`)
      .join('\n');
    payload.logTail = scrub(tail, a.deviceName).slice(-LOG_TAIL_MAX);
  }
  return payload;
}

/** Shape a payload from the *current* attempt (call after finishAttempt). */
export function buildConnectEvent(): ConnectEventPayload {
  return buildConnectEventFrom(lastAttempt ?? attempt);
}

function post(payload: ConnectEventPayload): void {
  try {
    void fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    // fetch itself threw (very old engine / test env without fetch) — ignore.
  }
}

export function finishAttempt(outcome: DiagOutcome, errorCode: string | null, diveCount: number): void {
  attempt.outcome = outcome;
  attempt.errorCode = errorCode ?? '';
  attempt.diveCount = diveCount;
  attempt.finishedAt = Date.now();
  lastAttempt = attempt;
  if (getDiagOptIn() === 'granted') post(buildConnectEventFrom(attempt));
}

/** Post the most recently finished attempt's event — the opt-in card calls
 *  this right after setDiagOptIn('granted') so the failure that triggered the
 *  card is the first thing reported. */
export function sendLastConnectEvent(): void {
  if (lastAttempt && getDiagOptIn() === 'granted') post(buildConnectEventFrom(lastAttempt));
}
