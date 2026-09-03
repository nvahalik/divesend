// Envelope encryption for stored SSI passwords: AES-256-GCM keyed by a Worker secret
// (SSI_ENCRYPTION_KEY, set via `wrangler secret put`, never stored in D1). A D1 export alone
// -- without also having the Worker's secret -- doesn't expose any SSI password.

import { fromBase64, toBase64 } from '../shared/base64';

export async function encryptSecret(plaintext: string, base64Key: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV, the AES-GCM standard size
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertextBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return { ciphertext: toBase64(ciphertextBuffer), iv: toBase64(iv) };
}

export async function decryptSecret(ciphertext: string, iv: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    key,
    fromBase64(ciphertext)
  );
  return new TextDecoder().decode(plaintextBuffer);
}

const REQUIRED_KEY_BYTES = 32; // AES-256

async function importKey(base64Key: string): Promise<CryptoKey> {
  const rawKey = fromBase64(base64Key);
  if (rawKey.length !== REQUIRED_KEY_BYTES) {
    throw new Error(
      `SSI encryption key must be exactly ${REQUIRED_KEY_BYTES} bytes (256 bits) once base64-decoded, got ${rawKey.length}.`
    );
  }
  return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
