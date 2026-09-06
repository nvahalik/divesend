// Resolves which dive computer a raw .bin came from, for the descriptor
// lookup in the decode engine. The DiveSend app writes raw files as
// `<product>-<ISO-start-time>.bin` (see rawSourceFromDive in
// packages/app/src/engine/downloadSession.ts), so the filename carries the
// product name -- never a vendor.

import { fail } from './io.js';

export interface ResolvedModel {
  /** Always '' from the CLI today; reserved for a future --vendor flag. */
  vendor: string;
  /** The dive computer's product name as libdivecomputer's descriptor table spells it. */
  product: string;
}

/** `<product>` from a `<product>-<YYYY...>.bin` basename, or the whole stem, or null. */
export function productFromFilename(filePath?: string): string | null {
  if (!filePath) return null;
  const stem = filePath.replace(/^.*[/\\]/, '').replace(/\.bin$/i, '');
  const m = stem.match(/^(.+?)-\d{4}/);
  const name = (m ? m[1] : stem).trim();
  return name || null;
}

export function resolveModel({ model, filePath }: { model?: string; filePath?: string }): ResolvedModel {
  const explicit = model?.trim();
  if (explicit) return { vendor: '', product: explicit };

  const product = productFromFilename(filePath);
  if (product) return { vendor: '', product };

  fail(
    'Could not determine the dive computer model. ' +
    'Pass --model with the product name, e.g. --model "Teric".',
  );
}
