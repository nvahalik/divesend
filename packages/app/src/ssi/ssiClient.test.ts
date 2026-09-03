// app/src/ssi/ssiClient.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SSIHttpError,
  fetchGuestSsiToken,
  getDiveSites,
  getDivelog,
  linkSSI,
  saveDivelog,
  unlinkSSI,
} from './ssiClient';
import * as guestSsiSession from './guestSsiSession';

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

describe('guest bearer header', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('adds Authorization: Bearer when a guest SSI session exists', async () => {
    vi.spyOn(guestSsiSession, 'getGuestSsiSession').mockReturnValue({ token: 'guest-tok', ssiEmail: 'd@ssi.example' });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ odin_user_log_nr: 1 }]));
    vi.stubGlobal('fetch', fetchMock);

    await getDivelog();

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer guest-tok');
  });

  it('omits Authorization when no guest SSI session exists', async () => {
    vi.spyOn(guestSsiSession, 'getGuestSsiSession').mockReturnValue(null);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await getDivelog();

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers ?? {}).get('Authorization')).toBeNull();
  });

  it('saveDivelog carries the bearer header and the JSON body', async () => {
    vi.spyOn(guestSsiSession, 'getGuestSsiSession').mockReturnValue({ token: 'guest-tok', ssiEmail: 'd@ssi.example' });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: { odin_user_log_id: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    await saveDivelog({ odin_user_log_nr: 9 });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer guest-tok');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ odin_user_log_nr: 9 });
  });
});

describe('fetchGuestSsiToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs credentials to /api/ssi/guest-token and returns the token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ssiToken: 'new-token' }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchGuestSsiToken('d@ssi.example', 'pw')).toBe('new-token');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ssi/guest-token');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ ssiEmail: 'd@ssi.example', ssiPassword: 'pw' });
  });

  it('throws SSIHttpError with the server message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Invalid password' }, false, 401)));
    await expect(fetchGuestSsiToken('d@ssi.example', 'wrong')).rejects.toThrow('Invalid password');
  });
});
