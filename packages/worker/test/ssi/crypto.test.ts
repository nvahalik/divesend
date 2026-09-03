import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../../src/ssi/crypto';

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a secret', async () => {
    const key = await makeTestKey();
    const { ciphertext, iv } = await encryptSecret('hunter2', key);
    expect(await decryptSecret(ciphertext, iv, key)).toBe('hunter2');
  });

  it('uses a different iv each time', async () => {
    const key = await makeTestKey();
    const a = await encryptSecret('hunter2', key);
    const b = await encryptSecret('hunter2', key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails to decrypt with the wrong key', async () => {
    const key = await makeTestKey();
    const otherKey = await makeTestKey();
    const { ciphertext, iv } = await encryptSecret('hunter2', key);
    await expect(decryptSecret(ciphertext, iv, otherKey)).rejects.toThrow();
  });

  it('rejects a key that is not exactly 32 bytes', async () => {
    const shortKey = await makeTestKey(16);
    await expect(encryptSecret('hunter2', shortKey)).rejects.toThrow('32 bytes');

    const longKey = await makeTestKey(48);
    await expect(encryptSecret('hunter2', longKey)).rejects.toThrow('32 bytes');
  });
});

async function makeTestKey(byteLength = 32): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
