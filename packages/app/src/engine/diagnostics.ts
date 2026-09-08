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
