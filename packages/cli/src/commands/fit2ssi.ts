// `divesend fit2ssi <file.fit> [-o out.json]` -- port of fit_ssi_convert.py's
// main(): parse the FIT file, convert to an SSI save_divelog payload, emit JSON.

import { parseArgs } from 'node:util';
import { readInput, writeOutput, fail } from '../io.js';
import { parseFit, convertToSsiPayload, FitParseError } from '../converters/garminFit.js';

export async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: { o: { type: 'string', short: 'o' } },
    allowPositionals: true,
  });

  const inPath = positionals[0];
  if (!inPath) {
    fail('fit2ssi: missing <file.fit>');
  }

  const bytes = await readInput(inPath);
  const buf = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;

  let payload: Record<string, unknown>;
  try {
    const parsed = parseFit(new Uint8Array(buf));
    payload = convertToSsiPayload(parsed);
  } catch (exc) {
    if (exc instanceof FitParseError) {
      fail(exc.message);
    }
    throw exc;
  }

  writeOutput(JSON.stringify(payload, null, 2), values.o);
}
