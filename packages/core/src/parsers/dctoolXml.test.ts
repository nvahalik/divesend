// TS port of tests/test_shearwater_dive_decoder.py's `parse_dctool_xml`
// assertions, translated to @divesend/core's CanonicalDive field names
// (camelCase, WASM-aligned) instead of the Python dataclass's snake_case.
//
// Divergences from the Python (documented, not loosened):
//  * `header.startTime` is an ISO 8601 string keeping the original -04:00
//    offset, not a tz-aware `datetime`.
//  * `header.divetimeS` (634, from <divetime>10:34</divetime>) is NEW: the
//    Python dataclass has no divetime field and drops that element; the
//    core shape has `divetimeS`, so it wins.
//  * `deco_stop_depth_m` -> `decoStopDepthM`, `ndl_s` -> `ndlS`, etc.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseDctoolXml, parseMmssToSeconds, parseDctoolDatetime } from './dctoolXml.js';

const FIXTURE = fileURLToPath(new URL('../../test/fixtures/dive_2070684351785241573.dctool.xml', import.meta.url));
const xml = () => readFileSync(FIXTURE, 'utf8');

describe('parseMmssToSeconds', () => {
  it('parses mm:ss', () => {
    expect(parseMmssToSeconds('00:05')).toBe(5);
    expect(parseMmssToSeconds('15:35')).toBe(935);
    expect(parseMmssToSeconds('10:34')).toBe(634);
  });
});

describe('parseDctoolDatetime', () => {
  it('keeps the original UTC offset', () => {
    expect(parseDctoolDatetime('2026-07-28 12:26:13 -04:00')).toBe('2026-07-28T12:26:13-04:00');
  });
});

describe('parseDctoolXml — known fixture values', () => {
  const dive = parseDctoolXml(xml());

  it('maps the header', () => {
    expect(dive.header.startTime).toBe('2026-07-28T12:26:13-04:00');
    expect(dive.header.maxDepthM).toBe(3.63);
    expect(dive.header.gasO2Percent).toBe(21.0);
    expect(dive.header.gasHePercent).toBe(0.0);
    expect(dive.header.tankBeginPressureBar).toBe(130.59);
    expect(dive.header.tankEndPressureBar).toBe(103.01);
    expect(dive.header.diveMode).toBe('oc');
    expect(dive.header.decoModel).toBe('buhlmann');
    expect(dive.header.gfLow).toBe(50);
    expect(dive.header.gfHigh).toBe(85);
    expect(dive.header.salinity).toBe('salt');
    expect(dive.header.divetimeS).toBe(634);
    expect(dive.header.deviceModel).toBe('Teric');
    expect(dive.header.minTemperatureC).toBeNull();
    expect(dive.header.maxTemperatureC).toBeNull();
    expect(dive.header.cnsPercent).toBeNull();
  });

  it('maps the samples', () => {
    expect(dive.samples.length).toBe(187);

    const first = dive.samples[0];
    expect(first.timeS).toBe(5);
    expect(first.depthM).toBe(1.28);
    expect(first.tempC).toBe(32.22);
    expect(first.ndlS).toBe(5940);
    expect(first.tankPressureBar).toBe(130.59);
    expect(first.decoStopDepthM).toBe(0.0);
    expect(first.ttsS).toBe(60);

    const last = dive.samples[dive.samples.length - 1];
    expect(last.timeS).toBe(935);
    expect(last.depthM).toBe(0.34);
    expect(last.tankPressureBar).toBe(103.01);
    expect(last.ttsS).toBeNull(); // last sample has no <tts>
  });
});
