import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { detectFormat } from './detectFormat.js';

const fx = (name: string) => readFileSync(fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url)));

describe('detectFormat', () => {
  it('sniffs each format from its fixture', () => {
    expect(detectFormat(fx('garmin_scuba_saint_catherine.fit'))).toBe('fit');
    expect(detectFormat(fx('garmin_apnea_descent_mk2.fit'))).toBe('fit');
    expect(detectFormat(fx('shearwater_cloud_min.xml'))).toBe('sw-xml');
    expect(detectFormat(fx('dive_2070684351785241573.dctool.xml'))).toBe('dc-xml');
    expect(detectFormat(fx('garmin_scuba_saint_catherine.uddf'))).toBe('uddf');
  });

  it('picks uddf (not dc-xml) for a UDDF file even though it contains <dive> elements', () => {
    const uddf = '<?xml version="1.0"?>\n<uddf xmlns="http://www.streit.cc/uddf/3.2/" version="3.2.3"><profiledata><repetitiongroup><dive/></repetitiongroup></profiledata></uddf>';
    expect(detectFormat(new TextEncoder().encode(uddf))).toBe('uddf');
  });

  it('returns null for non-dive bytes', () => {
    expect(detectFormat(new TextEncoder().encode('not a dive file'))).toBeNull();
  });

  it('accepts a plain Uint8Array (not just a Node Buffer)', () => {
    const u8 = Uint8Array.from(fx('shearwater_cloud_min.xml'));
    expect(detectFormat(u8)).toBe('sw-xml');
  });
});
