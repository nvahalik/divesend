export type DiveFileFormat = 'fit' | 'sw-xml' | 'dc-xml' | 'uddf';

/** Sniff a dive file's format from its leading bytes. `null` if unrecognised. */
export function detectFormat(bytes: Uint8Array): DiveFileFormat | null {
  // FIT: 12-byte header carries ASCII ".FIT" at offset 8, all protocol versions.
  if (bytes.length >= 12 && new TextDecoder('latin1').decode(bytes.subarray(8, 12)) === '.FIT') {
    return 'fit';
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 4096));
  if (/<uddf[\s>]/i.test(head)) return 'uddf'; // before dc-xml: UDDF also has <dive> elements
  if (/<dl7[\s/>]/i.test(head)) return 'sw-xml';
  if (/<(device|dive)[\s/>]/i.test(head)) return 'dc-xml';
  return null;
}
