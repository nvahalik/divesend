// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  RING_MAX_ENTRIES,
  buildDiagnosticsText,
  getDiagLog,
  makeDiagnosticCode,
  parseUserAgent,
  pushDiagLog,
  resetDiagLog,
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
