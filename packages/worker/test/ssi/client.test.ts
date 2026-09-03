import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SSIAuthenticationError,
  SSIResponseShapeError,
  SSIUpstreamError,
  ssiAuthenticate,
  ssiGetDiveSites,
  ssiGetDivelog,
  ssiSaveDivelog,
} from '../../src/ssi/client';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ssiAuthenticate', () => {
  it('returns the token on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ authenticated: true, token: 'abc123' })));
    expect(await ssiAuthenticate('a@b.com', 'pw')).toBe('abc123');
  });

  it('throws SSIAuthenticationError with the server message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ authenticated: false, error_message: 'Invalid password' })));
    await expect(ssiAuthenticate('a@b.com', 'wrong')).rejects.toThrow('Invalid password');
  });

  it('throws SSIUpstreamError on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));
    await expect(ssiAuthenticate('a@b.com', 'pw')).rejects.toThrow(SSIUpstreamError);
  });
});

describe('ssiGetDivelog', () => {
  it('returns logbook_details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ logbook_details: [{ odin_user_log_nr: 1 }] })));
    expect(await ssiGetDivelog('token')).toEqual([{ odin_user_log_nr: 1 }]);
  });

  it('throws SSIResponseShapeError when logbook_details is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));
    await expect(ssiGetDivelog('token')).rejects.toThrow(SSIResponseShapeError);
  });
});

describe('ssiGetDiveSites', () => {
  it('returns logbook_sites', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ logbook_sites: [{ odin_dive_sites_id: 1 }] })));
    expect(await ssiGetDiveSites('token')).toEqual([{ odin_dive_sites_id: 1 }]);
  });

  it('returns an empty array when logbook_sites is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));
    expect(await ssiGetDiveSites('token')).toEqual([]);
  });
});

describe('ssiSaveDivelog', () => {
  it('POSTs form-encoded json_data and returns the parsed response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: { odin_user_log_id: 1 } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await ssiSaveDivelog('token', { odin_user_log_nr: 9 });
    expect(result).toEqual({ success: { odin_user_log_id: 1 } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('json_data=');
  });
});
