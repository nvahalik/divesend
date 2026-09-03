// Opaque, server-side (D1-backed) sessions -- deliberately not a JWT, since revocation
// (logout) just means deleting a row rather than needing a blocklist or short-lived
// refresh-token dance.

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME = 'session';

export async function createSession(db: D1Database, userId: string): Promise<string> {
  const id = crypto.randomUUID() + crypto.randomUUID(); // 256+ bits of entropy
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(id, userId, expiresAt).run();
  return id;
}

export async function getUserIdForSession(db: D1Database, sessionId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ user_id: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    return null;
  }
  return row.user_id;
}

export async function destroySession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

export function sessionCookie(sessionId: string): string {
  const maxAgeSeconds = Math.floor(SESSION_DURATION_MS / 1000);
  return `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearedSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return match ? match.slice(COOKIE_NAME.length + 1) : null;
}
