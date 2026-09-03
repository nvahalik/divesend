// worker/src/auth/routes.ts
import { Hono } from 'hono';
import { requireMatchingOrigin, type AuthedVariables } from './middleware';
import { hashPassword, verifyPassword } from './password';
import { clearedSessionCookie, createSession, destroySession, readSessionCookie, sessionCookie, getUserIdForSession } from './session';

type Env = { DB: D1Database };
export const authRoutes = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const MIN_PASSWORD_LENGTH = 8;

authRoutes.post('/signup', requireMatchingOrigin, async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !email.includes('@')) {
    return c.json({ error: 'A valid email is required.' }, 400);
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    return c.json({ error: 'An account with that email already exists.' }, 409);
  }

  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, email, hash, salt, Date.now())
    .run();

  const sessionId = await createSession(c.env.DB, id);
  c.header('Set-Cookie', sessionCookie(sessionId));
  return c.json({ email }, 201);
});

authRoutes.post('/login', requireMatchingOrigin, async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const invalidCredentials = () => c.json({ error: 'Invalid email or password.' }, 401);

  if (!email || !password) return invalidCredentials();

  const user = await c.env.DB.prepare('SELECT id, password_hash, password_salt FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; password_hash: string; password_salt: string }>();
  if (!user) return invalidCredentials();

  const ok = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!ok) return invalidCredentials();

  const sessionId = await createSession(c.env.DB, user.id);
  c.header('Set-Cookie', sessionCookie(sessionId));
  return c.json({ email });
});

authRoutes.post('/logout', requireMatchingOrigin, async (c) => {
  const sessionId = readSessionCookie(c.req.header('Cookie') ?? null);
  if (sessionId) await destroySession(c.env.DB, sessionId);
  c.header('Set-Cookie', clearedSessionCookie());
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const sessionId = readSessionCookie(c.req.header('Cookie') ?? null);
  const userId = sessionId ? await getUserIdForSession(c.env.DB, sessionId) : null;
  if (!userId) return c.json({ error: 'Not logged in.' }, 401);

  const user = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
  if (!user) return c.json({ error: 'Not logged in.' }, 401);

  const ssiLink = await c.env.DB.prepare('SELECT ssi_email FROM ssi_links WHERE user_id = ?')
    .bind(userId)
    .first<{ ssi_email: string }>();

  return c.json({ email: user.email, ssiLinked: !!ssiLink, ssiEmail: ssiLink?.ssi_email ?? null });
});
