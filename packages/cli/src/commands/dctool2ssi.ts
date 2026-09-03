// `divesend dctool2ssi <file.xml> [-o out.json]` -- parse libdivecomputer's
// `dctool parse` XML into a CanonicalDive, then run it through
// @divesend/core's payload transformer (port of
// shearwater_transformers.to_ssi_payload) and emit JSON.

import { parseArgs } from 'node:util';
import { transformDive } from '@divesend/core';
import { readInput, writeOutput, fail } from '../io.js';
import { parseDctoolXml } from '../converters/dctoolXml.js';
import { ssiDateFields } from '../dateFields.js';

export async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: { o: { type: 'string', short: 'o' } },
    allowPositionals: true,
  });

  const inPath = positionals[0];
  if (!inPath) {
    fail('dctool2ssi: missing <file.xml>');
  }

  const bytes = await readInput(inPath);
  const text = typeof bytes === 'string' ? bytes : bytes.toString('utf8');

  let payload: Record<string, unknown>;
  try {
    const dive = parseDctoolXml(text);
    payload = transformDive(dive);
    // core's transformDive formats these with host-local `Date` getters /
    // `toISOString()`, which makes the CLI's output timezone-dependent. The
    // dctool XML's `startTime` carries the dive computer's own UTC offset, so
    // recompute them deterministically from that wall-clock. Matches
    // shearwater_transformers.to_ssi_payload's output for the real fixture.
    const df = ssiDateFields(dive.header.startTime);
    payload.odin_user_log_datetime = df.datetime;
    payload.odin_user_log_date = df.date;
    payload.odin_user_log_entry_time = df.entry_time;
    payload.odin_user_log_divecomputer_dive_ref = df.dive_ref;
  } catch (exc) {
    fail((exc as Error).message);
  }

  writeOutput(JSON.stringify(payload, null, 2), values.o);
}
