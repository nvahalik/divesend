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

// In-memory shadow of the persisted preference. localStorage writes can fail
// outright (Safari private browsing, storage disabled) -- without this, a user
// who just clicked "Share report" would have their consent silently voided on
// the very next read, so nothing would ever be sent even though the UI said it
// was. The in-memory copy keeps consent honest for the rest of the session.
let memOptIn: DiagOptIn | null = null;

/** Test-only: drops the in-memory consent shadow so a suite can start from a
 *  clean slate after clearing localStorage. */
export function __resetDiagOptInCacheForTests(): void {
  memOptIn = null;
}

export function getDiagOptIn(): DiagOptIn {
  if (memOptIn !== null) return memOptIn;
  const v = readLocalStorage(DIAG_OPTIN_KEY);
  return v === 'granted' || v === 'denied' ? v : 'unset';
}

/** Returns false if the preference could not be persisted (it still applies
 *  for this session -- see memOptIn). */
export function setDiagOptIn(v: 'granted' | 'denied'): boolean {
  memOptIn = v;
  return writeLocalStorage(DIAG_OPTIN_KEY, v);
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
  /** markStage('persist') fires once per dive from inside the download call, so
   *  it must not be allowed to claim `lastStage` -- a download that then fails
   *  failed at 'download', not at 'persist'. Recorded separately and only
   *  reported as the stage for a non-error outcome. */
  persistReached: boolean;
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
    persistReached: false,
    outcome: null,
    errorCode: '',
    diveCount: 0,
    finishedAt: null,
  };
}

// Lazily created: building it at module load would call crypto.getRandomValues
// during the import graph, so a missing/blocked `crypto` would take down the
// whole app rather than just the diagnostics feature.
let attempt: AttemptState | null = null;
let lastAttempt: AttemptState | null = null;

function ensureAttempt(): AttemptState {
  return (attempt ??= freshAttempt(makeDiagnosticCode()));
}

export function startAttempt(): string {
  resetDiagLog();
  attempt = freshAttempt(makeDiagnosticCode());
  attempt.stageAt.device_select = Date.now();
  return attempt.code;
}

export function markStage(stage: DiagStage): void {
  const a = ensureAttempt();
  // Timestamps are recorded for every stage (timings need them), but 'persist'
  // never claims lastStage -- see AttemptState.persistReached.
  if (stage === 'persist') a.persistReached = true;
  else a.lastStage = stage;
  if (a.stageAt[stage] === undefined) a.stageAt[stage] = Date.now();
}

export function setAttemptDevice(vendor: string, product: string, fallbackMatch: boolean): void {
  const a = ensureAttempt();
  a.vendor = vendor;
  a.product = product;
  a.fallbackMatch = fallbackMatch;
}

export function setAttemptDeviceName(name: string): void {
  ensureAttempt().deviceName = name;
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
  return timingsFor(ensureAttempt());
}

export function currentAttemptMeta(): { code: string; vendor: string; product: string; fallbackMatch: boolean } {
  const a = ensureAttempt();
  return { code: a.code, vendor: a.vendor, product: a.product, fallbackMatch: a.fallbackMatch };
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
    // 'persist' is only meaningful as a terminal stage for a run that didn't
    // fail; on an error the stage is wherever the failing call actually was.
    stage: a.persistReached && a.outcome !== 'error' ? 'persist' : a.lastStage,
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
    const raw = getDiagLog()
      .map((e) => `+${e.t}ms [${e.src}${e.level ? '/' + e.level : ''}] ${e.line}`)
      .join('\n');
    // A DC_LOGLEVEL_ALL tail is full of packet hex dumps, which can carry the
    // device serial and raw dive-profile bytes -- neither may ever leave the
    // device. Redact long hex runs from the TRANSMITTED tail only; the local
    // export (buildDiagnosticsText) stays full-fidelity for the user's own
    // support ticket. Order matters: hex-redact, then device-name scrub, then
    // clamp, so the clamp can never re-expose a partially redacted run.
    const redacted = raw.replace(/\b[0-9a-fA-F]{16,}\b/g, '<hex>');
    payload.logTail = scrub(redacted, a.deviceName).slice(-LOG_TAIL_MAX);
  }
  return payload;
}

/** Shape a payload from the *current* attempt (call after finishAttempt). */
export function buildConnectEvent(): ConnectEventPayload {
  return buildConnectEventFrom(lastAttempt ?? ensureAttempt());
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
  const a = ensureAttempt();
  a.outcome = outcome;
  a.errorCode = errorCode ?? '';
  a.diveCount = diveCount;
  a.finishedAt = Date.now();
  lastAttempt = a;
  if (getDiagOptIn() === 'granted') post(buildConnectEventFrom(a));
}

/** Records a one-off connect-guard rejection that happens before/around an
 *  attempt, without disturbing any in-flight attempt's ring buffer or timers.
 *  Posts immediately if opted in. Carries no log tail -- there is nothing to
 *  say beyond "the guard fired", and the in-flight attempt's ring belongs to
 *  that attempt, not this rejection. */
export function recordGuardRejection(errorCode: string): void {
  if (getDiagOptIn() !== 'granted') return;
  const ua = currentUA();
  post({
    diagnosticCode: makeDiagnosticCode(),
    outcome: 'error',
    stage: 'device_select',
    errorCode,
    vendor: '',
    product: '',
    fallbackMatch: false,
    diveCount: 0,
    totalMs: 0,
    gattMs: 0,
    openDeviceMs: 0,
    downloadMs: 0,
    browserName: ua.browserName,
    browserVersion: ua.browserVersion,
    osName: ua.osName,
    appVersion: APP_VERSION,
  });
}

/** Post the most recently finished attempt's event — the opt-in card calls
 *  this right after setDiagOptIn('granted') so the failure that triggered the
 *  card is the first thing reported. */
export function sendLastConnectEvent(): void {
  if (lastAttempt && getDiagOptIn() === 'granted') post(buildConnectEventFrom(lastAttempt));
}
