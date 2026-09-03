// worker/src/ssi/routes.ts
import type { Context } from 'hono';
import { Hono } from 'hono';
import { requireAuth, requireMatchingOrigin, type AuthedVariables } from '../auth/middleware';
import { decryptSecret, encryptSecret } from './crypto';
import { clearCachedToken, getCachedToken, setCachedToken } from './tokenCache';
import {
  SSIAuthenticationError,
  SSIUpstreamError,
  ssiAuthenticate,
  ssiGetDiveSites,
  ssiGetDivelog,
  ssiSaveDivelog,
} from './client';

type Env = { DB: D1Database; SSI_TOKEN_CACHE: KVNamespace; SSI_ENCRYPTION_KEY: string };
type SsiContext = Context<{ Bindings: Env; Variables: AuthedVariables }>;

export const ssiRoutes = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const UPSTREAM_UNAVAILABLE = { error: 'Could not reach SSI right now. Try again shortly.' } as const;

ssiRoutes.post('/guest-token', requireMatchingOrigin, async (c) => {
  const body = await c.req.json<{ ssiEmail?: string; ssiPassword?: string }>();
  const ssiEmail = body.ssiEmail?.trim();
  const ssiPassword = body.ssiPassword;
  if (!ssiEmail || !ssiPassword) {
    return c.json({ error: 'SSI email and password are required.' }, 400);
  }

  try {
    const ssiToken = await ssiAuthenticate(ssiEmail, ssiPassword);
    return c.json({ ssiToken });
  } catch (err) {
    if (err instanceof SSIAuthenticationError) {
      return c.json({ error: err.message }, 401);
    }
    return c.json(UPSTREAM_UNAVAILABLE, 502);
  }
});

ssiRoutes.use('*', requireAuth);

ssiRoutes.post('/link', requireMatchingOrigin, async (c) => {
  const body = await c.req.json<{ ssiEmail?: string; ssiPassword?: string }>();
  const ssiEmail = body.ssiEmail?.trim();
  const ssiPassword = body.ssiPassword;
  if (!ssiEmail || !ssiPassword) {
    return c.json({ error: 'SSI email and password are required.' }, 400);
  }

  let token: string;
  try {
    token = await ssiAuthenticate(ssiEmail, ssiPassword);
  } catch (err) {
    if (err instanceof SSIAuthenticationError) {
      return c.json({ error: err.message }, 401);
    }
    return c.json(UPSTREAM_UNAVAILABLE, 502);
  }

  const { ciphertext, iv } = await encryptSecret(ssiPassword, c.env.SSI_ENCRYPTION_KEY);
  const userId = c.get('userId');
  await c.env.DB.prepare(
    `INSERT INTO ssi_links (user_id, ssi_email, encrypted_password, iv, linked_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET ssi_email = excluded.ssi_email, encrypted_password = excluded.encrypted_password, iv = excluded.iv, linked_at = excluded.linked_at`
  )
    .bind(userId, ssiEmail, ciphertext, iv, Date.now())
    .run();
  // The authenticate call above already produced a valid token -- cache it so an immediate
  // divelog/sites/save call right after linking doesn't have to re-authenticate with SSI.
  await setCachedToken(c.env.SSI_TOKEN_CACHE, userId, token);

  return c.json({ ssiEmail });
});

ssiRoutes.delete('/link', requireMatchingOrigin, async (c) => {
  const userId = c.get('userId');
  await c.env.DB.prepare('DELETE FROM ssi_links WHERE user_id = ?').bind(userId).run();
  await clearCachedToken(c.env.SSI_TOKEN_CACHE, userId);
  return c.json({ ok: true });
});

/** Resolves a usable SSI token for the current user (cached, or freshly derived), or a Response to return as-is on failure. */
async function requireSsiToken(c: SsiContext): Promise<string | Response> {
  const userId = c.get('userId');
  const cached = await getCachedToken(c.env.SSI_TOKEN_CACHE, userId);
  if (cached) return cached;

  const link = await c.env.DB.prepare('SELECT ssi_email, encrypted_password, iv FROM ssi_links WHERE user_id = ?')
    .bind(userId)
    .first<{ ssi_email: string; encrypted_password: string; iv: string }>();
  if (!link) {
    return c.json({ error: 'Link your SSI account first.' }, 409);
  }

  const ssiPassword = await decryptSecret(link.encrypted_password, link.iv, c.env.SSI_ENCRYPTION_KEY);
  try {
    const token = await ssiAuthenticate(link.ssi_email, ssiPassword);
    await setCachedToken(c.env.SSI_TOKEN_CACHE, userId, token);
    return token;
  } catch (err) {
    if (err instanceof SSIAuthenticationError) {
      return c.json({ error: 'Your linked SSI account needs re-linking.' }, 409);
    }
    return c.json(UPSTREAM_UNAVAILABLE, 502);
  }
}

/**
 * Calls `fn` with a usable SSI token, retrying once with a freshly-derived token (clearing
 * the cache first) if the call fails with an upstream error -- a cached token could be stale
 * even within its own TTL window if the user changed their SSI password elsewhere.
 */
async function callWithFreshTokenRetry<T>(c: SsiContext, fn: (token: string) => Promise<T>): Promise<T | Response> {
  const userId = c.get('userId');
  const first = await requireSsiToken(c);
  if (first instanceof Response) return first;

  try {
    return await fn(first);
  } catch (err) {
    if (!(err instanceof SSIUpstreamError)) throw err;
    await clearCachedToken(c.env.SSI_TOKEN_CACHE, userId);
    const second = await requireSsiToken(c);
    if (second instanceof Response) return second;
    return fn(second);
  }
}

ssiRoutes.get('/divelog', async (c) => {
  try {
    const result = await callWithFreshTokenRetry(c, ssiGetDivelog);
    return result instanceof Response ? result : c.json(result);
  } catch {
    return c.json(UPSTREAM_UNAVAILABLE, 502);
  }
});

ssiRoutes.get('/sites', async (c) => {
  try {
    const result = await callWithFreshTokenRetry(c, ssiGetDiveSites);
    return result instanceof Response ? result : c.json(result);
  } catch {
    return c.json(UPSTREAM_UNAVAILABLE, 502);
  }
});

ssiRoutes.post('/divelog', requireMatchingOrigin, async (c) => {
  const payload = await c.req.json<Record<string, unknown>>();
  try {
    const result = await callWithFreshTokenRetry(c, (token) => ssiSaveDivelog(token, payload));
    return result instanceof Response ? result : c.json(result);
  } catch {
    return c.json(UPSTREAM_UNAVAILABLE, 502);
  }
});
