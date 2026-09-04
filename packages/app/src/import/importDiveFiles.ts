// app/src/import/importDiveFiles.ts
import { parseDiveFile } from '@divesend/core/parsers';
import { toImportedStoredDive } from '../db/Dive';
import { putDive } from '../db/db';

export interface ImportFileResult {
  fileName: string;
  status: 'ok' | 'error';
  diveCount: number;
  message?: string;
}

export interface ImportResult {
  addedDiveCount: number;
  fileResults: ImportFileResult[];
}

/**
 * Parses and stores every dive in each dropped/chosen file, one file at a
 * time. A file that fails to parse (unrecognised format, malformed content)
 * is reported as an error and does not stop the remaining files -- same
 * "stream not batch" philosophy as ConnectScreen's per-dive handling.
 */
export async function importDiveFiles(files: File[]): Promise<ImportResult> {
  const fileResults: ImportFileResult[] = [];
  let addedDiveCount = 0;

  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const imported = await parseDiveFile(bytes);
      for (const { dive, deviceSerial } of imported) {
        await putDive(toImportedStoredDive(dive, deviceSerial));
      }
      fileResults.push({ fileName: file.name, status: 'ok', diveCount: imported.length });
      addedDiveCount += imported.length;
    } catch (err) {
      fileResults.push({
        fileName: file.name,
        status: 'error',
        diveCount: 0,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { addedDiveCount, fileResults };
}
