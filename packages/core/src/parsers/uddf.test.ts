// TS port of tests/test_shearwater_transformers.py's `to_uddf` case, plus a
// parseDctoolXml -> toUddf -> re-parse round-trip.
//
// The Python test navigates the tree with ElementTree namespace-qualified
// paths ("{http://www.streit.cc/uddf/3.2/}..."); fast-xml-parser drops the
// default-namespace prefix, so the tag names here are bare.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import type { CanonicalDive } from '@divesend/core';
import { toUddf, parseUddf, UddfParseError } from './uddf.js';
import { parseDctoolXml } from './dctoolXml.js';

const FIXTURE = fileURLToPath(new URL('../../test/fixtures/dive_2070684351785241573.dctool.xml', import.meta.url));

const parse = (uddf: string) =>
  new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: true,
    isArray: (n) => n === 'waypoint',
  }).parse(uddf);

const diveEl = (uddf: string) => parse(uddf).uddf.profiledata.repetitiongroup.dive;

describe('toUddf — real fixture', () => {
  const dive: CanonicalDive = parseDctoolXml(readFileSync(FIXTURE, 'utf8'));
  const uddf = toUddf(dive);
  const root = parse(uddf);
  const d = diveEl(uddf);

  it('has a dive element with the expected datetime', () => {
    expect(d).toBeTruthy();
    expect(String(d.informationbeforedive.datetime)).toBe('2026-07-28T12:26:13-04:00');
  });

  it('emits tank pressures in Pascals', () => {
    expect(Math.round(Number(d.tankdata.tankpressurebegin))).toBe(Math.round(130.59 * 100000));
    expect(Math.round(Number(d.tankdata.tankpressureend))).toBe(Math.round(103.01 * 100000));
  });

  it('emits one waypoint per sample with depth/divetime', () => {
    const wp = d.samples.waypoint;
    expect(wp.length).toBe(187);
    expect(Number(wp[0].depth)).toBe(1.28);
    expect(Number(wp[0].divetime)).toBe(5);
    // deepest sample in this fixture is 3.57 m (the header maxdepth 3.63 is
    // never reached by a 5 s profile sample).
    expect(Math.max(...wp.map((w: any) => Number(w.depth)))).toBe(3.57);
  });

  it('names the generator "divesend" (deliberate; not Python parity)', () => {
    expect(root.uddf.generator.name).toBe('divesend');
  });

  it('emits the gas mix as a fraction', () => {
    expect(Number(root.uddf.gasdefinitions.mix.o2)).toBe(0.21);
    expect(Number(root.uddf.gasdefinitions.mix.he)).toBe(0);
  });

  it('converts sample temperature to Kelvin (2 dp)', () => {
    expect(Number(d.samples.waypoint[0].temperature)).toBe(305.37); // 32.22 + 273.15
  });

  it('tags tank pressure waypoints with the mix ref', () => {
    expect(d.samples.waypoint[0].tankpressure['@_ref']).toBe('mix1');
    expect(Math.round(Number(d.samples.waypoint[0].tankpressure['#text']))).toBe(
      Math.round(130.59 * 100000),
    );
  });
});

describe('parseDctoolXml -> toUddf round-trips', () => {
  it('re-parses to the same waypoint count and gradient factors', () => {
    const dive = parseDctoolXml(readFileSync(FIXTURE, 'utf8'));
    const reparsed = diveEl(toUddf(dive));
    expect(reparsed.samples.waypoint.length).toBe(dive.samples.length);

    const bue = parse(toUddf(dive)).uddf.decomodel.buehlmann;
    expect(Number(bue.gradientfactorlow)).toBe(50);
    expect(Number(bue.gradientfactorhigh)).toBe(85);
  });
});

const uddfText = readFileSync(
  fileURLToPath(new URL('../../test/fixtures/shearwater_cloud.uddf', import.meta.url)),
  'utf8',
);

describe('parseUddf', () => {
  it('parses every dive in the file', () => {
    const dives = parseUddf(uddfText);
    expect(dives).toHaveLength(1);
  });

  it('maps dive 1 header fields', () => {
    const d = parseUddf(uddfText)[0];
    expect(d.header.startTime).toBe('2026-07-29T12:25:47Z');
    expect(d.header.divetimeS).toBe(2196);
    expect(d.header.maxDepthM).toBeCloseTo(4.60365868, 1);
    expect(d.header.gfLow).toBe(50);
    expect(d.header.gfHigh).toBe(85);
    expect(d.header.decoModel).toBe('buhlmann');
    expect(d.header.diveMode).toBe('oc');
  });

  it('maps dive 1 samples with unit conversions', () => {
    const d = parseUddf(uddfText)[0];
    expect(d.samples).toHaveLength(442);
    expect(d.samples[0].timeS).toBe(0);
    // temperature: UDDF Kelvin -> Celsius, all plausible
    for (const s of d.samples) {
      if (s.tempC != null) {
        expect(s.tempC).toBeGreaterThan(-5);
        expect(s.tempC).toBeLessThan(45);
      }
      if (s.tankPressureBar != null) {
        expect(s.tankPressureBar).toBeGreaterThan(0);
        expect(s.tankPressureBar).toBeLessThan(400);
      }
    }
  });

  it('leaves every P1 enrichment field unset', () => {
    const d = parseUddf(uddfText)[0];
    for (const k of [
      'firmwareVersion',
      'cnsStartPercent',
      'sacVolumeLPerMin',
      'sacPressurePsiPerMin',
      'startLatitude',
      'heartRateAvgBpm',
      'waterTypeId',
      'gasMixes',
    ] as const) {
      expect(d.header[k] ?? null).toBeNull();
    }
    for (const s of d.samples) {
      expect(s.heartRateBpm ?? null).toBeNull();
      expect(s.gasMixIndex ?? null).toBeNull();
    }
  });

  it('parses a hand-written minimal 2-dive file', () => {
    const xml = `<?xml version="1.0"?><uddf xmlns="http://www.streit.cc/uddf/3.2/" version="3.2.3">
      <decomodel><buehlmann id="x"><gradientfactorhigh>85</gradientfactorhigh><gradientfactorlow>50</gradientfactorlow></buehlmann></decomodel>
      <profiledata><repetitiongroup>
        <dive id="a"><informationbeforedive><datetime>2026-01-01T10:00:00Z</datetime></informationbeforedive>
          <informationafterdive><greatestdepth>18.0</greatestdepth><diveduration>1800</diveduration></informationafterdive>
          <samples>
            <waypoint><depth>0</depth><divetime>0</divetime><temperature>293.15</temperature><divemode type="opencircuit"/></waypoint>
            <waypoint><depth>18</depth><divetime>900</divetime><temperature>288.15</temperature></waypoint>
          </samples></dive>
        <dive id="b"><informationbeforedive><datetime>2026-01-01T12:00:00Z</datetime></informationbeforedive>
          <informationafterdive><greatestdepth>12.0</greatestdepth><diveduration>1200</diveduration></informationafterdive>
          <samples><waypoint><depth>0</depth><divetime>0</divetime></waypoint></samples></dive>
      </repetitiongroup></profiledata></uddf>`;
    const dives = parseUddf(xml);
    expect(dives).toHaveLength(2);
    expect(dives[0].header.startTime).toBe('2026-01-01T10:00:00Z');
    expect(dives[0].samples).toHaveLength(2);
    expect(dives[0].samples[1].tempC).toBeCloseTo(288.15 - 273.15, 2);
    expect(dives[1].header.maxDepthM).toBe(12);
  });

  it('throws UddfParseError on non-UDDF or zero-dive input', () => {
    expect(() => parseUddf('<notuddf/>')).toThrow(UddfParseError);
    expect(() => parseUddf('<uddf xmlns="http://www.streit.cc/uddf/3.2/"><profiledata/></uddf>')).toThrow(
      UddfParseError,
    );
  });

  it('throws UddfParseError when a dive is missing informationbeforedive > datetime', () => {
    const xml = `<?xml version="1.0"?><uddf xmlns="http://www.streit.cc/uddf/3.2/" version="3.2.3">
      <profiledata><repetitiongroup>
        <dive id="a"><informationbeforedive></informationbeforedive>
          <informationafterdive><greatestdepth>10</greatestdepth><diveduration>600</diveduration></informationafterdive>
          <samples><waypoint><depth>0</depth><divetime>0</divetime></waypoint></samples>
        </dive>
      </repetitiongroup></profiledata></uddf>`;
    expect(() => parseUddf(xml)).toThrow(UddfParseError);
  });
});
