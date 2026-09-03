// Shared CLI I/O, matching the Python CLIs' contract:
// positional <file> in (or stdin), process.stdout out, `-o <path>` writes the
// file and prints `Wrote <path>` to stderr. Errors -> `error: <msg>` on stderr
// + exit 1.

import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';

/** Read a file (Buffer) or, when no path / `-`, stdin (Buffer). */
export async function readInput(path?: string): Promise<Buffer | string> {
  if (path && path !== '-') {
    return readFile(path);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Write `text` to stdout, or to `outPath` (+ "Wrote <path>" on stderr). */
export function writeOutput(text: string, outPath?: string): void {
  if (outPath) {
    writeFileSync(outPath, text);
    process.stderr.write(`Wrote ${outPath}\n`);
  } else {
    process.stdout.write(text + '\n');
  }
}

/** Print `error: <msg>` to stderr and exit 1. */
export function fail(msg: string): never {
  console.error('error: ' + msg);
  process.exit(1);
}
