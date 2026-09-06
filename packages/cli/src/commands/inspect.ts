// `divesend inspect <file.bin> [--model <name>] [-o <out>]` -- decode a raw
// single-dive buffer (the bytes libdivecomputer's parser saw during a BLE
// download; the DiveSend app's "download raw dive data" writes exactly this)
// and print what libdivecomputer sees: a short summary line, then the full
// decode JSON (header + samples + rawDataHex).

import type { CanonicalDive } from '@divesend/core';
import { readInput, writeOutput, fail } from '../io.js';
import { resolveModel } from '../model.js';
import { decodeRaw } from '../engine/engine.js';

export interface InspectOptions {
  /** Dive computer product name; overrides the guess from the filename. */
  model?: string;
  /** Write to this path instead of stdout. */
  output?: string;
}

const noInput = (file?: string): boolean =>
  (!file || file === '-') && process.stdin.isTTY === true;

export async function inspect(file?: string, options: InspectOptions = {}): Promise<void> {
  if (noInput(file)) {
    fail('No input given. Pass a raw dive .bin file, or pipe one on stdin.');
  }

  const bytes = await readInput(file);
  const buf = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
  if (buf.length === 0) {
    fail('The input is empty. Pass a raw dive .bin file.');
  }

  const { vendor, product } = resolveModel({ model: options.model, filePath: file });
  const dive = await decodeRaw(vendor, product, new Uint8Array(buf));

  writeOutput(`${summary(dive)}\n${JSON.stringify(dive, null, 2)}`, options.output);
}

/** Two `//` comment lines: identity, then the headline numbers. */
function summary(dive: CanonicalDive): string {
  const h = dive.header;
  const parts = [`max depth ${h.maxDepthM.toFixed(1)} m`];
  if (h.divetimeS) parts.push(`runtime ${Math.round(h.divetimeS / 60)} min`);
  parts.push(`gas ${Math.round(h.gasO2Percent)}/${Math.round(h.gasHePercent)}`);
  parts.push(`${dive.samples.length} samples`);
  return `// ${h.deviceModel} — ${h.startTime}\n// ${parts.join(' · ')}`;
}
