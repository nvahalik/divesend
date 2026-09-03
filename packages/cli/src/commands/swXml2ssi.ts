// `divesend sw-xml2ssi <file.xml> [-o out.json]` -- port of
// shearwater_xml_convert.py's main(): parse the Shearwater Cloud XML export,
// convert to an SSI save_divelog payload, emit JSON.

import { parseArgs } from 'node:util';
import { readInput, writeOutput, fail } from '../io.js';
import { parseShearwaterXml, convertToSsiPayload } from '../converters/shearwaterXml.js';

export async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: { o: { type: 'string', short: 'o' } },
    allowPositionals: true,
  });

  const inPath = positionals[0];
  if (!inPath) {
    fail('sw-xml2ssi: missing <file.xml>');
  }

  const bytes = await readInput(inPath);
  const text = typeof bytes === 'string' ? bytes : bytes.toString('utf8');

  let payload: Record<string, unknown>;
  try {
    payload = convertToSsiPayload(parseShearwaterXml(text));
  } catch (exc) {
    fail((exc as Error).message);
  }

  writeOutput(JSON.stringify(payload, null, 2), values.o);
}
