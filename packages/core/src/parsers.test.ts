import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseDiveFile, UnknownDiveFormatError } from './parsers.js';

const fx = (name: string) =>
  Uint8Array.from(readFileSync(fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url))));

describe('parseDiveFile', () => {
  it('sniffs and parses a Shearwater DL7 XML to one dive', async () => {
    const dives = await parseDiveFile(fx('shearwater_cloud_min.xml'));
    expect(dives).toHaveLength(1);
    expect(typeof dives[0].header.startTime).toBe('string');
    expect(Array.isArray(dives[0].samples)).toBe(true);
  });

  it('sniffs and parses a dctool XML to one dive', async () => {
    const dives = await parseDiveFile(fx('dive_2070684351785241573.dctool.xml'));
    expect(dives).toHaveLength(1);
  });

  it('lazy-loads the FIT parser and returns one dive', async () => {
    const dives = await parseDiveFile(fx('garmin_scuba_saint_catherine.fit'));
    expect(dives).toHaveLength(1);
    expect(dives[0].header.maxDepthM).toBeGreaterThan(0);
  });

  it('honours an explicit formatHint', async () => {
    const dives = await parseDiveFile(fx('shearwater_cloud_min.xml'), 'sw-xml');
    expect(dives).toHaveLength(1);
  });

  it('sniffs and parses a Shearwater Cloud Desktop UDDF export', async () => {
    const dives = await parseDiveFile(fx('shearwater_cloud.uddf'));
    expect(dives).toHaveLength(1);
  });

  it('throws UnknownDiveFormatError on unrecognised bytes', async () => {
    await expect(parseDiveFile(new TextEncoder().encode('nope'))).rejects.toBeInstanceOf(UnknownDiveFormatError);
  });
});
