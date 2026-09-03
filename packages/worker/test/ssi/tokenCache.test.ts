import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { clearCachedToken, getCachedToken, setCachedToken } from '../../src/ssi/tokenCache';

describe('SSI token cache', () => {
  it('returns null for a user with nothing cached', async () => {
    expect(await getCachedToken(env.SSI_TOKEN_CACHE, 'user-none')).toBeNull();
  });

  it('set then get round trips', async () => {
    await setCachedToken(env.SSI_TOKEN_CACHE, 'user-a', 'the-token');
    expect(await getCachedToken(env.SSI_TOKEN_CACHE, 'user-a')).toBe('the-token');
  });

  it('clear removes the cached token', async () => {
    await setCachedToken(env.SSI_TOKEN_CACHE, 'user-b', 'the-token');
    await clearCachedToken(env.SSI_TOKEN_CACHE, 'user-b');
    expect(await getCachedToken(env.SSI_TOKEN_CACHE, 'user-b')).toBeNull();
  });

  it('different users have independent cache entries', async () => {
    await setCachedToken(env.SSI_TOKEN_CACHE, 'user-c', 'token-c');
    await setCachedToken(env.SSI_TOKEN_CACHE, 'user-d', 'token-d');
    expect(await getCachedToken(env.SSI_TOKEN_CACHE, 'user-c')).toBe('token-c');
    expect(await getCachedToken(env.SSI_TOKEN_CACHE, 'user-d')).toBe('token-d');
  });
});
