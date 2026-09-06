#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIBDC="$ROOT/vendor/libdivecomputer"
BUILD="$ROOT/build"

if ! command -v emcc >/dev/null 2>&1; then
  echo "error: emcc not found on PATH." >&2
  echo "The webble C tests link against libdivecomputer and run under node via emcc." >&2
  echo "Activate the Emscripten SDK first, e.g.:  source ~/Code/emsdk/emsdk_env.sh" >&2
  exit 1
fi

# Reuse the core static lib + generated headers from build.sh; build them if
# this is a clean checkout.
if [ ! -f "$BUILD/libdivecomputer-core.a" ] || [ ! -f "$BUILD/gen/libdivecomputer/version.h" ]; then
  echo "== core library not built yet -- running build.sh first =="
  "$ROOT/build.sh"
fi

echo "== Building resolve_descriptor_test =="
emcc -I "$BUILD/gen" -I "$LIBDC/include" -I "$LIBDC/src" \
  "$ROOT/test/resolve_descriptor_test.c" "$ROOT/src/descriptor_match.c" "$BUILD/libdivecomputer-core.a" \
  -sEXIT_RUNTIME=1 \
  -o "$BUILD/resolve_descriptor_test.js"

echo "== Running resolve_descriptor_test =="
node "$BUILD/resolve_descriptor_test.js"
