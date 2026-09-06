// The only file in the CLI that touches the libdivecomputer wasm module.
// Loads the Node-only build (@divesend/libdivecomputer-wasm/node) once per
// process and exposes a single decode call.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { CanonicalDive } from '@divesend/core';
import { fail } from '../io.js';

const require = createRequire(import.meta.url);

interface EngineModule {
  ccall: (name: string, ret: string | null, argTypes: string[], args: unknown[]) => string;
  _malloc: (n: number) => number;
  _free: (ptr: number) => void;
  HEAPU8: Uint8Array;
}

function wasmPath(): string {
  return require.resolve('@divesend/libdivecomputer-wasm/node/libdivecomputer.wasm');
}

export function engineIsBuilt(): boolean {
  try {
    readFileSync(wasmPath());
    return true;
  } catch {
    return false;
  }
}

let modulePromise: Promise<EngineModule> | null = null;

function loadModule(): Promise<EngineModule> {
  if (modulePromise) return modulePromise;

  let mjs: string;
  let wasm: string;
  try {
    mjs = require.resolve('@divesend/libdivecomputer-wasm/node');
    wasm = wasmPath();
    readFileSync(wasm); // present?
  } catch {
    fail(
      'The decode engine is not built. Run:\n' +
      '  source ~/Code/emsdk/emsdk_env.sh\n' +
      '  npm run build -w @divesend/libdivecomputer-wasm',
    );
  }

  modulePromise = import(pathToFileURL(mjs).href).then((m) =>
    (m.default as (arg?: unknown) => Promise<EngineModule>)({
      locateFile: (p: string) => (p.endsWith('.wasm') ? wasm : p),
      print: () => {},
      printErr: () => {},
    }),
  );
  return modulePromise;
}

export async function decodeRaw(
  vendor: string,
  product: string,
  bytes: Uint8Array,
): Promise<CanonicalDive> {
  const mod = await loadModule();

  const ptr = mod._malloc(Math.max(bytes.length, 1));
  if (bytes.length > 0) mod.HEAPU8.set(bytes, ptr);
  let jsonStr: string;
  try {
    jsonStr = mod.ccall(
      'webble_decode_raw_to_json',
      'string',
      ['string', 'string', 'number', 'number'],
      [vendor, product, ptr, bytes.length],
    );
  } finally {
    mod._free(ptr);
  }

  if (!jsonStr) {
    fail(`libdivecomputer returned nothing decoding this file as a "${product}" dive.`);
  }

  const parsed = JSON.parse(jsonStr) as CanonicalDive | { error: string };
  if (typeof (parsed as { error?: unknown }).error === 'string') {
    const code = (parsed as { error: string }).error;
    const messages: Record<string, string> = {
      'unsupported-model':
        `Unrecognized dive computer model "${product}". ` +
        'Pass --model with the exact product name libdivecomputer uses.',
      'parse-failed': `libdivecomputer could not parse this file as a "${product}" dive.`,
      'invalid-args': 'The input is empty or not a raw dive buffer.',
    };
    fail(messages[code] ?? `Decode failed (${code}).`);
  }
  return parsed as CanonicalDive;
}
