import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthHttpError, login, logout, me, signup } from './authClient';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signup', () => {
  it('POSTs to /api/auth/signup with credentials included', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ email: 'a@b.com' }, true, 201));
    vi.stubGlobal('fetch', fetchMock);
    await signup('a@b.com', 'password123');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/signup');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.com', password: 'password123' });
  });

  it('throws AuthHttpError with the server message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Already exists.' }, false, 409)));
    await expect(signup('a@b.com', 'password123')).rejects.toThrow('Already exists.');
  });
});

describe('login', () => {
  it('POSTs to /api/auth/login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ email: 'a@b.com' }));
    vi.stubGlobal('fetch', fetchMock);
    await login('a@b.com', 'password123');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/login');
  });

  it('throws AuthHttpError on invalid credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Invalid email or password.' }, false, 401)));
    await expect(login('a@b.com', 'wrong')).rejects.toThrow(AuthHttpError);
  });
});

describe('logout', () => {
  it('POSTs to /api/auth/logout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await logout();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/logout');
  });

  it('throws AuthHttpError on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Something went wrong.' }, false, 500)));
    await expect(logout()).rejects.toThrow(AuthHttpError);
  });
});

describe('me', () => {
  it('returns the user when logged in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ email: 'a@b.com', ssiLinked: true, ssiEmail: 'diver@ssi.example' })));
    expect(await me()).toEqual({ email: 'a@b.com', ssiLinked: true, ssiEmail: 'diver@ssi.example' });
  });

  it('returns null on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Not logged in.' }, false, 401)));
    expect(await me()).toBeNull();
  });
});
