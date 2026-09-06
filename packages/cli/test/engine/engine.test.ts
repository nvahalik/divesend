import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { engineIsBuilt, decodeRaw } from '../../src/engine/engine.js';
import { CliError } from '../../src/io.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/teric-sample.bin', import.meta.url));
const run = engineIsBuilt() ? describe : describe.skip;
if (!engineIsBuilt()) {
  console.warn('[engine.test] skipped: run `source ~/Code/emsdk/emsdk_env.sh && npm run build -w @divesend/libdivecomputer-wasm`');
}

run('decodeRaw', () => {
  const bytes = new Uint8Array(readFileSync(FIXTURE));

  it('decodes the Teric fixture to a CanonicalDive', async () => {
    const dive = await decodeRaw('', 'Teric', bytes);
    expect(dive.header.deviceModel).toBe('Teric');
    expect(dive.header.startTime.startsWith('2026-07-30T19:')).toBe(true);
    expect(dive.samples.length).toBeGreaterThan(0);
    expect(dive.rawDataHex).toBe(Buffer.from(bytes).toString('hex'));
  });

  it('rejects an unknown model with a CliError', async () => {
    await expect(decodeRaw('', 'NoSuchComputer', bytes)).rejects.toBeInstanceOf(CliError);
    await expect(decodeRaw('', 'NoSuchComputer', bytes)).rejects.toThrow('Unrecognized dive computer model');
  });

  it('rejects an empty buffer with a CliError', async () => {
    await expect(decodeRaw('', 'Teric', new Uint8Array(0))).rejects.toThrow(CliError);
  });
});
