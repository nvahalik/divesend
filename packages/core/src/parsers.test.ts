import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseDiveFile, UnknownDiveFormatError } from './parsers.js';

const fx = (name: string) =>
  Uint8Array.from(readFileSync(fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url))));

describe('parseDiveFile', () => {
  it('sniffs and parses a Shearwater DL7 XML to one dive', async () => {
    const imported = await parseDiveFile(fx('shearwater_cloud_min.xml'));
    expect(imported).toHaveLength(1);
    expect(typeof imported[0].dive.header.startTime).toBe('string');
    expect(imported[0].deviceSerial).toBe('1234567'); // this fixture's computerSerial
    expect(Array.isArray(imported[0].dive.samples)).toBe(true);
  });

  it('sniffs and parses a dctool XML to one dive with no device serial', async () => {
    const imported = await parseDiveFile(fx('dive_2070684351785241573.dctool.xml'));
    expect(imported).toHaveLength(1);
    expect(imported[0].deviceSerial).toBeNull();
  });

  it('lazy-loads the FIT parser and returns one dive with its device serial', async () => {
    const imported = await parseDiveFile(fx('garmin_scuba_saint_catherine.fit'));
    expect(imported).toHaveLength(1);
    expect(imported[0].dive.header.maxDepthM).toBeGreaterThan(0);
    expect(imported[0].deviceSerial).toBe('3386258516'); // this fixture's fileId serialNumber
  });

  it('honours an explicit formatHint', async () => {
    const imported = await parseDiveFile(fx('shearwater_cloud_min.xml'), 'sw-xml');
    expect(imported).toHaveLength(1);
  });

  it('parses the real UDDF fixture via parseUddf, serial included', async () => {
    const imported = await parseDiveFile(fx('shearwater_cloud.uddf'));
    expect(imported).toHaveLength(1);
    expect(imported[0].deviceSerial).toBe('00000000');
  });

  it('throws UnknownDiveFormatError on unrecognised bytes', async () => {
    await expect(parseDiveFile(new TextEncoder().encode('nope'))).rejects.toBeInstanceOf(UnknownDiveFormatError);
  });
});
