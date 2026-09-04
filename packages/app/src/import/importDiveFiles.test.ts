// @vitest-environment jsdom
/// <reference types="node" />
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { importDiveFiles } from './importDiveFiles';
import { closeDb, getAllDives } from '../db/db';

function fileFromFixture(relPath: string, name: string, type = 'application/octet-stream'): File {
  const bytes = readFileSync(fileURLToPath(new URL(relPath, import.meta.url)));
  return new File([bytes], name, { type });
}

afterEach(async () => {
  await closeDb();
  indexedDB.deleteDatabase('dive-send');
});

describe('importDiveFiles', () => {
  it('imports a single Shearwater XML file', async () => {
    const file = fileFromFixture('../../../core/test/fixtures/shearwater_cloud_min.xml', 'dive.xml', 'text/xml');
    const result = await importDiveFiles([file]);
    expect(result.addedDiveCount).toBe(1);
    expect(result.fileResults).toEqual([{ fileName: 'dive.xml', status: 'ok', diveCount: 1 }]);
    const stored = await getAllDives();
    expect(stored).toHaveLength(1);
  });

  it('imports the multi-format batch and reports one unrecognised file as an error without aborting the rest', async () => {
    const files = [
      fileFromFixture('../../../core/test/fixtures/shearwater_cloud_min.xml', 'a.xml', 'text/xml'),
      fileFromFixture('../../../core/test/fixtures/dive_2070684351785241573.dctool.xml', 'b.xml', 'text/xml'),
      new File([new TextEncoder().encode('not a dive file')], 'notes.txt', { type: 'text/plain' }),
    ];
    const result = await importDiveFiles(files);
    expect(result.addedDiveCount).toBe(2);
    expect(result.fileResults).toHaveLength(3);
    const bad = result.fileResults.find((r) => r.fileName === 'notes.txt');
    expect(bad?.status).toBe('error');
    expect(bad?.diveCount).toBe(0);
    expect(bad?.message).toBeTruthy();
    const stored = await getAllDives();
    expect(stored).toHaveLength(2);
  });

  it('imports every dive from a multi-dive UDDF file', async () => {
    const file = fileFromFixture('../../../core/test/fixtures/shearwater_cloud.uddf', 'export.uddf', 'application/xml');
    const result = await importDiveFiles([file]);
    expect(result.fileResults[0].status).toBe('ok');
    expect(result.addedDiveCount).toBe(result.fileResults[0].diveCount);
    const stored = await getAllDives();
    expect(stored).toHaveLength(result.addedDiveCount);
    expect(stored.every((d) => d.id.startsWith('00000000-'))).toBe(true); // scrubbed fixture's serial
  });

  it('re-importing the same file is a no-op dedup, not a duplicate', async () => {
    const file = fileFromFixture('../../../core/test/fixtures/shearwater_cloud_min.xml', 'dive.xml', 'text/xml');
    await importDiveFiles([file]);
    await importDiveFiles([file]);
    const stored = await getAllDives();
    expect(stored).toHaveLength(1);
  });
});
