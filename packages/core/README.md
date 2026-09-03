# @divesend/core

Shared TypeScript for building [SSI](https://www.divessi.com/) `save_divelog`
payloads. It carries the SSI app-API's 342-key write schema, a dive → payload
transformer, the dive-conditions enum tables, unit conversions, and the
sample-serialization quirks SSI's backend requires.

Reverse-engineered from the SSI mobile app; **not affiliated with or endorsed by
SSI**. APIs and field meanings can change under you.

Used by the [`divesend` CLI](../cli/) and the DiveSend web app; published so
other tools can reuse the payload layer.

```
npm install @divesend/core
```

ESM only, Node ≥ 20.

## API

### Dive model

`CanonicalDive` — `{ header: DiveHeader; samples: DiveSample[] }`, the neutral
shape the transformer consumes (camelCase SI fields: `header.maxDepthM`,
`header.startTime` ISO 8601, `sample.timeS` / `.depthM` / `.tempC` / `.ndlS` /
`.tankPressureBar` / `.decoStopDepthM` / `.ttsS`, …).

### Transform

`transformDive(dive: CanonicalDive, deviceSerialNumber?: string) => Record<string, unknown>`
— maps a `CanonicalDive` to the `odin_user_log_*` **overrides** for one dive
(depth/time headers, gas, tank pressures, GF, the encoded `diveSamples` /
`*Dataset` strings, alarms). Pass `deviceSerialNumber` when you have it — without
it SSI never creates the dive's device-identity record.

### Write schema

- `buildCreatePayload(accountRecord, overrides, diveNr)` — a full 342-key
  payload for a **new** dive: every schema key defaulted, `overrides` applied,
  `odin_user_log_id: null`, `odin_user_log_nr: diveNr`.
- `buildWritePayload(readRecord, overrides)` — for an **update**: start from the
  dive's current server record, apply `overrides`.
- `WRITE_SCHEMA_KEYS`, `READ_TO_WRITE_ALIASES`, `WRITE_ONLY_DEFAULTS` — the raw
  tables behind the builders.

### Sample vocabulary

`DIVE_PHASE_FLAGS`, `ALARM_FLAGS`, `ASCENT_ADVISORY_M_PER_MIN`,
`ASCENT_WARNING_M_PER_MIN`, `SURFACED_M`, `NDL_CAP`, and the helpers
`divePhaseBits(depthM)`, `ascentAlarmBits(ascentSpeedMPerMin)`,
`alarmDataset(samples)` — the bitmask/encoding rules for `odin_user_log_diveSamples`
entries.

### Enums

`ENUM_VALUES` (id → label per `EnumCategory`) and `sortedOptions(category)` for
the dive-conditions fields (`diveType`, `entry`, `tankType`, `waterBody`,
`current`, `weather`).

### Units & numbers

`FT_TO_M`, `PSI_TO_BAR`, `SEMICIRCLE_TO_DEG`, `BAR_TO_PA`, `KELVIN_OFFSET`,
`FIT_EPOCH_MS`, `METERS_TO_FEET`, `BAR_TO_PSI`; `metersToFeet`, `barToPsi`,
`celsiusToFahrenheit`, `formatDuration`, `formatMinutesSeconds`; and
`roundHalfToEven(x, digits?)` — banker's rounding, matching Python's `round()`
(the reference implementation's behaviour).

### Serialization

`serializeWithForcedDoubles(value, isDoubleField)` and `SAMPLE_DOUBLE_FIELDS`.
SSI's Dart deserializer is int/double-strict: a whole-number float serialized by
`JSON.stringify` as `6` (not `6.0`) is rejected as an int. Use this for the
embedded `diveSamples` / `*Dataset` strings.

## Usage

```ts
import { transformDive, buildCreatePayload } from '@divesend/core';

// `dive` is a CanonicalDive from your decoder (FIT, libdivecomputer, …)
const overrides = transformDive(dive, deviceSerialNumber);

// For a new dive you also need the account's most recent record and the next
// dive number, both from a GET save_divelog=get_divelog call:
const payload = buildCreatePayload(accountRecord, overrides, nextDiveNr);

// POST `json_data=<JSON.stringify(payload)>` to api.divessi.com/app/a21.php
// (what=save_divelog). See the `divesend` CLI for a working client.
```

## Releasing

Versioned independently of the CLI. From the repo root:

```
npm run build --workspace @divesend/core
cd packages/core && npm publish
```

`prepare` / `prepack` run `tsc`, so `dist/` is always fresh on install and pack.
Bump `packages/cli/`'s and `app/`'s dependency range when a release changes the API.
