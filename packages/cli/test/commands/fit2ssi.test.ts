// TS port of the `main`/CLI cases from tests/test_fit_ssi_convert.py
// (test_main_writes_scuba_payload_file, test_main_apnea_file_writes_payload)
// plus CLI-level dispatch coverage.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { run } from '../../src/commands/fit2ssi.js';

const SCUBA_FIXTURE = fileURLToPath(new URL('../fixtures/garmin_scuba_saint_catherine.fit', import.meta.url));
const APNEA_FIXTURE = fileURLToPath(new URL('../fixtures/garmin_apnea_descent_mk2.fit', import.meta.url));

let tmp: string;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fit2ssi-'));
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
  stdoutSpy.mockRestore();
  rmSync(tmp, { recursive: true, force: true });
});

const stderrText = () => stderrSpy.mock.calls.map((c) => String(c[0])).join('');
const stdoutText = () => stdoutSpy.mock.calls.map((c) => String(c[0])).join('');

describe('fit2ssi run()', () => {
  it('writes the scuba payload to a file with -o', async () => {
    const out = join(tmp, 'p.json');
    await run([SCUBA_FIXTURE, '-o', out]);
    const written = JSON.parse(readFileSync(out, 'utf8'));
    expect(written.odin_user_log_divetime).toBe(49);
    expect(stderrText()).toContain('Wrote');
  });

  it('writes the apnea payload to a file with -o', async () => {
    const out = join(tmp, 'apnea.json');
    await run([APNEA_FIXTURE, '-o', out]);
    const written = JSON.parse(readFileSync(out, 'utf8'));
    expect(written.odin_user_log_divetime).toBe(111);
    expect(stderrText()).toContain('Wrote');
  });

  it('prints JSON to stdout when no -o is given', async () => {
    await run([APNEA_FIXTURE]);
    const payload = JSON.parse(stdoutText());
    expect(payload.odin_user_log_divetime).toBe(111);
  });

  it('exits 1 with `error:` on an unparseable file', async () => {
    const bad = join(tmp, 'bad.fit');
    writeFileSync(bad, Buffer.from('not a fit file at all'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('exit');
    }) as never);
    await expect(run([bad])).rejects.toThrow();
    expect(errSpy.mock.calls.map((c) => String(c[0])).join('')).toContain('error:');
    exit.mockRestore();
    errSpy.mockRestore();
  });
});
