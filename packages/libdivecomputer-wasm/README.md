# @divesend/libdivecomputer-wasm

[libdivecomputer](https://libdivecomputer.org/) plus a custom Web Bluetooth
transport (`src/ble_web.c`), compiled to a WASM module the DiveSend web app loads
to talk to dive computers straight from the browser.

## Layout

- `src/*.c`, `src/webble_internal.h` — the Web Bluetooth transport, device
  session, and dive download/decode glue written for this project.
- `vendor/libdivecomputer/` — vendored upstream libdivecomputer (unmodified).
- `vendor/cJSON/` — vendored cJSON (unmodified).
- `build.sh` — compiles the vendored core with `emcc` and links it with our
  transport into `dist/libdivecomputer.js` + `dist/libdivecomputer.wasm`.

`build.sh` compiles the libdivecomputer core files directly with `emcc` rather
than going through autotools — the vendored tree omits `doc/` and `examples/`,
which `configure.ac` lists unconditionally, so `autoreconf` fails before
`emconfigure` ever runs. See the comment at the top of `build.sh`.

## Building

Requires the [Emscripten SDK](https://emscripten.org/). `build.sh` checks for
`emcc` and exits with instructions if it is missing.

```bash
source ~/Code/emsdk/emsdk_env.sh      # or wherever your emsdk lives
npm run build -w @divesend/libdivecomputer-wasm
```

Output lands in `dist/` (gitignored). Nothing here is committed — consumers
build it on demand.

## Consumers

`packages/app` copies `dist/libdivecomputer.{js,wasm}` into its `public/` via a
`sync-engine` step wired into `predev`/`prebuild`; that step runs this build
automatically when `dist/` is missing. After changing anything under `src/` or
`vendor/`, rebuild here (or `npm run clean -w @divesend/libdivecomputer-wasm`
first to force a fresh copy downstream).

The throwaway PoC harness in `../../webble/` loads `dist/libdivecomputer.js`
through a `webble/engine` symlink pointing at this package's `dist/`.
