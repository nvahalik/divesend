// Coverage for the unified `divesend convert` command: format auto-detection,
// `--from` / `--to` handling, stdout vs `-o <file>` (+ "Wrote" on stderr), and
// the error contract. Supersedes the old fit2ssi / converters command tests.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { convert } from '../../src/commands/convert.js';
import { detectFormat } from '@divesend/core/parsers/detectFormat';
import { CliError } from '../../src/io.js';

const SCUBA_FIT = fileURLToPath(new URL('../../../core/test/fixtures/garmin_scuba_saint_catherine.fit', import.meta.url));
const APNEA_FIT = fileURLToPath(new URL('../../../core/test/fixtures/garmin_apnea_descent_mk2.fit', import.meta.url));
const SW_XML = fileURLToPath(new URL('../../../core/test/fixtures/shearwater_cloud_min.xml', import.meta.url));
const DC_XML = fileURLToPath(new URL('../../../core/test/fixtures/dive_2070684351785241573.dctool.xml', import.meta.url));
const UDDF_FIXTURE = fileURLToPath(new URL('../../../core/test/fixtures/garmin_scuba_saint_catherine.uddf', import.meta.url));

let tmp: string;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'convert-'));
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
const stdoutJson = () => JSON.parse(stdoutText());

const parseUddf = (xml: string) =>
  new XMLParser({ ignoreAttributes: false, isArray: (n) => n === 'waypoint' }).parse(xml);

describe('detectFormat', () => {
  it('recognises each fixture from its bytes', () => {
    expect(detectFormat(readFileSync(SCUBA_FIT))).toBe('fit');
    expect(detectFormat(readFileSync(APNEA_FIT))).toBe('fit');
    expect(detectFormat(readFileSync(SW_XML))).toBe('sw-xml');
    expect(detectFormat(readFileSync(DC_XML))).toBe('dc-xml');
    expect(detectFormat(readFileSync(UDDF_FIXTURE))).toBe('uddf');
  });

  it('returns null for unrecognised bytes', () => {
    expect(detectFormat(Buffer.from('not a dive file'))).toBeNull();
  });
});

describe('convert -> ssi (auto-detected)', () => {
  it('FIT scuba to stdout', async () => {
    await convert(SCUBA_FIT);
    expect(stdoutJson().odin_user_log_divetime).toBe(49);
  });

  it('FIT apnea to a file with --output', async () => {
    const out = join(tmp, 'apnea.json');
    await convert(APNEA_FIT, { output: out });
    expect(JSON.parse(readFileSync(out, 'utf8')).odin_user_log_divetime).toBe(111);
    expect(stderrText()).toContain('Wrote');
  });

  it('Shearwater XML to stdout', async () => {
    await convert(SW_XML);
    const p = stdoutJson();
    expect(p.odin_user_log_depth_m).toBe(18.3);
    expect(p.odin_user_log_divecomputer_name).toBe('Teric');
    expect(JSON.parse(p.odin_user_log_diveSamples).length).toBe(4);
  });

  it('dctool XML to stdout, with timezone-independent datetime fields', async () => {
    await convert(DC_XML);
    const p = stdoutJson();
    expect(p.odin_user_log_depth_m).toBe(3.63);
    expect(p.odin_user_log_gf_set).toBe('50 / 85');
    expect(p.odin_user_log_pressure_start_bar).toBe(130.6);
    expect(p.odin_user_log_divetime).toBe(11);
    expect(p.odin_user_log_datetime).toBe('2026-07-28 12:26');
    expect(p.odin_user_log_divecomputer_dive_ref).toBe('2026-07-28T12:26:13.000-04:00_0');
    expect(JSON.parse(p.odin_user_log_diveSamples).length).toBe(187);
  });
});

describe('convert --to uddf', () => {
  it('dctool XML -> UDDF (187 waypoints)', async () => {
    await convert(DC_XML, { to: 'uddf' });
    const out = stdoutText();
    expect(out).toContain('<uddf version="3.2.3"');
    const wp = parseUddf(out).uddf.profiledata.repetitiongroup.dive.samples.waypoint;
    expect(wp.length).toBe(187);
  });

  it('FIT scuba -> UDDF, cross-checked against the sibling fixture', async () => {
    // Loose agreement with garmin_scuba_saint_catherine.uddf: the profile is
    // downsampled, so compare peak depth (within 0.5 m) rather than waypoint
    // counts.
    await convert(SCUBA_FIT, { to: 'uddf', output: join(tmp, 'x.uddf') });
    const ours = parseUddf(readFileSync(join(tmp, 'x.uddf'), 'utf8'));
    const wps: number[] = ours.uddf.profiledata.repetitiongroup.dive.samples.waypoint.map(
      (w: Record<string, unknown>) => Number(w.depth),
    );
    expect(wps.length).toBeGreaterThan(50);

    const sibling = parseUddf(
      readFileSync(fileURLToPath(new URL('../../../core/test/fixtures/garmin_scuba_saint_catherine.uddf', import.meta.url)), 'utf8'),
    );
    const siblingDepths: number[] = sibling.uddf.profiledata.repetitiongroup.dive.samples.waypoint.map(
      (w: Record<string, unknown>) => Number(w.depth),
    );
    expect(Math.abs(Math.max(...wps) - Math.max(...siblingDepths))).toBeLessThanOrEqual(0.5);
  });

  it('FIT apnea -> UDDF emits a thin depth/time profile', async () => {
    await convert(APNEA_FIT, { to: 'uddf' });
    const out = stdoutText();
    expect(out).toContain('<uddf version="3.2.3"');
    const wp = parseUddf(out).uddf.profiledata.repetitiongroup.dive.samples.waypoint;
    expect(wp.length).toBeGreaterThan(0);
    expect(Number(wp[0].divetime)).toBeGreaterThanOrEqual(0);
  });

  it('Shearwater XML -> UDDF (4 waypoints, gas + GF from the header)', async () => {
    await convert(SW_XML, { to: 'uddf' });
    const root = parseUddf(stdoutText()).uddf;
    expect(Number(root.gasdefinitions.mix.o2)).toBeCloseTo(0.21, 2);
    expect(Number(root.decomodel.buehlmann.gradientfactorlow)).toBe(85);
    expect(root.profiledata.repetitiongroup.dive.samples.waypoint.length).toBe(4);
  });
});

describe('convert --from override', () => {
  it('honours --from dc-xml on a file that would also sniff as dc-xml', async () => {
    await convert(DC_XML, { from: 'dc-xml' });
    expect(stdoutJson().odin_user_log_depth_m).toBe(3.63);
  });

  it('rejects an unknown --from with a CliError', async () => {
    await expect(convert(DC_XML, { from: 'bogus' })).rejects.toBeInstanceOf(CliError);
    await expect(convert(DC_XML, { from: 'bogus' })).rejects.toThrow('Expected "fit", "sw-xml", or "dc-xml"');
  });

  it('rejects an unknown --to with a CliError', async () => {
    await expect(convert(DC_XML, { to: 'xml' })).rejects.toThrow('Expected "ssi" or "uddf"');
  });
});

describe('convert error contract', () => {
  it('fails with a clear message when the format cannot be detected', async () => {
    const bad = join(tmp, 'bad.bin');
    writeFileSync(bad, Buffer.from('not a dive file at all'));
    await expect(convert(bad)).rejects.toBeInstanceOf(CliError);
    await expect(convert(bad)).rejects.toThrow('Could not detect the input format');
  });

  it('fails when the input file does not exist', async () => {
    await expect(convert(join(tmp, 'nope.fit'))).rejects.toThrow('No such file');
  });

  it('fails on an unparseable FIT file', async () => {
    const bad = join(tmp, 'bad.fit');
    // 12-byte header with the ".FIT" signature so it detects as fit, then junk.
    const buf = Buffer.alloc(32);
    buf.write('.FIT', 8, 'latin1');
    writeFileSync(bad, buf);
    await expect(convert(bad)).rejects.toThrow();
  });
});
