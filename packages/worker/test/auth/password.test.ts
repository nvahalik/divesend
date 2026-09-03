import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/password';

describe('hashPassword / verifyPassword', () => {
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
