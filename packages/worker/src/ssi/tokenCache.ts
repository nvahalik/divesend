// Short-lived per-user cache of a derived SSI auth token, so a burst of SSI API calls (e.g.
// syncing a batch of dives) doesn't re-authenticate with SSI on every single call. TTL is
// deliberately short -- SSI's real token expiry isn't documented, so this errs toward
// re-deriving often rather than trusting a token to still be valid.

const TOKEN_CACHE_TTL_SECONDS = 5 * 60;

export async function getCachedToken(kv: KVNamespace, userId: string): Promise<string | null> {
  return kv.get(cacheKey(userId));
}

export async function setCachedToken(kv: KVNamespace, userId: string, token: string): Promise<void> {
  await kv.put(cacheKey(userId), token, { expirationTtl: TOKEN_CACHE_TTL_SECONDS });
}

export async function clearCachedToken(kv: KVNamespace, userId: string): Promise<void> {
  await kv.delete(cacheKey(userId));
}

function cacheKey(userId: string): string {
  return `ssi-token:${userId}`;
}
