// Shared CLI I/O, matching the Python CLIs' contract:
// positional <file> in (or stdin), process.stdout out, `-o <path>` writes the
// file and prints a "Wrote <path>." notice to stderr. Errors -> "Error: <msg>"
// on stderr + exit 1.

import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { style } from './style.js';

/** Read a file (Buffer) or, when no path / `-`, stdin (Buffer). */
export async function readInput(path?: string): Promise<Buffer | string> {
  if (path && path !== '-') {
    try {
      return await readFile(path);
    } catch (exc) {
      const code = (exc as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') fail(`No such file: ${path}`);
      if (code === 'EISDIR') fail(`${path} is a directory, not a file.`);
      if (code === 'EACCES') fail(`Permission denied reading ${path}.`);
      throw exc;
    }
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Write `text` to stdout, or to `outPath` (+ a "Wrote <path>." notice on stderr). */
export function writeOutput(text: string, outPath?: string): void {
  if (outPath) {
    writeFileSync(outPath, text);
    process.stderr.write(style.dim(`Wrote ${outPath}.`) + '\n');
  } else {
    process.stdout.write(text + '\n');
  }
}

/**
 * A user-facing error that should print as a clean message rather than a stack
 * trace. `cli.ts` catches these, prints "Error: <message>", and exits 1.
 */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

/** Throw a {@link CliError}. Kept as a helper so call sites stay terse. */
export function fail(msg: string): never {
  throw new CliError(msg);
}

/** Print "Error: <msg>" to stderr. Does not exit. */
export function printError(msg: string): void {
  console.error(`${style.error('Error:')} ${msg}`);
}
