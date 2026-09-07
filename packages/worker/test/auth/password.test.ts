import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, PBKDF2_ITERATIONS } from '../../src/auth/password';

describe('hashPassword / verifyPassword', () => {
  it('keeps PBKDF2 iterations within the Cloudflare Workers runtime cap', () => {
    // Production workerd (BoringSSL) throws NotSupportedError for PBKDF2
    // iteration counts above 100000; anything higher 500s every /signup and
    // /login. The local vitest-pool-workers runtime does NOT enforce this, so
    // this constant check is the only guard against regressing it.
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(100_000);
  });

  it('produces a different salt each time', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('verifies the correct password', async () => {
    const { hash, salt } = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash, salt)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const { hash, salt } = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', hash, salt)).toBe(false);
  });

  it('rejects the correct password against a different salt', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', a.hash, b.salt)).toBe(false);
  });
});
