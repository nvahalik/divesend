// app/src/ssi/ssiClient.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SSIHttpError, getDiveSites, getDivelog, linkSSI, saveDivelog, unlinkSSI } from './ssiClient';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('linkSSI', () => {
  it('POSTs the SSI credentials to /api/ssi/link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ssiEmail: 'diver@ssi.example' }));
    vi.stubGlobal('fetch', fetchMock);
    await linkSSI('diver@ssi.example', 'ssi-pass');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ssi/link');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ ssiEmail: 'diver@ssi.example', ssiPassword: 'ssi-pass' });
  });

  it('throws SSIHttpError with the server message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Invalid password' }, false, 401)));
    await expect(linkSSI('diver@ssi.example', 'wrong')).rejects.toThrow('Invalid password');
  });
});

describe('unlinkSSI', () => {
  it('DELETEs /api/ssi/link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await unlinkSSI();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ssi/link');
    expect(init.method).toBe('DELETE');
  });
});

describe('getDivelog', () => {
  it('GETs /api/ssi/divelog and returns the array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([{ odin_user_log_nr: 1 }])));
    expect(await getDivelog()).toEqual([{ odin_user_log_nr: 1 }]);
  });

  it('throws SSIHttpError when not linked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Link your SSI account first.' }, false, 409)));
    await expect(getDivelog()).rejects.toThrow(SSIHttpError);
  });
});

describe('getDiveSites', () => {
  it('GETs /api/ssi/sites', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([{ odin_dive_sites_id: 1 }])));
    expect(await getDiveSites()).toEqual([{ odin_dive_sites_id: 1 }]);
  });
});

describe('saveDivelog', () => {
  it('POSTs the payload to /api/ssi/divelog', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: { odin_user_log_id: 1 } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await saveDivelog({ odin_user_log_nr: 9 });
    expect(result).toEqual({ success: { odin_user_log_id: 1 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ssi/divelog');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ odin_user_log_nr: 9 });
  });
});
