#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIBDC="$ROOT/vendor/libdivecomputer"
CJSON="$ROOT/vendor/cJSON"
BUILD="$ROOT/build"   # intermediate objects + static lib (gitignored)
DIST="$ROOT/dist"     # published artifacts: libdivecomputer.js / .wasm (gitignored)

if ! command -v emcc >/dev/null 2>&1; then
  echo "error: emcc not found on PATH." >&2
  echo "This package compiles libdivecomputer to WASM and needs the Emscripten SDK." >&2
  echo "Install it, then activate it in this shell, e.g.:" >&2
  echo "  source ~/Code/emsdk/emsdk_env.sh" >&2
  exit 1
fi

# NOTE: The autotools path (emconfigure ./configure && emmake make) does not
# work here because the vendored libdivecomputer source tree does not include
# the doc/ and examples/ directories, while configure.ac unconditionally lists
# doc/Makefile, doc/doxygen.cfg, doc/man/Makefile, and examples/Makefile in
# AC_CONFIG_FILES. This makes `autoreconf --install` fail at the automake step
# ("required directory ./examples does not exist", "required directory ./doc
# does not exist") before emconfigure/emmake are ever invoked, regardless of
# --disable-examples (which only affects the Makefile.am SUBDIRS conditional,
# not the AC_CONFIG_FILES requirement checked by automake). Per the plan, we
# do not patch configure.ac / vendored source, and instead compile the core
# transport-layer files directly with emcc.

mkdir -p "$BUILD/objs"

# libdivecomputer's <libdivecomputer/version.h> is normally generated from
# version.h.in by autotools (which we bypass -- see the note above). Generate it
# into $BUILD/gen and put that dir first on the include path. config.h is NOT
# needed: every #include of it is guarded by HAVE_CONFIG_H, which we never define.
GEN="$BUILD/gen"
dc_m4() { sed -n "s/^m4_define(\[$1\],\[\(.*\)\])/\1/p" "$LIBDC/configure.ac"; }
DC_VERSION_MAJOR=$(dc_m4 dc_version_major)
DC_VERSION_MINOR=$(dc_m4 dc_version_minor)
DC_VERSION_MICRO=$(dc_m4 dc_version_micro)
DC_VERSION_SUFFIX=$(dc_m4 dc_version_suffix)
DC_VERSION="${DC_VERSION_MAJOR}.${DC_VERSION_MINOR}.${DC_VERSION_MICRO}"
[ -n "$DC_VERSION_SUFFIX" ] && DC_VERSION="${DC_VERSION}-${DC_VERSION_SUFFIX}"
mkdir -p "$GEN/libdivecomputer"
sed -e "s/@DC_VERSION@/$DC_VERSION/" \
    -e "s/@DC_VERSION_MAJOR@/$DC_VERSION_MAJOR/" \
    -e "s/@DC_VERSION_MINOR@/$DC_VERSION_MINOR/" \
    -e "s/@DC_VERSION_MICRO@/$DC_VERSION_MICRO/" \
    "$LIBDC/include/libdivecomputer/version.h.in" > "$GEN/libdivecomputer/version.h"
echo "== Generated libdivecomputer/version.h (DC_VERSION $DC_VERSION) =="

echo "== Compiling libdivecomputer (full vendored tree, all vendor drivers) with emcc =="
for f in "$LIBDC"/src/*.c; do
  name=$(basename "$f" .c)
  if [ "$name" = "serial_posix" ]; then
    # Uses Linux-only ioctls (ASYNC_SPD_MASK/ASYNC_SPD_CUST/ASYNC_LOW_LATENCY
    # from <linux/serial.h>) unavailable under Emscripten's libc. Not needed:
    # our custom BLE transport (ble_web.c) never uses the native serial
    # transport this file implements.
    continue
  fi
  emcc -I "$GEN" -I "$LIBDC/include" -I "$LIBDC/src" \
    -DHAVE_PTHREAD_H -DENABLE_LOGGING \
    -c "$f" -o "$BUILD/objs/$name.o"
done
emar rcs "$BUILD/libdivecomputer-core.a" "$BUILD"/objs/*.o

echo "== libdivecomputer static library built =="
ls -la "$BUILD/libdivecomputer-core.a"

echo "== Compiling and linking the WebBLE wasm module =="
emcc -I "$GEN" -I "$LIBDC/include" -I "$LIBDC/src" -I "$CJSON" \
  "$ROOT/src/ble_web.c" "$ROOT/src/device_session.c" "$ROOT/src/dive_decode.c" "$ROOT/src/dive_download.c" "$CJSON/cJSON.c" "$BUILD/libdivecomputer-core.a" \
  -sASYNCIFY \
  -sEXPORTED_FUNCTIONS=_webble_open,_webble_close,_webble_open_device,_webble_close_device,_webble_get_device_vendor,_webble_get_device_product,_webble_get_device_serial_hex,_webble_download_new_dives,_webble_get_latest_fingerprint_hex \
  -sEXPORTED_RUNTIME_METHODS=ccall,HEAPU8 \
  -sALLOW_MEMORY_GROWTH=1 \
  -o "$BUILD/libdivecomputer.js"

mkdir -p "$DIST"
cp "$BUILD/libdivecomputer.js" "$BUILD/libdivecomputer.wasm" "$DIST/"

echo "== Build complete: $DIST/libdivecomputer.js / .wasm =="
ls -la "$DIST/libdivecomputer.js" "$DIST/libdivecomputer.wasm"
