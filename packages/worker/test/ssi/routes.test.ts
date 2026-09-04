import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';

vi.mock('../../src/ssi/client', async () => {
  const actual = await vi.importActual<typeof import('../../src/ssi/client')>('../../src/ssi/client');
  return { ...actual, ssiAuthenticate: vi.fn(), ssiGetDivelog: vi.fn(), ssiGetDiveSites: vi.fn(), ssiSaveDivelog: vi.fn() };
});

vi.mock('../../src/ssi/tokenCache', async () => {
  const actual = await vi.importActual<typeof import('../../src/ssi/tokenCache')>('../../src/ssi/tokenCache');
  // Keep the real KV behavior; wrap only to record calls so bearer-mode tests can assert the
  // guest path never reads the token cache.
  return { ...actual, getCachedToken: vi.fn(actual.getCachedToken) };
});

// Workaround for a @cloudflare/vitest-pool-workers bug (cloudflare/workers-sdk#10201): when a
// setup file imports from `cloudflare:test` (test/apply-migrations.ts does, for D1 migrations),
// vi.mock() factories are silently ignored for modules statically imported at the top of a test
// file. Forcing a module reset and importing the worker (and the mocked client) dynamically,
// after the mock is registered, makes the mock actually take effect.
vi.resetModules();
const { ssiAuthenticate, ssiGetDivelog, ssiGetDiveSites, ssiSaveDivelog, SSIAuthenticationError } = await import(
  '../../src/ssi/client'
);
const { getCachedToken } = await import('../../src/ssi/tokenCache');
const worker = (await import('../../src/index')).default;

function cookieFrom(response: Response): string {
  return (response.headers.get('Set-Cookie') ?? '').split(';')[0];
}

async function callWorker(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function signupAndGetCookie(email: string): Promise<string> {
  const res = await callWorker(
    new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
      body: JSON.stringify({ email, password: 'correct horse battery' }),
    })
  );
  return cookieFrom(res);
}

beforeEach(() => {
  vi.mocked(ssiAuthenticate).mockReset();
  vi.mocked(ssiGetDivelog).mockReset();
  vi.mocked(ssiGetDiveSites).mockReset();
  vi.mocked(ssiSaveDivelog).mockReset();
  vi.mocked(getCachedToken).mockClear(); // keep the real impl, just drop prior-test call records
});

/**
 * Spies on `env.DB.prepare` for the duration of `run`, then asserts no `ssi_links` query was
 * prepared and the KV token cache was never read -- i.e. the guest/bearer path short-circuited
 * before any D1 or KV work. Returns whatever `run` returned.
 */
async function expectNoLinkLookupOrCacheRead<T>(run: () => Promise<T>): Promise<T> {
  const prepareSpy = vi.spyOn(env.DB, 'prepare');
  let result: T;
  let prepared: string[];
  let cacheWasRead: boolean;
  // Snapshot what we need and restore the spy *before* asserting: an assertion thrown from
  // inside `finally` would leave the `env.DB.prepare` spy installed and leak it into every
  // later test in this file.
  try {
    result = await run();
  } finally {
    prepared = prepareSpy.mock.calls.map(([sql]) => String(sql));
    cacheWasRead = vi.mocked(getCachedToken).mock.calls.length > 0;
    prepareSpy.mockRestore();
  }
  expect(prepared.some((sql) => sql.includes('ssi_links'))).toBe(false);
  expect(cacheWasRead).toBe(false);
  return result;
}

describe('POST /api/ssi/link', () => {
  it('stores the link on valid SSI credentials', async () => {
    const cookie = await signupAndGetCookie('link-ok@example.com');
    vi.mocked(ssiAuthenticate).mockResolvedValue('ssi-token');

    const res = await callWorker(
      new Request('http://localhost/api/ssi/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example', ssiPassword: 'ssi-pass' }),
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ssiEmail: 'diver@ssi.example' });

    const meRes = await callWorker(new Request('http://localhost/api/auth/me', { headers: { Cookie: cookie } }));
    expect(await meRes.json()).toMatchObject({ ssiLinked: true, ssiEmail: 'diver@ssi.example' });
  });

  it('does not store anything on invalid SSI credentials', async () => {
    const cookie = await signupAndGetCookie('link-bad@example.com');
    vi.mocked(ssiAuthenticate).mockRejectedValue(new SSIAuthenticationError('Invalid password'));

    const res = await callWorker(
      new Request('http://localhost/api/ssi/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example', ssiPassword: 'wrong' }),
      })
    );

    expect(res.status).toBe(401);
    const meRes = await callWorker(new Request('http://localhost/api/auth/me', { headers: { Cookie: cookie } }));
    expect(await meRes.json()).toMatchObject({ ssiLinked: false });
  });

  it('requires an app session', async () => {
    const res = await callWorker(
      new Request('http://localhost/api/ssi/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example', ssiPassword: 'ssi-pass' }),
      })
    );
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/ssi/link', () => {
  it('removes an existing link', async () => {
    const cookie = await signupAndGetCookie('unlink@example.com');
    vi.mocked(ssiAuthenticate).mockResolvedValue('ssi-token');
    await callWorker(
      new Request('http://localhost/api/ssi/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example', ssiPassword: 'ssi-pass' }),
      })
    );

    const res = await callWorker(
      new Request('http://localhost/api/ssi/link', { method: 'DELETE', headers: { Cookie: cookie, Origin: 'http://localhost' } })
    );
    expect(res.status).toBe(200);

    const meRes = await callWorker(new Request('http://localhost/api/auth/me', { headers: { Cookie: cookie } }));
    expect(await meRes.json()).toMatchObject({ ssiLinked: false });
  });
});

describe('GET /api/ssi/divelog', () => {
  it('returns 409 when SSI is not linked', async () => {
    const cookie = await signupAndGetCookie('nolink@example.com');
    const res = await callWorker(new Request('http://localhost/api/ssi/divelog', { headers: { Cookie: cookie } }));
    expect(res.status).toBe(409);
  });

  it('authenticates with SSI, caches the token, and returns the divelog', async () => {
    const cookie = await signupAndGetCookie('divelog@example.com');
    vi.mocked(ssiAuthenticate).mockResolvedValue('ssi-token-1');
    await callWorker(
      new Request('http://localhost/api/ssi/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example', ssiPassword: 'ssi-pass' }),
      })
    );
    vi.mocked(ssiGetDivelog).mockResolvedValue([{ odin_user_log_nr: 1 }]);

    const res = await callWorker(new Request('http://localhost/api/ssi/divelog', { headers: { Cookie: cookie } }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ odin_user_log_nr: 1 }]);
    expect(ssiGetDivelog).toHaveBeenCalledWith('ssi-token-1');
  });

  it('reuses a cached token on a second call without re-authenticating', async () => {
    const cookie = await signupAndGetCookie('cached@example.com');
    vi.mocked(ssiAuthenticate).mockResolvedValue('ssi-token-2');
    await callWorker(
      new Request('http://localhost/api/ssi/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example', ssiPassword: 'ssi-pass' }),
      })
    );
    vi.mocked(ssiGetDivelog).mockResolvedValue([]);
    vi.mocked(ssiAuthenticate).mockClear(); // clear the call from /link above

    await callWorker(new Request('http://localhost/api/ssi/divelog', { headers: { Cookie: cookie } }));
    await callWorker(new Request('http://localhost/api/ssi/divelog', { headers: { Cookie: cookie } }));

    expect(ssiAuthenticate).not.toHaveBeenCalled(); // token from /link's own call is cached and reused
  });
});

describe('POST /api/ssi/divelog (save)', () => {
  it('proxies the payload to SSI and returns the response', async () => {
    const cookie = await signupAndGetCookie('save@example.com');
    vi.mocked(ssiAuthenticate).mockResolvedValue('ssi-token-3');
    await callWorker(
      new Request('http://localhost/api/ssi/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example', ssiPassword: 'ssi-pass' }),
      })
    );
    vi.mocked(ssiSaveDivelog).mockResolvedValue({ success: { odin_user_log_id: 42 } });

    const res = await callWorker(
      new Request('http://localhost/api/ssi/divelog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost' },
        body: JSON.stringify({ odin_user_log_nr: 9 }),
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: { odin_user_log_id: 42 } });
    expect(ssiSaveDivelog).toHaveBeenCalledWith('ssi-token-3', { odin_user_log_nr: 9 });
  });
});

describe('GET /api/ssi/sites', () => {
  it('returns the site list', async () => {
    const cookie = await signupAndGetCookie('sites@example.com');
    vi.mocked(ssiAuthenticate).mockResolvedValue('ssi-token-4');
    await callWorker(
      new Request('http://localhost/api/ssi/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example', ssiPassword: 'ssi-pass' }),
      })
    );
    vi.mocked(ssiGetDiveSites).mockResolvedValue([{ odin_dive_sites_id: 1 }]);

    const res = await callWorker(new Request('http://localhost/api/ssi/sites', { headers: { Cookie: cookie } }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ odin_dive_sites_id: 1 }]);
  });
});

describe('POST /api/ssi/guest-token', () => {
  it('returns a token on valid SSI credentials and writes nothing', async () => {
    vi.mocked(ssiAuthenticate).mockResolvedValue('guest-ssi-token');

    const res = await callWorker(
      new Request('http://localhost/api/ssi/guest-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example', ssiPassword: 'ssi-pass' }),
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ssiToken: 'guest-ssi-token' });
    expect(ssiAuthenticate).toHaveBeenCalledWith('diver@ssi.example', 'ssi-pass');
  });

  it('returns 400 when a field is missing', async () => {
    const res = await callWorker(
      new Request('http://localhost/api/ssi/guest-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example' }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('returns 401 with the SSI message on bad SSI credentials', async () => {
    vi.mocked(ssiAuthenticate).mockRejectedValue(new SSIAuthenticationError('Invalid password'));
    const res = await callWorker(
      new Request('http://localhost/api/ssi/guest-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example', ssiPassword: 'wrong' }),
      })
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid password' });
  });

  it('returns 502 when SSI is unreachable', async () => {
    vi.mocked(ssiAuthenticate).mockRejectedValue(new Error('network down'));
    const res = await callWorker(
      new Request('http://localhost/api/ssi/guest-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example', ssiPassword: 'ssi-pass' }),
      })
    );
    expect(res.status).toBe(502);
  });

  it('returns 403 without a matching Origin', async () => {
    const res = await callWorker(
      new Request('http://localhost/api/ssi/guest-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example', ssiPassword: 'ssi-pass' }),
      })
    );
    expect(res.status).toBe(403);
  });
});

describe('SSI proxy routes — guest (bearer) mode', () => {
  it('GET /api/ssi/divelog uses the bearer token directly and reads no D1/KV', async () => {
    vi.mocked(ssiGetDivelog).mockResolvedValue([{ odin_user_log_nr: 7 }]);

    const res = await expectNoLinkLookupOrCacheRead(() =>
      callWorker(
        new Request('http://localhost/api/ssi/divelog', {
          headers: { Authorization: 'Bearer raw-guest-token' },
        })
      )
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ odin_user_log_nr: 7 }]);
    expect(ssiGetDivelog).toHaveBeenCalledWith('raw-guest-token');
    expect(ssiAuthenticate).not.toHaveBeenCalled();
  });

  it('POST /api/ssi/divelog proxies with the bearer token', async () => {
    vi.mocked(ssiSaveDivelog).mockResolvedValue({ success: { odin_user_log_id: 5 } });

    const res = await expectNoLinkLookupOrCacheRead(() =>
      callWorker(
        new Request('http://localhost/api/ssi/divelog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Authorization: 'Bearer raw-guest-token' },
          body: JSON.stringify({ odin_user_log_nr: 3 }),
        })
      )
    );

    expect(res.status).toBe(200);
    expect(ssiSaveDivelog).toHaveBeenCalledWith('raw-guest-token', { odin_user_log_nr: 3 });
  });

  it('GET /api/ssi/sites works with a bearer token', async () => {
    vi.mocked(ssiGetDiveSites).mockResolvedValue([{ odin_dive_sites_id: 2 }]);
    const res = await expectNoLinkLookupOrCacheRead(() =>
      callWorker(
        new Request('http://localhost/api/ssi/sites', { headers: { Authorization: 'Bearer raw-guest-token' } })
      )
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ odin_dive_sites_id: 2 }]);
  });

  it('returns 401 with neither a session nor a bearer token', async () => {
    const res = await callWorker(new Request('http://localhost/api/ssi/divelog'));
    expect(res.status).toBe(401);
  });

  it('session wins when both a cookie and a bearer token are present', async () => {
    const cookie = await signupAndGetCookie('both-modes@example.com');
    vi.mocked(ssiAuthenticate).mockResolvedValue('account-token');
    await callWorker(
      new Request('http://localhost/api/ssi/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example', ssiPassword: 'ssi-pass' }),
      })
    );
    vi.mocked(ssiGetDivelog).mockResolvedValue([]);

    await callWorker(
      new Request('http://localhost/api/ssi/divelog', {
        headers: { Cookie: cookie, Authorization: 'Bearer raw-guest-token' },
      })
    );

    expect(ssiGetDivelog).toHaveBeenLastCalledWith('account-token'); // NOT 'raw-guest-token'
  });

  it('POST /api/ssi/link still rejects a bearer token (account-only)', async () => {
    const res = await callWorker(
      new Request('http://localhost/api/ssi/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Authorization: 'Bearer raw-guest-token' },
        body: JSON.stringify({ ssiEmail: 'diver@ssi.example', ssiPassword: 'ssi-pass' }),
      })
    );
    expect(res.status).toBe(401);
  });
});
