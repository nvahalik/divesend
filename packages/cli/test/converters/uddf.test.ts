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
import { toUddf } from '../../src/converters/uddf.js';
import { parseDctoolXml } from '../../src/converters/dctoolXml.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/dive_2070684351785241573.dctool.xml', import.meta.url));

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
