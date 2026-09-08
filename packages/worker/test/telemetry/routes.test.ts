import { describe, expect, it, vi } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../../src/index';
import { toDataPoint, validateConnectEvent } from '../../src/telemetry/schema';

const GOOD = {
  diagnosticCode: 'DVS-ABCD-2345',
  outcome: 'error',
  stage: 'open_device',
  errorCode: 'webble_open_device:-2',
  vendor: 'Shearwater',
  product: 'Perdix',
  fallbackMatch: true,
  diveCount: 0,
  totalMs: 4200,
  gattMs: 300,
  openDeviceMs: 120,
  downloadMs: 0,
  browserName: 'chrome',
  browserVersion: '121',
  osName: 'macos',
  appVersion: 'abc1234',
  logTail: 'line a\nline b',
};

const post = async (body: unknown, headers: Record<string, string> = { Origin: 'http://localhost', 'content-type': 'application/json' }) => {
  const req = new Request('http://localhost/api/telemetry/connect', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
};

describe('toDataPoint', () => {
  it('lays out blobs and doubles in the canonical order', () => {
    const dp = toDataPoint(validateConnectEvent(GOOD)!);
    expect(dp.indexes).toEqual(['DVS-ABCD-2345']);
    expect(dp.blobs).toEqual([
      'error', 'open_device', 'webble_open_device:-2', 'Shearwater', 'Perdix', '1',
      'chrome', '121', 'macos', 'abc1234', 'line a\nline b',
    ]);
    expect(dp.doubles).toEqual([0, 4200, 300, 120, 0]);
  });
});

describe('validateConnectEvent', () => {
  it('accepts a well-formed payload', () => {
    expect(validateConnectEvent(GOOD)).not.toBeNull();
  });
  it('rejects a missing required field', () => {
    const { vendor, ...rest } = GOOD;
    expect(validateConnectEvent(rest)).toBeNull();
  });
  it('rejects a bad outcome enum', () => {
    expect(validateConnectEvent({ ...GOOD, outcome: 'exploded' })).toBeNull();
  });
  it('clamps an oversize logTail to 2048 bytes', () => {
    const ev = validateConnectEvent({ ...GOOD, logTail: 'x'.repeat(5000) })!;
    expect(new TextEncoder().encode(ev.logTail!).length).toBeLessThanOrEqual(2048);
    expect(ev.logTail!.length).toBe(2048); // pure ASCII: bytes == code units
  });

  it('clamps by BYTES, not UTF-16 code units (AE blob budget is byte-based)', () => {
    // 2000 chars of 3-byte characters = 6000 bytes; a code-unit clamp would
    // have let ~6 KB through and the whole data point would be dropped.
    const ev = validateConnectEvent({ ...GOOD, logTail: '中'.repeat(2000) })!;
    expect(new TextEncoder().encode(ev.logTail!).length).toBeLessThanOrEqual(2048);
    expect(ev.logTail!.length).toBeGreaterThan(0);
    expect(ev.logTail).not.toContain('�'); // no mangled trailing code point
  });
  it('drops logTail when outcome !== error', () => {
    const ev = validateConnectEvent({ ...GOOD, outcome: 'success', logTail: 'stuff' })!;
    expect(ev.logTail).toBeUndefined();
  });
});

describe('POST /api/telemetry/connect', () => {
  it('rejects a request with no Origin (403)', async () => {
    const res = await post(GOOD, { 'content-type': 'application/json' });
    expect(res.status).toBe(403);
  });
  it('rejects a cross-origin request (403)', async () => {
    const res = await post(GOOD, { Origin: 'http://evil.example', 'content-type': 'application/json' });
    expect(res.status).toBe(403);
  });
  it('rejects a body over 8 KB (413)', async () => {
    const res = await post('{"x":"' + 'y'.repeat(9000) + '"}');
    expect(res.status).toBe(413);
  });
  it('rejects malformed JSON (400)', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
  });
  it('rejects a schema-invalid body (400)', async () => {
    const res = await post({ ...GOOD, stage: 'nope' });
    expect(res.status).toBe(400);
  });
  it('accepts a valid event (200 { ok: true }) and writes exactly one data point', async () => {
    const spy = vi.spyOn(env.CONNECT_TELEMETRY, 'writeDataPoint');
    const res = await post(GOOD);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toEqual(toDataPoint(validateConnectEvent(GOOD)!));
    spy.mockRestore();
  });

  it('still 200s when the Analytics Engine write throws', async () => {
    const spy = vi.spyOn(env.CONNECT_TELEMETRY, 'writeDataPoint').mockImplementation(() => {
      throw new Error('quota');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(GOOD);
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalled(); // observable, not silently swallowed
    spy.mockRestore();
    errSpy.mockRestore();
  });
});
