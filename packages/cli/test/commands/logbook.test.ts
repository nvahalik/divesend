// TS port of the command layer of tests/test_divelog_api_client.py -- the
// cmd_list / cmd_get / cmd_push / cmd_create / cmd_update behavior. `fetch` is
// stubbed and routed by the `what=` query param: `authenticate` -> a token,
// `get_divelog` -> the fixture, `save_divelog` -> a canned record (captured so
// the outbound payload can be asserted). No real network calls.

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WRITE_SCHEMA_KEYS } from '@divesend/core';
import { list, get, push, create, update } from '../../src/commands/logbook.js';
import { CliError } from '../../src/io.js';
import { saveAuth } from '../../src/auth.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/ssi_get_divelog.json', import.meta.url));
const fixtureDivelog = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));

let fetchMock: ReturnType<typeof vi.fn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let lastSave: { url: URL; body: URLSearchParams } | undefined;
let tmp: string;
let prevXdg: string | undefined;

function okJson(payload: unknown) {
  return { ok: true, json: () => Promise.resolve(payload), text: () => Promise.resolve('') };
}

function router(input: unknown, init?: RequestInit) {
  const url = new URL(String(input));
  const what = url.searchParams.get('what');
  if (what === 'authenticate') return Promise.resolve(okJson({ authenticated: true, token: 'test-token' }));
  if (what === 'get_divelog') return Promise.resolve(okJson(fixtureDivelog()));
  if (what === 'save_divelog') {
    lastSave = { url, body: new URLSearchParams(String(init?.body)) };
    return Promise.resolve(okJson({ success: { odin_user_log_id: 99999 } }));
  }
  return Promise.reject(new Error(`unexpected what=${what}`));
}

const stdoutText = () => stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
const sentPayload = () => JSON.parse(lastSave!.body.get('json_data')!) as Record<string, unknown>;

beforeEach(() => {
  lastSave = undefined;
  tmp = mkdtempSync(join(tmpdir(), 'logbook-'));
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmp;
  process.env.SSI_EMAIL = 'tester@example.com';
  process.env.SSI_PASSWORD = 'pw';
  fetchMock = vi.fn(router);
  vi.stubGlobal('fetch', fetchMock);
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  rmSync(tmp, { recursive: true, force: true });
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
});

describe('list', () => {
  it('prints a header + separator + one row per dive, sorted by nr', async () => {
    await list();
    const lines = stdoutText().trimEnd().split('\n');

    expect(lines[0]).toBe(
      ' nr  odin_user_log_id  date              depth_m   min  confirmed  computer            ',
    );
    expect(lines[1]).toBe('-'.repeat(lines[0].length));
    expect(lines).toHaveLength(5); // header + rule + 3 dives
    expect(lines[2]).toBe(
      '  1              1001  2026-06-01 15:28      9.6    38  None       Shearwater Teric',
    );
    expect(lines[2].startsWith('  1  ')).toBe(true);
    expect(lines[3].startsWith('  2  ')).toBe(true);
    expect(lines[4].startsWith('  3  ')).toBe(true);
  });

  it('--json prints the raw dive array, sorted', async () => {
    await list({ json: true });
    const dives = JSON.parse(stdoutText());
    expect(dives).toHaveLength(3);
    expect(dives.map((d: { odin_user_log_nr: number }) => d.odin_user_log_nr)).toEqual([1, 2, 3]);
  });
});

describe('get', () => {
  it('--field K prints just that value', async () => {
    await get('1001', { field: 'odin_user_log_comment' });
    expect(stdoutText().trim()).toBe('Clear and calm');
  });

  it('without --field prints the full dive JSON', async () => {
    await get('1001');
    const dive = JSON.parse(stdoutText());
    expect(dive.odin_user_log_id).toBe(1001);
    expect(dive.odin_user_log_nr).toBe(1);
  });

  it('unknown dive id fails cleanly', async () => {
    await expect(get('424242')).rejects.toThrow();
  });

  it('missing dive id fails with a clear message', async () => {
    await expect(get(undefined)).rejects.toThrow('needs a numeric dive <id>');
  });
});

describe('create', () => {
  it('builds a full 342-key create payload with overrides applied and a null id', async () => {
    await create({ set: ['odin_user_log_comment=Hello world', 'odin_user_log_rating=5'] });

    const sent = sentPayload();
    expect(Object.keys(sent)).toHaveLength(342);
    expect(Object.keys(sent).sort()).toEqual([...WRITE_SCHEMA_KEYS].sort());
    expect(sent.odin_user_log_id).toBeNull();
    expect(sent.odin_user_log_comment).toBe('Hello world');
    expect(sent.odin_user_log_rating).toBe(5); // JSON-coerced, not the string "5"
    expect(sent.odin_user_log_nr).toBe(4); // max existing nr (3) + 1
    expect(sent.internalPk).toBe(4);
    // most-recent dive (nr 3) carries no user_master_id -> null, not borrowed subjectively
    expect(sent.odin_user_log_user_master_id).toBeNull();
    // nothing dive-specific borrowed from another dive
    expect(sent.odin_user_log_dive_sites_id).toBeNull();
    expect(sent.odin_user_log_depth_m).toBeNull();
  });

  it('--account-dive-id borrows only the account owner id from that dive', async () => {
    await create({ accountDiveId: '1001', set: ['odin_user_log_comment=Hi'] });
    const sent = sentPayload();
    expect(sent.odin_user_log_user_master_id).toBe(5012047);
    expect(sent.odin_user_log_dive_sites_id).toBeNull(); // still not borrowed
  });

  it('--from-file is merged, then --set wins on top', async () => {
    const f = join(tmp, 'over.json');
    writeFileSync(f, JSON.stringify({ odin_user_log_comment: 'from file', odin_user_log_vis_m: 12 }));
    await create({ fromFile: f, set: ['odin_user_log_comment=from set'] });
    const sent = sentPayload();
    expect(sent.odin_user_log_comment).toBe('from set');
    expect(sent.odin_user_log_vis_m).toBe(12);
  });

  it('fails when there is nothing to create from', async () => {
    await expect(create()).rejects.toThrow('Nothing to create');
  });
});

describe('update', () => {
  it('merges overrides onto the fetched record without clobbering unset fields', async () => {
    await update('1001', { set: ['odin_user_log_comment=Saw a manta'] });

    const sent = sentPayload();
    expect(Object.keys(sent)).toHaveLength(342);
    expect(sent.odin_user_log_comment).toBe('Saw a manta'); // override
    expect(sent.odin_user_log_id).toBe(1001); // preserved (NOT nulled -- this is an update)
    expect(sent.odin_user_log_rating).toBe(5); // preserved from the read record
    expect(sent.odin_user_log_depth_m).toBe(9.6); // preserved
    expect(sent.odin_user_log_datetime).toBe('2026-06-01 15:28'); // preserved
    expect(sent.odin_user_log_weight_kg).toBe(0.9); // preserved
    expect(sent.internalPk).toBe(1); // from the record's odin_user_log_nr (no read-side internalPk)
  });

  it('coerces numeric --set values via JSON', async () => {
    await update('1001', { set: ['odin_user_log_rating=3'] });
    expect(sentPayload().odin_user_log_rating).toBe(3);
  });

  it('fails when nothing is set', async () => {
    await expect(update('1001')).rejects.toThrow('Nothing to update');
  });
});

describe('push', () => {
  it('sends the edited record through the 342-key write schema', async () => {
    const f = join(tmp, 'dive.json');
    writeFileSync(
      f,
      JSON.stringify({ odin_user_log_id: 1002, odin_user_log_comment: 'edited', bogus_key: 1 }),
    );
    await push(f);

    const sent = sentPayload();
    expect(Object.keys(sent)).toHaveLength(342);
    expect(sent.odin_user_log_id).toBe(1002);
    expect(sent.odin_user_log_comment).toBe('edited');
    expect('bogus_key' in sent).toBe(false); // keys outside the schema are dropped
  });

  it('fails when the file has no odin_user_log_id', async () => {
    const f = join(tmp, 'noid.json');
    writeFileSync(f, JSON.stringify({ odin_user_log_comment: 'orphan' }));
    await expect(push(f)).rejects.toThrow('no odin_user_log_id');
  });
});

describe('credentials', () => {
  it('fails without creds and makes no network call', async () => {
    delete process.env.SSI_EMAIL;
    delete process.env.SSI_PASSWORD;

    await expect(list()).rejects.toBeInstanceOf(CliError);
    await expect(list()).rejects.toThrow('Not logged in');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to a stored auth.json when no flags or env creds', async () => {
    delete process.env.SSI_EMAIL;
    delete process.env.SSI_PASSWORD;
    saveAuth({ email: 'stored@example.com', password: 'storedpw' });

    await list();

    const authCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('what=authenticate'),
    )!;
    const url = new URL(String(authCall[0]));
    expect(url.searchParams.get('l')).toBe('stored@example.com');
    expect(url.searchParams.get('p')).toBe('storedpw');
  });

  it('accepts --email/--password flags', async () => {
    delete process.env.SSI_EMAIL;
    delete process.env.SSI_PASSWORD;
    await list({ email: 'flag@example.com', password: 'flagpw' });
    const authCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('what=authenticate'),
    )!;
    const url = new URL(String(authCall[0]));
    expect(url.searchParams.get('l')).toBe('flag@example.com');
    expect(url.searchParams.get('p')).toBe('flagpw');
  });
});
