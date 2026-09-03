// worker/src/auth/middleware.ts
import type { Context, Next } from 'hono';
import { getUserIdForSession, readSessionCookie } from './session';

type Env = { DB: D1Database };
export type AuthedVariables = { userId: string };

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
