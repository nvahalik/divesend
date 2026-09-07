// PBKDF2-SHA256 password hashing via Web Crypto. A per-user random salt defeats rainbow
// tables, and the constant-time comparison in verifyPassword defeats timing attacks on the
// comparison step itself.
//
// Iteration count is pinned to 100_000: the Cloudflare Workers production runtime
// (BoringSSL) throws `NotSupportedError: iteration counts above 100000 are not supported`,
// which turns every /signup and /login into a 500. This is below OWASP's current
// PBKDF2-SHA256 guidance (~600k) but is the platform hard limit; a stronger KDF here
// (Argon2id / scrypt via WASM) is the follow-up if that ceiling isn't enough.

import { fromBase64, toBase64 } from '../shared/base64';

export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_LENGTH_BITS = 256;

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveBits(password, salt);
  return { hash: toBase64(derived), salt: toBase64(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = await deriveBits(password, fromBase64(salt));
  return timingSafeEqual(new Uint8Array(derived), fromBase64(hash));
}

async function deriveBits(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH_BITS
  );
}

/** Constant-time byte comparison -- avoids leaking hash-match progress via response timing. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
