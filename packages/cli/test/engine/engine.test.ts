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

  it('emits the Teric UTC offset as its own field, leaving startTime in "Z" UTC', async () => {
    const dive = await decodeRaw('', 'Teric', bytes);
    // The Teric records the offset it had configured at dive time; it must be
    // surfaced, not just folded into startTime.
    expect(typeof dive.header.utcOffsetMinutes).toBe('number');
    // Whole-minute offset within the real-world range (-12:00 .. +14:00).
    expect(Number.isInteger(dive.header.utcOffsetMinutes)).toBe(true);
    expect(dive.header.utcOffsetMinutes).toBeGreaterThanOrEqual(-12 * 60);
    expect(dive.header.utcOffsetMinutes).toBeLessThanOrEqual(14 * 60);
    // startTime is untouched: still true UTC with a trailing Z.
    expect(dive.header.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('rejects an unknown model with a CliError', async () => {
    await expect(decodeRaw('', 'NoSuchComputer', bytes)).rejects.toBeInstanceOf(CliError);
    await expect(decodeRaw('', 'NoSuchComputer', bytes)).rejects.toThrow('Unrecognized dive computer model');
  });

  it('rejects an empty buffer with a CliError', async () => {
    await expect(decodeRaw('', 'Teric', new Uint8Array(0))).rejects.toThrow(CliError);
  });
});
