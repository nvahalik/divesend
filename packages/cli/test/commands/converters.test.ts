// CLI-level coverage for sw-xml2ssi / dctool2ssi / dctool2uddf: stdout vs
// `-o <file>` (+ "Wrote" on stderr), mirroring the Python CLIs' contract.

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { run as swXml2ssi } from '../../src/commands/swXml2ssi.js';
import { run as dctool2ssi } from '../../src/commands/dctool2ssi.js';
import { run as dctool2uddf } from '../../src/commands/dctool2uddf.js';

const SW_FIXTURE = fileURLToPath(new URL('../fixtures/shearwater_cloud_min.xml', import.meta.url));
const DCTOOL_FIXTURE = fileURLToPath(
  new URL('../fixtures/dive_2070684351785241573.dctool.xml', import.meta.url),
);

let tmp: string;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'conv-'));
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

describe('sw-xml2ssi', () => {
  it('prints the SSI payload JSON to stdout', async () => {
    await swXml2ssi([SW_FIXTURE]);
    const payload = JSON.parse(stdoutText());
    expect(payload.odin_user_log_depth_m).toBe(18.3);
    expect(payload.odin_user_log_divecomputer_name).toBe('Teric');
    expect(JSON.parse(payload.odin_user_log_diveSamples).length).toBe(4);
  });

  it('writes a file + "Wrote" on stderr with -o', async () => {
    const out = join(tmp, 'p.json');
    await swXml2ssi([SW_FIXTURE, '-o', out]);
    expect(JSON.parse(readFileSync(out, 'utf8')).odin_user_log_divetime).toBe(30);
    expect(stderrText()).toContain('Wrote');
  });
});

describe('dctool2ssi', () => {
  it('prints the SSI payload JSON to stdout', async () => {
    await dctool2ssi([DCTOOL_FIXTURE]);
    const payload = JSON.parse(stdoutText());
    expect(payload.odin_user_log_depth_m).toBe(3.63);
    expect(payload.odin_user_log_gf_set).toBe('50 / 85');
    expect(payload.odin_user_log_divecomputer_name).toBe('Teric');
    expect(payload.odin_user_log_pressure_start_bar).toBe(130.6);
    expect(payload.odin_user_log_divetime).toBe(11); // round(634 s / 60)
    expect(JSON.parse(payload.odin_user_log_diveSamples).length).toBe(187);
  });

  it('writes a file + "Wrote" on stderr with -o', async () => {
    const out = join(tmp, 'p.json');
    await dctool2ssi([DCTOOL_FIXTURE, '-o', out]);
    expect(JSON.parse(readFileSync(out, 'utf8')).odin_user_log_depth_m).toBe(3.63);
    expect(stderrText()).toContain('Wrote');
  });

  it('emits timezone-independent datetime fields matching the Python', async () => {
    const dateKeys = [
      'odin_user_log_datetime',
      'odin_user_log_date',
      'odin_user_log_entry_time',
      'odin_user_log_divecomputer_dive_ref',
    ] as const;
    // shearwater_transformers.to_ssi_payload against the real fixture:
    const pythonExpected = {
      odin_user_log_datetime: '2026-07-28 12:26',
      odin_user_log_date: '2026-07-28',
      odin_user_log_entry_time: '12:26',
      odin_user_log_divecomputer_dive_ref: '2026-07-28T12:26:13.000-04:00_0',
    };

    const runIn = async (tz: string) => {
      const prev = process.env.TZ;
      process.env.TZ = tz;
      try {
        stdoutSpy.mockClear();
        await dctool2ssi([DCTOOL_FIXTURE]);
        const p = JSON.parse(stdoutText());
        return Object.fromEntries(dateKeys.map((k) => [k, p[k]]));
      } finally {
        if (prev === undefined) delete process.env.TZ;
        else process.env.TZ = prev;
      }
    };

    const utc = await runIn('UTC');
    const nyc = await runIn('America/New_York');
    expect(utc).toEqual(pythonExpected);
    expect(nyc).toEqual(pythonExpected);
    expect(utc).toEqual(nyc);
  });
});

describe('dctool2uddf', () => {
  it('prints a UDDF document to stdout', async () => {
    await dctool2uddf([DCTOOL_FIXTURE]);
    const out = stdoutText();
    expect(out).toContain('<uddf version="3.2.3"');
    const parsed = new XMLParser({ isArray: (n) => n === 'waypoint' }).parse(out);
    const wp = parsed.uddf.profiledata.repetitiongroup.dive.samples.waypoint;
    expect(wp.length).toBe(187);
  });

  it('writes a file + "Wrote" on stderr with -o', async () => {
    const out = join(tmp, 'dive.uddf');
    await dctool2uddf([DCTOOL_FIXTURE, '-o', out]);
    expect(readFileSync(out, 'utf8')).toContain('<uddf version="3.2.3"');
    expect(stderrText()).toContain('Wrote');
  });
});
