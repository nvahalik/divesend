// `divesend convert <file> [--from fit|sw-xml|dc-xml] [--to ssi|uddf] [-o out]`
// -- the single dive-file conversion entry point. The input format is sniffed
// from the bytes (override with `--from`); output defaults to SSI save_divelog
// JSON, `--to uddf` for UDDF. Replaces the old fit2ssi / sw-xml2ssi /
// dctool2ssi / dctool2uddf subcommands.

import { transformDive } from '@divesend/core';
import { readInput, writeOutput, fail } from '../io.js';
import {
  parseFit,
  convertToSsiPayload as fitToSsi,
  toCanonicalDive as fitToCanonical,
} from '@divesend/core/parsers/garminFit';
import {
  parseShearwaterXml,
  convertToSsiPayload as swToSsi,
  toCanonicalDive as swToCanonical,
} from '@divesend/core/parsers/shearwaterXml';
import { parseDctoolXml } from '@divesend/core/parsers/dctoolXml';
import { toUddf } from '@divesend/core/parsers/uddf';
import { detectFormat, type DiveFileFormat } from '@divesend/core/parsers/detectFormat';
import { ssiDateFields } from '../dateFields.js';

export type Target = 'ssi' | 'uddf';

const FORMATS: readonly DiveFileFormat[] = ['fit', 'sw-xml', 'dc-xml'];
const TARGETS: readonly Target[] = ['ssi', 'uddf'];

export interface ConvertOptions {
  /** Force the input format instead of sniffing it from the bytes. */
  from?: string;
  /** Output format. Defaults to `'ssi'`. */
  to?: string;
  /** Write to this path instead of stdout. */
  output?: string;
}

/** True when no dive data is available: no file given and nothing piped in. */
const noInput = (file?: string): boolean =>
  (!file || file === '-') && process.stdin.isTTY === true;

/**
 * Convert a dive file and write the result to stdout or `options.output`.
 * With no `file` (or `-`), reads the dive data from stdin.
 */
export async function convert(file?: string, options: ConvertOptions = {}): Promise<void> {
  if (noInput(file)) {
    fail('No input given. Pass a file path, or pipe a dive file on stdin.');
  }

  const to = (options.to ?? 'ssi') as Target;
  if (!TARGETS.includes(to)) {
    fail(`Unknown --to "${options.to}". Expected "ssi" or "uddf".`);
  }
  if (options.from != null && !FORMATS.includes(options.from as DiveFileFormat)) {
    fail(`Unknown --from "${options.from}". Expected "fit", "sw-xml", or "dc-xml".`);
  }

  const bytes = await readInput(file);
  const buf = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
  if (buf.length === 0) {
    fail('The input is empty. Pass a dive file, or pipe one on stdin.');
  }

  const from = (options.from as DiveFileFormat | undefined) ?? detectFormat(buf) ?? undefined;
  if (!from) {
    fail('Could not detect the input format. Pass --from with "fit", "sw-xml", or "dc-xml".');
  }

  writeOutput(render(from, to, buf), options.output);
}

const json = (payload: unknown): string => JSON.stringify(payload, null, 2);

/** Parse `buf` as `from` and serialise it to `to`. */
function render(from: DiveFileFormat, to: Target, buf: Buffer): string {
  if (from === 'fit') {
    const parsed = parseFit(new Uint8Array(buf));
    return to === 'uddf' ? toUddf(fitToCanonical(parsed)) : json(fitToSsi(parsed));
  }

  if (from === 'sw-xml') {
    const parsed = parseShearwaterXml(buf.toString('utf8'));
    return to === 'uddf' ? toUddf(swToCanonical(parsed)) : json(swToSsi(parsed));
  }

  // dc-xml
  const dive = parseDctoolXml(buf.toString('utf8'));
  if (to === 'uddf') return toUddf(dive);

  const payload = transformDive(dive);
  // core's transformDive formats these with host-local `Date` getters /
  // `toISOString()`, making the CLI's output timezone-dependent. The dctool
  // XML's `startTime` carries the dive computer's own UTC offset, so recompute
  // them deterministically from that wall-clock -- matches
  // shearwater_transformers.to_ssi_payload for the real fixture.
  const df = ssiDateFields(dive.header.startTime);
  payload.odin_user_log_datetime = df.datetime;
  payload.odin_user_log_date = df.date;
  payload.odin_user_log_entry_time = df.entry_time;
  payload.odin_user_log_divecomputer_dive_ref = df.dive_ref;
  return json(payload);
}
