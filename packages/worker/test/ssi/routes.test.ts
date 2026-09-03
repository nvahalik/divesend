import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';

vi.mock('../../src/ssi/client', async () => {
  const actual = await vi.importActual<typeof import('../../src/ssi/client')>('../../src/ssi/client');
  return { ...actual, ssiAuthenticate: vi.fn(), ssiGetDivelog: vi.fn(), ssiGetDiveSites: vi.fn(), ssiSaveDivelog: vi.fn() };
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
});

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
