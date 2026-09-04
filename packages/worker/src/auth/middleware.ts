// worker/src/auth/middleware.ts
import type { Context, Next } from 'hono';
import { getUserIdForSession, readSessionCookie } from './session';

type Env = { DB: D1Database };
export type AuthedVariables = {
  userId: string;
  ssiMode?: 'account' | 'guest';
  bearerToken?: string;
};

export async function requireAuth(c: Context<{ Bindings: Env; Variables: AuthedVariables }>, next: Next) {
  const sessionId = readSessionCookie(c.req.header('Cookie') ?? null);
  const userId = sessionId ? await getUserIdForSession(c.env.DB, sessionId) : null;
  if (!userId) {
    return c.json({ error: 'Not logged in.' }, 401);
  }
  c.set('userId', userId);
  await next();
}

/**
 * Auth for the SSI proxy routes, which serve both signed-in accounts and guests.
 * A valid app session takes precedence; otherwise an `Authorization: Bearer <ssiToken>`
 * header authorizes the request as a guest (the token is an SSI credential and only
 * ever authorizes SSI calls for its own SSI account). Neither → 401.
 */
export async function sessionOrBearer(c: Context<{ Bindings: Env; Variables: AuthedVariables }>, next: Next) {
  const sessionId = readSessionCookie(c.req.header('Cookie') ?? null);
  const userId = sessionId ? await getUserIdForSession(c.env.DB, sessionId) : null;
  if (userId) {
    c.set('ssiMode', 'account');
    c.set('userId', userId);
    return next();
  }

  const auth = c.req.header('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (token) {
    c.set('ssiMode', 'guest');
    c.set('bearerToken', token);
    return next();
  }

  return c.json({ error: 'Not logged in.' }, 401);
}

/**
 * Lightweight CSRF defense for cookie-authenticated state-changing requests: the app is only
 * ever served from one origin, so a request whose `Origin` header doesn't match that origin
 * is rejected outright, before any session/DB work happens.
 */
export function requireMatchingOrigin(c: Context, next: Next) {
  const origin = c.req.header('Origin');
  if (!origin) {
    return c.json({ error: 'Invalid request origin.' }, 403);
  }
  try {
    const requestUrl = new URL(c.req.url);
    if (new URL(origin).host !== requestUrl.host) {
      return c.json({ error: 'Invalid request origin.' }, 403);
    }
  } catch {
    return c.json({ error: 'Invalid request origin.' }, 403);
  }
  return next();
}
