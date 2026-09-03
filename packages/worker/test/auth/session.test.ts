import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
  clearedSessionCookie,
  createSession,
  destroySession,
  getUserIdForSession,
  readSessionCookie,
  sessionCookie,
} from '../../src/auth/session';

async function makeUser(id: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, `${id}@example.com`, 'hash', 'salt', Date.now())
    .run();
}

describe('createSession / getUserIdForSession / destroySession', () => {
  it('creates a session that resolves back to the user', async () => {
    await makeUser('user-1');
    const sessionId = await createSession(env.DB, 'user-1');
    expect(await getUserIdForSession(env.DB, sessionId)).toBe('user-1');
  });

  it('returns null for an unknown session id', async () => {
    expect(await getUserIdForSession(env.DB, 'nonexistent')).toBeNull();
  });

  it('destroySession makes the session unresolvable', async () => {
    await makeUser('user-2');
    const sessionId = await createSession(env.DB, 'user-2');
    await destroySession(env.DB, sessionId);
    expect(await getUserIdForSession(env.DB, sessionId)).toBeNull();
  });

  it('an expired session resolves to null and is cleaned up', async () => {
    await makeUser('user-3');
    const sessionId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(sessionId, 'user-3', Date.now() - 1000)
      .run();
    expect(await getUserIdForSession(env.DB, sessionId)).toBeNull();
    const row = await env.DB.prepare('SELECT id FROM sessions WHERE id = ?').bind(sessionId).first();
    expect(row).toBeNull();
  });
});

describe('cookie helpers', () => {
  it('sessionCookie/readSessionCookie round trip', () => {
    const cookie = sessionCookie('abc-123');
    expect(cookie).toContain('session=abc-123');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(readSessionCookie('other=1; session=abc-123; more=2')).toBe('abc-123');
  });

  it('readSessionCookie returns null when absent', () => {
    expect(readSessionCookie('other=1')).toBeNull();
    expect(readSessionCookie(null)).toBeNull();
  });

  it('clearedSessionCookie has Max-Age=0', () => {
    expect(clearedSessionCookie()).toContain('Max-Age=0');
  });
});
