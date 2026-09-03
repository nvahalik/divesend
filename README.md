<p align="center">
  <img src=".github/assets/logo.png" width="132" alt="DiveSend logo">
</p>

<h1 align="center">DiveSend</h1>

<p align="center">
  Get your dives off a dive computer and into your
  <a href="https://www.divessi.com/">SSI</a> logbook — plus shared primitives for
  dive-data manipulation and conversion.
</p>

<p align="center">
  <a href="https://github.com/nvahalik/divesend/actions/workflows/ci.yml"><img src="https://github.com/nvahalik/divesend/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

---

An npm workspace. Publishable libraries live under `packages/`; `webble/` and
`website/` stand alone.

## Packages

| Package | Path | What it is |
| --- | --- | --- |
| **`@divesend/core`** | [`packages/core/`](packages/core/) | SSI `save_divelog` payload schema, the dive → payload transformer, unit conversions, and the enum tables. Consumed by the CLI and the app; [published independently](packages/core/README.md). |
| **`divesend`** — CLI | [`packages/cli/`](packages/cli/) | `npx divesend` — offline FIT / Shearwater / `dctool` → SSI converters, plus a direct SSI logbook client. See [its README](packages/cli/README.md). |
| **`@divesend/libdivecomputer-wasm`** | [`packages/libdivecomputer-wasm/`](packages/libdivecomputer-wasm/) | [libdivecomputer] plus a custom Web Bluetooth transport, compiled to WASM for the app. Built on demand (needs the Emscripten SDK); the output is not committed. See [its README](packages/libdivecomputer-wasm/README.md). |

Not packages:

- **`webble/`** — throwaway plain-JS harness for hardware-testing the WASM bridge.
- **`website/`** — the static site for [divesend.com](https://divesend.com).
- **[`docs/ssi-api-reference.md`](docs/ssi-api-reference.md)** — reference for the SSI app API.

## Quick start

```bash
npm install
npm test        # every workspace
npm run build   # every workspace — needs the Emscripten SDK for the WASM engine
```

### CLI

```bash
npx divesend --help
```

### Web app

The app talks to the Worker for auth and the SSI proxy, so run both:

```bash
# one-time: create the Worker's local database
npm -w worker exec wrangler d1 migrations apply divesend --local

# terminal 1 — backend
npm run dev -w worker   # wrangler dev, http://localhost:8787

# terminal 2 — frontend
npm run dev -w app      # Vite, http://localhost:5173 (proxies /api → :8787)
```

`npm run dev -w app` compiles and copies the WASM engine from
`@divesend/libdivecomputer-wasm` on first run — that step needs `emcc` on `PATH`
(`source /path/to/emsdk/emsdk_env.sh`). Once the engine is built, later runs just
reuse it.

## License

[MIT](LICENSE) © Nick Vahalik

[libdivecomputer]: https://libdivecomputer.org/
