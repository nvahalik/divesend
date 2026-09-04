import type { CanonicalDive } from './types.js';
import { detectFormat, type DiveFileFormat } from './parsers/detectFormat.js';
import { parseShearwaterXml, toCanonicalDive as shearwaterToCanonicalDive } from './parsers/shearwaterXml.js';
import { parseDctoolXml } from './parsers/dctoolXml.js';
import { parseUddf } from './parsers/uddf.js';

export { detectFormat, type DiveFileFormat } from './parsers/detectFormat.js';
export {
  parseShearwaterXml,
  toCanonicalDive as shearwaterToCanonicalDive,
  convertToSsiPayload as shearwaterToSsiPayload,
} from './parsers/shearwaterXml.js';
export { parseDctoolXml } from './parsers/dctoolXml.js';
export { toUddf, parseUddf, UddfParseError } from './parsers/uddf.js';

export class UnknownDiveFormatError extends Error {
  constructor(message = 'Could not detect the dive file format.') {
    super(message);
    this.name = 'UnknownDiveFormatError';
  }
}

/**
 * Parse a dive file to one or more CanonicalDives. `formatHint` skips sniffing.
 * FIT support is loaded on demand (`@garmin/fitsdk` is large); every other
 * format parses synchronously inside this call.
 */
export async function parseDiveFile(
  bytes: Uint8Array,
  formatHint?: DiveFileFormat,
): Promise<CanonicalDive[]> {
  const fmt = formatHint ?? detectFormat(bytes);
  if (!fmt) throw new UnknownDiveFormatError();

  if (fmt === 'fit') {
    const { parseFit, toCanonicalDive } = await import('./parsers/garminFit.js');
    return [toCanonicalDive(parseFit(bytes))];
  }

  const text = new TextDecoder().decode(bytes);
  if (fmt === 'uddf') return parseUddf(text);
  if (fmt === 'sw-xml') return [shearwaterToCanonicalDive(parseShearwaterXml(text))];
  if (fmt === 'dc-xml') return [parseDctoolXml(text)];

  throw new UnknownDiveFormatError();
}
