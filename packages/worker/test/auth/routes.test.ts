// worker/test/auth/routes.test.ts
import { describe, expect, it } from 'vitest';
import worker from '../../src/index';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('Set-Cookie') ?? '';
  return setCookie.split(';')[0]; // "session=<value>"
}

async function callWorker(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('POST /api/auth/signup', () => {
  it('creates a user and sets a session cookie', async () => {
    const res = await callWorker(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ email: 'new@example.com', password: 'correct horse battery' }),
      })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ email: 'new@example.com' });
    expect(cookieFrom(res)).toMatch(/^session=.+/);
  });

  it('rejects a duplicate email', async () => {
    const signup = () =>
      callWorker(
        new Request('http://localhost/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
          body: JSON.stringify({ email: 'dup@example.com', password: 'correct horse battery' }),
        })
      );
    await signup();
    const second = await signup();
    expect(second.status).toBe(409);
  });

  it('rejects a too-short password', async () => {
    const res = await callWorker(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ email: 'short@example.com', password: 'abc' }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('rejects a malformed Origin header with 403, not 500', async () => {
    const res = await callWorker(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'not-a-valid-url' },
        body: JSON.stringify({ email: 'malformed-origin@example.com', password: 'correct horse battery' }),
      })
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/login', () => {
  async function signup(email: string, password: string) {
    await callWorker(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ email, password }),
      })
    );
  }

  it('logs in with correct credentials', async () => {
    await signup('login-ok@example.com', 'correct horse battery');
    const res = await callWorker(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ email: 'login-ok@example.com', password: 'correct horse battery' }),
      })
    );
    expect(res.status).toBe(200);
    expect(cookieFrom(res)).toMatch(/^session=.+/);
  });

  it('gives the same generic error for a wrong password as for an unknown email', async () => {
    await signup('login-wrongpw@example.com', 'correct horse battery');
    const wrongPassword = await callWorker(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ email: 'login-wrongpw@example.com', password: 'nope nope nope' }),
      })
    );
    const unknownEmail = await callWorker(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'nope nope nope' }),
      })
    );
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
  });
});

describe('POST /api/auth/logout + GET /api/auth/me', () => {
  it('me returns 401 when logged out', async () => {
    const res = await callWorker(new Request('http://localhost/api/auth/me'));
    expect(res.status).toBe(401);
  });

  it('me returns the user after login, and logout clears the session', async () => {
    await callWorker(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ email: 'me-flow@example.com', password: 'correct horse battery' }),
      })
    );
    const loginRes = await callWorker(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ email: 'me-flow@example.com', password: 'correct horse battery' }),
      })
    );
    const cookie = cookieFrom(loginRes);

    const meRes = await callWorker(new Request('http://localhost/api/auth/me', { headers: { Cookie: cookie } }));
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toEqual({ email: 'me-flow@example.com', ssiLinked: false, ssiEmail: null });

    await callWorker(
      new Request('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'http://localhost' },
      })
    );
    const meAfterLogout = await callWorker(new Request('http://localhost/api/auth/me', { headers: { Cookie: cookie } }));
    expect(meAfterLogout.status).toBe(401);
  });
});
