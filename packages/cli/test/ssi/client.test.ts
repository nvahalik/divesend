// TS port of tests/test_divelog_api_client.py -- the HTTP layer. `fetch` is
// stubbed; no real network calls. The Python asserts on `requests` call kwargs
// (params / data); here we assert on the built URL and the form body.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_PARAMS,
  authenticate,
  deleteGear,
  findDive,
  getDivelog,
  getGear,
  getGearsets,
  saveDive,
  saveGear,
  saveGearset,
  type Divelog,
} from '../../src/ssi/client.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/ssi_get_divelog.json', import.meta.url));
const divelog = () => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Divelog;

let fetchMock: ReturnType<typeof vi.fn>;

function okJson(payload: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(''),
  };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const calledUrl = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]));
const calledInit = (i = 0) => fetchMock.mock.calls[i][1] as RequestInit | undefined;

describe('authenticate', () => {
  it('GETs ?what=authenticate&l=&p= with the app params and returns the token', async () => {
    fetchMock.mockResolvedValue(okJson({ authenticated: true, token: 'tok-abc' }));

    const token = await authenticate('me@example.com', 's3cret');

    expect(token).toBe('tok-abc');
    const url = calledUrl();
    expect(url.origin + url.pathname).toBe('https://api.divessi.com/app/a21.php');
    expect(url.searchParams.get('what')).toBe('authenticate');
    expect(url.searchParams.get('l')).toBe('me@example.com');
    expect(url.searchParams.get('p')).toBe('s3cret');
    for (const [k, val] of Object.entries(APP_PARAMS)) {
      expect(url.searchParams.get(k)).toBe(val);
    }
    // GET: no second arg / no method.
    expect(calledInit()).toBeUndefined();
  });

  it('throws when the response is not authenticated', async () => {
    fetchMock.mockResolvedValue(okJson({ authenticated: false, error_message: 'bad login' }));
    await expect(authenticate('a', 'b')).rejects.toThrow('bad login');
  });
});

describe('non-2xx handling', () => {
  it('throws with the response text', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('HTTP 500 -- upstream boom'),
    });
    await expect(getDivelog('tok')).rejects.toThrow('HTTP 500 -- upstream boom');
  });
});

describe('getDivelog', () => {
  it('GETs ?what=get_divelog&token= and returns the parsed dump', async () => {
    fetchMock.mockResolvedValue(okJson(divelog()));

    const result = await getDivelog('tok123');

    expect(result.logbook_details).toHaveLength(3);
    const url = calledUrl();
    expect(url.searchParams.get('what')).toBe('get_divelog');
    expect(url.searchParams.get('token')).toBe('tok123');
  });
});

describe('getGear', () => {
  it('calls the expected endpoint and returns JSON', async () => {
    fetchMock.mockResolvedValue(okJson([{ gear_id: 382015, gear_deleted: 0 }]));

    const result = await getGear('tok123');

    expect(result).toEqual([{ gear_id: 382015, gear_deleted: 0 }]);
    const url = calledUrl();
    expect(url.searchParams.get('what')).toBe('get_gear');
    expect(url.searchParams.get('token')).toBe('tok123');
  });
});

describe('saveGear', () => {
  it('POSTs json_data and returns JSON', async () => {
    fetchMock.mockResolvedValue(okJson({ gear_id: 382015, gear_comment: 'updated' }));
    const payload = { gear_id: 382015, gear_comment: 'updated' };

    const result = await saveGear('tok123', payload);

    expect(result).toEqual(payload);
    const url = calledUrl();
    expect(url.searchParams.get('what')).toBe('save_gear');
    expect(url.searchParams.get('token')).toBe('tok123');
    const body = new URLSearchParams(String(calledInit()!.body));
    expect(JSON.parse(body.get('json_data')!)).toEqual(payload);
  });

  it('create signal is an empty-string gear_id', async () => {
    fetchMock.mockResolvedValue(okJson({ gear_id: 396560 }));
    const payload = { gear_id: '', gear_product_name_modell: 'New Item' };

    await saveGear('tok123', payload);

    const body = new URLSearchParams(String(calledInit()!.body));
    expect(JSON.parse(body.get('json_data')!).gear_id).toBe('');
  });
});

describe('deleteGear', () => {
  it('sends gear_id as a query param with an empty body', async () => {
    fetchMock.mockResolvedValue(okJson([{ gear_id: 382020, gear_deleted: 0 }]));

    const result = await deleteGear('tok123', 382015);

    expect(result).toEqual([{ gear_id: 382020, gear_deleted: 0 }]);
    const url = calledUrl();
    expect(url.searchParams.get('what')).toBe('delete_gear');
    expect(url.searchParams.get('token')).toBe('tok123');
    expect(url.searchParams.get('gear_id')).toBe('382015');
    expect(calledInit()!.body).toBeUndefined();
  });
});

describe('getGearsets', () => {
  it('calls the expected endpoint and returns JSON', async () => {
    fetchMock.mockResolvedValue(okJson([{ gearset_id: 30431, gearset_name: 'Cold water kit' }]));

    const result = await getGearsets('tok123');

    expect(result).toEqual([{ gearset_id: 30431, gearset_name: 'Cold water kit' }]);
    const url = calledUrl();
    expect(url.searchParams.get('what')).toBe('get_gearsets');
    expect(url.searchParams.get('token')).toBe('tok123');
  });
});

describe('saveGearset', () => {
  it('POSTs json_data and returns JSON', async () => {
    fetchMock.mockResolvedValue(okJson({ gearset_id: 30431, gearset_name: 'Cold water kit' }));
    const payload = { gearset_id: 30431, gearset_name: 'Cold water kit', gear: [382015] };

    const result = await saveGearset('tok123', payload);

    expect(result).toEqual({ gearset_id: 30431, gearset_name: 'Cold water kit' });
    const url = calledUrl();
    expect(url.searchParams.get('what')).toBe('save_gearset');
    expect(url.searchParams.get('token')).toBe('tok123');
    const body = new URLSearchParams(String(calledInit()!.body));
    expect(JSON.parse(body.get('json_data')!)).toEqual(payload);
  });

  it('create signal is an empty-string gearset_id', async () => {
    fetchMock.mockResolvedValue(okJson({ gearset_id: 30500 }));
    const payload = { gearset_id: '', gearset_name: 'New Set', gear: [] };

    await saveGearset('tok123', payload);

    const body = new URLSearchParams(String(calledInit()!.body));
    expect(JSON.parse(body.get('json_data')!).gearset_id).toBe('');
  });
});

describe('saveDive', () => {
  it('POSTs ?what=save_divelog with token + json_data in the form body', async () => {
    fetchMock.mockResolvedValue(okJson({ success: { odin_user_log_id: 26647462 } }));
    const payload = { odin_user_log_id: 26647462, odin_user_log_comment: 'Great viz' };

    const result = await saveDive('tok123', payload);

    expect(result).toEqual({ success: { odin_user_log_id: 26647462 } });
    const url = calledUrl();
    expect(url.searchParams.get('what')).toBe('save_divelog');
    expect(url.searchParams.get('token')).toBe('tok123');
    const init = calledInit()!;
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('token')).toBe('tok123');
    expect(JSON.parse(body.get('json_data')!)).toEqual(payload);
  });
});

describe('findDive', () => {
  it('returns the matching dive record', () => {
    expect(findDive(divelog(), 1002).odin_user_log_nr).toBe(2);
  });

  it('throws when no dive matches', () => {
    expect(() => findDive(divelog(), 999999)).toThrow('odin_user_log_id=999999');
  });
});
