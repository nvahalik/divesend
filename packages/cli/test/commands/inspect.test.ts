import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { inspect } from '../../src/commands/inspect.js';
import { engineIsBuilt } from '../../src/engine/engine.js';
import { CliError } from '../../src/io.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/teric-sample.bin', import.meta.url));
const run = engineIsBuilt() ? describe : describe.skip;

let tmp: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'inspect-'));
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  rmSync(tmp, { recursive: true, force: true });
});
const stdoutText = () => stdoutSpy.mock.calls.map((c) => String(c[0])).join('');

run('inspect', () => {
  it('prints a summary comment then the decode JSON, model from the filename', async () => {
    // The shared fixture is named `teric-sample.bin`; give it a
    // `<product>-<ISO>.bin` name (what the DiveSend app writes) so the model
    // is resolved from the filename rather than passed explicitly.
    const named = join(tmp, 'Teric-2026-07-30T19-07-51Z.bin');
    writeFileSync(named, readFileSync(FIXTURE));
    await inspect(named);
    const out = stdoutText();
    expect(out).toMatch(/^\/\/ Teric — 2026-07-30T19:/m);
    expect(out).toMatch(/samples$/m);
    const jsonStart = out.indexOf('{');
    const dive = JSON.parse(out.slice(jsonStart));
    expect(dive.header.deviceModel).toBe('Teric');
    expect(Array.isArray(dive.samples)).toBe(true);
  });

  it('honours --model and -o', async () => {
    const outPath = join(tmp, 'dump.json');
    await inspect(FIXTURE, { model: 'Teric', output: outPath });
    const dive = JSON.parse(readFileSync(outPath, 'utf8').replace(/^\/\/.*$/gm, '').trim());
    expect(dive.header.deviceModel).toBe('Teric');
  });

  it('fails with a CliError on an empty file', async () => {
    const empty = join(tmp, 'empty.bin');
    writeFileSync(empty, Buffer.alloc(0));
    await expect(inspect(empty)).rejects.toBeInstanceOf(CliError);
  });
});
