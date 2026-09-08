// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetDiagOptInCacheForTests,
  RING_MAX_ENTRIES,
  buildConnectEvent,
  buildDiagnosticsText,
  classifyError,
  finishAttempt,
  getDiagLog,
  getDiagOptIn,
  getLastAttemptOutcome,
  makeDiagnosticCode,
  markStage,
  parseUserAgent,
  pushDiagLog,
  resetDiagLog,
  recordGuardRejection,
  sendLastConnectEvent,
  setAttemptDevice,
  setAttemptDeviceName,
  setDiagOptIn,
  startAttempt,
} from './diagnostics';

const CODE_RE = /^DVS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

describe('diagnostic code', () => {
  it('matches the DVS-XXXX-XXXX Crockford-base32 format', () => {
    for (let i = 0; i < 50; i++) expect(makeDiagnosticCode()).toMatch(CODE_RE);
  });
  it('is not trivially constant', () => {
    const codes = new Set(Array.from({ length: 20 }, () => makeDiagnosticCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('ring buffer', () => {
  beforeEach(() => resetDiagLog());

  it('keeps entries oldest-first with src/level/line', () => {
    pushDiagLog('js', 'first');
    pushDiagLog('dc', 'second', '3');
    const log = getDiagLog();
    expect(log.map((e) => e.line)).toEqual(['first', 'second']);
    expect(log[1]).toMatchObject({ src: 'dc', level: '3', line: 'second' });
    expect(typeof log[0].t).toBe('number');
  });

  it('evicts oldest entries past RING_MAX_ENTRIES (FIFO)', () => {
    for (let i = 0; i < RING_MAX_ENTRIES + 10; i++) pushDiagLog('js', `line ${i}`);
    const log = getDiagLog();
    expect(log.length).toBe(RING_MAX_ENTRIES);
    expect(log[0].line).toBe('line 10');
    expect(log[log.length - 1].line).toBe(`line ${RING_MAX_ENTRIES + 9}`);
  });

  it('evicts past the byte cap even when entry count is low', () => {
    const big = 'x'.repeat(200 * 1024);
    pushDiagLog('js', big);
    pushDiagLog('js', big);
    pushDiagLog('js', big); // 600 KB total > 512 KB cap
    const log = getDiagLog();
    expect(log.length).toBeLessThan(3);
  });

  it('resetDiagLog empties the buffer', () => {
    pushDiagLog('js', 'x');
    resetDiagLog();
    expect(getDiagLog()).toEqual([]);
  });
});

describe('parseUserAgent', () => {
  it('buckets Chrome on Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
    expect(parseUserAgent(ua)).toEqual({ browserName: 'chrome', browserVersion: '121', osName: 'windows' });
  });
  it('buckets Safari on iOS', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1';
    expect(parseUserAgent(ua)).toEqual({ browserName: 'safari', browserVersion: '17', osName: 'ios' });
  });
  it('buckets Edge on macOS', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
    expect(parseUserAgent(ua)).toEqual({ browserName: 'edge', browserVersion: '120', osName: 'macos' });
  });
  it('falls back to other/other for junk', () => {
    expect(parseUserAgent('nonsense')).toEqual({ browserName: 'other', browserVersion: '', osName: 'other' });
  });
});

describe('buildDiagnosticsText', () => {
  beforeEach(() => resetDiagLog());
  it('includes the header fields, the device-name warning, and every log line', () => {
    pushDiagLog('js', 'Selected device');
    pushDiagLog('dc', 'packet in', '4');
    const text = buildDiagnosticsText(
      {
        code: 'DVS-ABCD-2345',
        generatedAt: '2026-09-08T00:00:00.000Z',
        appVersion: 'abc1234',
        ua: { browserName: 'chrome', browserVersion: '121', osName: 'macos' },
        vendor: 'Shearwater',
        product: 'Perdix',
        fallbackMatch: false,
        timings: { totalMs: 4200, gattMs: 300, openDeviceMs: 120, downloadMs: 3600 },
      },
      getDiagLog(),
    );
    expect(text).toContain('Diagnostic code: DVS-ABCD-2345');
    expect(text).toContain('App version: abc1234');
    expect(text).toContain('Shearwater Perdix');
    expect(text).toContain('Bluetooth name');
    expect(text).toContain('Selected device');
    expect(text).toContain('packet in');
  });
});

describe('opt-in preference', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetDiagOptInCacheForTests();
  });
  afterEach(() => vi.restoreAllMocks());

  it('defaults to unset', () => expect(getDiagOptIn()).toBe('unset'));
  it('round-trips granted / denied', () => {
    expect(setDiagOptIn('granted')).toBe(true);
    expect(getDiagOptIn()).toBe('granted');
    expect(setDiagOptIn('denied')).toBe(true);
    expect(getDiagOptIn()).toBe('denied');
  });

  it('survives a failed localStorage write for this session', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(setDiagOptIn('granted')).toBe(false); // the caller can surface this
    expect(getDiagOptIn()).toBe('granted'); // ...but consent still holds
  });

  it('still posts sendLastConnectEvent when the consent write failed', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}')));
    startAttempt();
    finishAttempt('error', 'x', 0);

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(setDiagOptIn('granted')).toBe(false);
    sendLastConnectEvent();
    expect(fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe('recordGuardRejection', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetDiagOptInCacheForTests();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}')));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts nothing when opt-in is not granted', () => {
    recordGuardRejection('already_running');
    expect(fetch as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('posts a minimal payload with no logTail when granted', () => {
    // A ring full of packet noise must NOT ride along on a guard rejection.
    startAttempt();
    pushDiagLog('dc', 'in-flight attempt packet noise', '4');
    setDiagOptIn('granted');

    recordGuardRejection('already_running');
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({
      outcome: 'error',
      stage: 'device_select',
      errorCode: 'already_running',
      vendor: '',
      product: '',
      fallbackMatch: false,
      diveCount: 0,
      totalMs: 0,
      gattMs: 0,
      openDeviceMs: 0,
      downloadMs: 0,
    });
    expect(body.diagnosticCode).toMatch(CODE_RE);
    expect(body.appVersion).toBeTruthy();
    expect('logTail' in body).toBe(false);
    // The in-flight attempt's ring buffer is untouched.
    expect(getDiagLog().some((e) => e.line.includes('packet noise'))).toBe(true);
  });
});

describe('classifyError', () => {
  it('names DOMExceptions', () => {
    expect(classifyError(new DOMException('x', 'NotFoundError'))).toBe('dom:NotFoundError');
  });
  it('collapses generic errors', () => {
    expect(classifyError(new Error('boom'))).toBe('exception');
    expect(classifyError('nope')).toBe('unknown');
  });
});

describe('connect event shaping', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetDiagOptInCacheForTests();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}')));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('captures stage, timings, device, coarse env and app version', () => {
    const code = startAttempt();
    expect(code).toMatch(CODE_RE);
    markStage('device_select');
    markStage('gatt_connect');
    markStage('service_probe');
    markStage('open_device');
    setAttemptDevice('Shearwater', 'Perdix', false);
    markStage('download');
    finishAttempt('success', null, 3);

    const ev = buildConnectEvent();
    expect(ev.diagnosticCode).toBe(code);
    expect(ev.outcome).toBe('success');
    expect(ev.stage).toBe('download');
    expect(ev.vendor).toBe('Shearwater');
    expect(ev.product).toBe('Perdix');
    expect(ev.diveCount).toBe(3);
    expect(ev.appVersion).toBeTruthy();
    expect(ev.totalMs).toBeGreaterThanOrEqual(0);
    expect(ev.gattMs).toBeGreaterThanOrEqual(0);
    expect('logTail' in ev).toBe(false); // success → no tail
  });

  it('attaches a device-name-scrubbed logTail only on error', () => {
    startAttempt();
    setAttemptDeviceName("Jane's Perdix");
    pushDiagLog('dc', "connecting to Jane's Perdix over GATT", '4');
    markStage('gatt_connect');
    finishAttempt('error', 'dom:NetworkError', 0);

    const ev = buildConnectEvent();
    expect(ev.outcome).toBe('error');
    expect(ev.errorCode).toBe('dom:NetworkError');
    expect(ev.logTail).toBeDefined();
    expect(ev.logTail).toContain('<device-name>');
    expect(ev.logTail).not.toContain("Jane's Perdix");
    expect(ev.logTail!.length).toBeLessThanOrEqual(2048);
  });

  it('redacts long hex runs from the transmitted logTail but not the local export', () => {
    const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4'; // 40 chars
    startAttempt();
    pushDiagLog('dc', `packet in: ${hex} status 0x40 tag 12ab`, '4');
    finishAttempt('error', 'dom:NetworkError', 0);

    const ev = buildConnectEvent();
    expect(ev.logTail).toContain('<hex>');
    expect(ev.logTail).not.toContain(hex);
    // Short hex-ish tokens are ordinary log content and stay readable.
    expect(ev.logTail).toContain('0x40');
    expect(ev.logTail).toContain('12ab');
    // The user's own export is unaffected -- it's local and explicitly labelled.
    expect(getDiagLog()[0].line).toContain(hex);
  });

  it("doesn't let a per-dive persist mark claim the stage of a later failure", () => {
    startAttempt();
    markStage('download');
    markStage('persist'); // fires once per dive, from inside downloadNewDives
    markStage('persist');
    finishAttempt('error', 'download:-3', 2);
    expect(buildConnectEvent().stage).toBe('download');
  });

  it('still reports persist as the stage for a run that succeeded', () => {
    startAttempt();
    markStage('download');
    markStage('persist');
    finishAttempt('success', null, 2);
    expect(buildConnectEvent().stage).toBe('persist');
  });

  it('POSTs on finishAttempt only when opt-in is granted', () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;

    startAttempt();
    finishAttempt('error', 'x', 0);
    expect(fetchMock).not.toHaveBeenCalled(); // unset

    setDiagOptIn('granted');
    startAttempt();
    finishAttempt('success', null, 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/telemetry/connect');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
  });

  it('sendLastConnectEvent posts the last built event (opt-in card path)', () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    startAttempt();
    finishAttempt('error', 'x', 0);
    expect(fetchMock).not.toHaveBeenCalled();

    expect(getLastAttemptOutcome()).toBe('error');
    setDiagOptIn('granted');
    sendLastConnectEvent();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
