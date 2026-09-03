// `divesend dctool2uddf <file.xml> [-o out.uddf]` -- parse libdivecomputer's
// `dctool parse` XML into a CanonicalDive, then serialise it to UDDF (port of
// shearwater_transformers.to_uddf).

import { parseArgs } from 'node:util';
import { readInput, writeOutput, fail } from '../io.js';
import { parseDctoolXml } from '../converters/dctoolXml.js';
import { toUddf } from '../converters/uddf.js';

export async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: { o: { type: 'string', short: 'o' } },
    allowPositionals: true,
  });

  const inPath = positionals[0];
  if (!inPath) {
    fail('dctool2uddf: missing <file.xml>');
  }

  const bytes = await readInput(inPath);
  const text = typeof bytes === 'string' ? bytes : bytes.toString('utf8');

  let uddf: string;
  try {
    uddf = toUddf(parseDctoolXml(text));
  } catch (exc) {
    fail((exc as Error).message);
  }

  writeOutput(uddf, values.o);
}
