# divesend

A command-line tool for divers with an [SSI](https://www.divessi.com/) logbook.

It does two things, entirely offline for the conversions:

1. **Convert dive files to SSI's `save_divelog` JSON** (or UDDF) — from Garmin
   FIT files and Shearwater Cloud / libdivecomputer XML exports.
2. **Talk to the SSI logbook API** directly (`api.divessi.com`) — list, inspect,
   create, and update dives.

It does **not** download dives from a dive computer over Bluetooth / WebBLE.
For that, see [`app/`](../app) (the DiveSend web app).

## Install / run

After publish:

```sh
npx divesend <subcommand> [options]
# or install globally
npm i -g divesend
divesend <subcommand> [options]
```

While unpublished, run the local build directly:

```sh
npm run build --workspaces --if-present   # from the repo root, builds core + cli
node cli/dist/cli.js <command> [options]
```

Every command has its own help: `divesend <command> --help`. `divesend --help`
lists them all, `divesend --version` prints the version.

Diagnostic messages (errors, "Wrote …" notices) are lightly coloured when stderr
is a terminal. Set `NO_COLOR=1` to disable it, or `FORCE_COLOR=1` to keep it
through a pipe.

## Converting dive files

`divesend convert` reads a file argument (or the dive data piped on stdin) and
writes to stdout, or to a file with `-o <path>`. The input format is
auto-detected from the file; pass `--from` to force it. Output defaults to SSI
`save_divelog` JSON (`--to ssi`); `--to uddf` emits UDDF instead.

| `--from`  | input                                        |
| --------- | -------------------------------------------- |
| `fit`     | Garmin FIT                                   |
| `sw-xml`  | Shearwater Cloud XML export                  |
| `dc-xml`  | `dctool` / libdivecomputer "dctool parse" XML |

```sh
# Any supported file -> SSI save_divelog JSON (format sniffed from the bytes)
divesend convert dive.fit -o dive.ssi.json
divesend convert shearwater-export.xml -o dive.ssi.json
divesend convert dive.dctool.xml -o dive.ssi.json

# ... or -> UDDF
divesend convert dive.dctool.xml --to uddf -o dive.uddf
divesend convert dive.fit --to uddf -o dive.uddf

# Read from stdin
cat dive.fit | divesend convert --to uddf > dive.uddf

# Force the input format when detection can't (e.g. an unusual XML)
divesend convert weird.xml --from dc-xml
```

> UDDF from FIT / Shearwater is a thinner profile than from `dc-xml` — depth,
> time, temperature, tank pressure, gas, and gradient factors — since those
> paths project through the leaner canonical dive shape.

## Logbook commands

These need SSI credentials (see [Credentials](#credentials)):

```sh
# List every dive in the logbook (add --json for the raw objects)
divesend list

# Dump one dive's fields as JSON (or a single field with --field)
divesend get 123456
divesend get 123456 --field odin_user_log_depth_m

# Send a save_divelog payload (e.g. the output of a converter, edited)
divesend push dive.ssi.json

# Create a new dive from field overrides (and/or --from-file)
divesend create --set odin_user_log_depth_m=18.3 --set odin_user_log_divetime=42

# Merge-update fields on an existing dive
divesend update 123456 --set odin_user_log_notes='"great viz"'
```

`--set` values are JSON-parsed when possible (so `18.3` is a number, `true` a
boolean); wrap strings in quotes as shown.

## Credentials

The logbook commands (`list`, `get`, `push`, `create`, `update`) authenticate
fresh on every call — no token is stored. Provide credentials with any of:

- environment variables `SSI_EMAIL` and `SSI_PASSWORD`,
- flags `--email <addr> --password <pw>`, or
- `divesend login` (see below).

`divesend login` verifies your SSI email + password and, on success, stores them
at `~/.config/divesend/auth.json` (mode 600; honors `$XDG_CONFIG_HOME`), so the
logbook commands work without env vars or flags. Run it with `--email` /
`--password` to skip the prompts (the password prompt is hidden), or
`divesend login --status` to print the stored email. `divesend logout` removes
the file. The file holds your password in plaintext — the same exposure as
`SSI_PASSWORD` in a shell profile.

Resolution order per field: flags, then env vars, then the stored file.

The converters need no credentials and make no network calls.

## Note on numeric output

The converters' stdout JSON renders top-level whole-number floats without a
trailing `.0` (e.g. `"odin_user_log_depth_m": 18`, where the Python CLI emits
`18.0`). This is a `JSON.stringify` property, not a data difference — it is
harmless for `push` / SSI ingestion (the API reads `$_REQUEST`, so `18` and
`18.0` are equivalent). The nested profile strings (`odin_user_log_diveSamples`,
`odin_user_log_tempDataset`, etc.) *do* keep forced decimals where SSI's parser
is type-strict. Net effect: this CLI's output and the Python CLI's output are
not byte-for-byte diffable.
