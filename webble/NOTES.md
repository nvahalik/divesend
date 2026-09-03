# WebBLE PoC — hardware test results

## Device under test

Shearwater Teric (model ID 8 / `TERIC` in libdivecomputer's `shearwater_common.h`), Bluetooth LE.

- Service UUID: `fe25c237-0ece-443c-b0aa-e02033e7029d` (matches the "Shearwater Perdix/Teric" entry hardcoded in `libdc-swift`'s `BLEManager.swift`)
- Characteristic UUID: `27b7570b-359e-45a3-91bb-cf7e70049bd2`
- Found via Chrome's `chrome://bluetooth-internals/#devices`, after using the PoC's "Pick Device" button to confirm Web Bluetooth could see the Teric at all.

## Round 1 — basic bridge test (spec: `2026-08-22-webble-poc-design.md`)

Connect, subscribe to notifications, open libdivecomputer's custom iostream, attempt a bare `dc_iostream_read` with nothing written first.

```
Selected device: Teric
Connected and subscribed to notifications.
libdivecomputer custom iostream opened.
Read failed or timed out (result -1).
```

**Verdict:** bridge confirmed working end-to-end. The timeout is expected, not a bug — Shearwater's protocol is strictly command/response, and this test never sent a command. `DC_STATUS_TIMEOUT` propagated correctly through the whole chain: `characteristicvaluechanged` (never fired) → `Module.webble.read` → Asyncify-suspended `webble_js_read` → `custom_read` → `dc_iostream_read`. This confirmed the Web Bluetooth ↔ WASM ↔ libdivecomputer Asyncify bridge itself works correctly against real hardware.

## Round 2 — real firmware-version handshake (spec: `2026-08-23-webble-firmware-handshake-design.md`)

Same connect/subscribe/open sequence, then call `shearwater_petrel_device_open()` + `shearwater_common_rdbi(ID_FIRMWARE, ...)` — libdivecomputer's own SLIP-framed request/response protocol code, unmodified.

```
Selected device: Teric
Connected and subscribed to notifications.
libdivecomputer custom iostream opened.
Firmware version: V37 Classic
```

(One build issue hit along the way and fixed: `Module.HEAPU8` wasn't exported by this Emscripten version by default, causing a `RuntimeError` when `main.js` tried to read the response bytes — fixed by adding `HEAPU8` to `-sEXPORTED_RUNTIME_METHODS` in `build.sh`.)

**Verdict:** bridge confirmed working end-to-end with real bidirectional protocol traffic. A real command was SLIP-framed, written over `characteristic.writeValueWithoutResponse()`, and a real parsed response ("V37 Classic") came back through the same Asyncify read path — proving Web Bluetooth + WASM-compiled libdivecomputer can drive at least one genuine libdivecomputer protocol exchange against a real Shearwater Teric in Chrome.

## Round 3 — real dive manifest walk, download, and decode (spec: `2026-08-23-webble-dive-download-design.md`)

Same connect/subscribe/open sequence, then `dc_device_foreach()` (walks the real dive manifest via `shearwater_petrel_device_foreach`, downloads the most recent dive's raw bytes via `shearwater_common_download`, stops after the first dive), decoded with libdivecomputer's real sample-level parser (`shearwater_petrel_parser_create` + `dc_parser_get_field`/`dc_parser_get_datetime`) — all unmodified libdivecomputer code.

```
Selected device: Teric
Connected and subscribed to notifications.
libdivecomputer custom iostream opened.
Shearwater device session opened.
Firmware version: V37 Classic
Most recent dive: date=2026-08-22 11:42:10 duration=2484s maxdepth=10.8m rawsize=19456
```

**Two real issues hit and fixed along the way, both worth remembering for any follow-on work:**

1. **Write flooding / lockup scare.** The first attempt caused the Teric's BLE screen to disappear without timing out (looked like a crash, recovered via forced power-button reboot). Root cause turned out to be issue #2 below, not actual flooding — but a 20ms write-pacing delay was added to `Module.webble.write()` as cheap defensive insurance regardless, since Web Bluetooth's `writeValueWithoutResponse()` Promise resolving doesn't guarantee the radio has caught up, unlike CoreBluetooth's `canSendWriteWithoutResponse` signal that `libdc-swift`'s `BLEManager.swift` explicitly waits on.
2. **The real bug: closing the device between operations.** `webble_shearwater_read_firmware` and `webble_shearwater_download_dive` each independently opened and closed their own `dc_device_t`. For the Shearwater Petrel family, `dc_device_close()` isn't just local cleanup — it sends a genuine "exit command mode" request (`{0x2E, 0x90, 0x20, 0x00}`) to the device. Closing after the firmware read (to immediately reopen for the dive download) told the Teric to exit BLE command mode mid-session, which is exactly why it dropped back to its home screen — not a firmware crash, just the device correctly honoring a command we sent by accident. Fixed by sharing one `dc_device_t*` (`webble_shearwater_open_device()`, called once) across both operations.

**Verdict:** the full pipeline — manifest walk, raw dive download, and real sample-level decode — works end to end against real hardware, producing an actual dive (date, duration, max depth) pulled live off the Teric over Web Bluetooth. This is no longer a transport-bridge proof of concept; it's a working (if minimal) real dive-download path.

## Round 4 — full multi-dive download, generic (vendor-agnostic) engine, fingerprint-based incremental sync (spec: `2026-08-24-webble-multi-dive-download-design.md`, plan: `2026-08-24-webble-multi-dive-download-implementation.md`)

Rebuilt the download/decode pipeline to use libdivecomputer's *generic* API (`dc_descriptor_filter`/`dc_device_open`/`dc_parser_new`/`dc_device_foreach`) instead of Shearwater-specific calls, added full per-dive sample-profile decoding (not just a header summary), and added fingerprint-based incremental sync so repeat connects only download new dives.

### Device under test

Shearwater Teric. `dc_descriptor_filter` correctly identified it by BLE-advertised name alone (no manual model selection) — `webble_get_device_vendor()`/`webble_get_device_product()` report `Shearwater` / `Petrel 2` (the Teric shares the Petrel 2 descriptor entry in libdivecomputer's table; this is expected, not a bug).

### First connect: full manifest walk

All 20 logged dives downloaded and decoded successfully, full header + sample profile for each (real depth curves, declining tank pressure, correct `ndlS`/`ttsS`/`decoStopDepthM` deco-state tracking, correct salinity/deco-model/GF values). Confirmed via `JSON.stringify(dives[0], null, 2)`: `startTime: "2026-08-22T11:42:10Z"`, `maxDepthM: 10.75944`, `decoModel: "buhlmann"`, `gfLow: 50`, `gfHigh: 85`, `salinity: "fresh"`, 557 samples with plausible descent/bottom/deco-clock/ascent/safety-stop shape. `minTemperatureC`/`maxTemperatureC`/`cnsPercent` correctly `null` (Shearwater's parser doesn't expose those `DC_FIELD_*`s — confirmed against the driver source, not a decode bug).

### Two real bugs found and fixed during this round's hardware testing

1. **Reconnect without a page reload crashed the manifest walk (`webble_download_new_dives` returned -3).** `webble_open()` (`ble_web.c`) had no reentrancy guard — unlike `webble_open_device()`, which was already guarded in Task 4's review. Every Connect click created a brand-new `dc_context_t`/`dc_iostream_t` without closing the previous one, leaking it and leaving the Shearwater device's internal BLE command-mode session state confused, so the *second* `dc_device_foreach` in a page session reliably failed. Fixed by having `main.js`'s `connect()` unconditionally call `webble_close_device()` then `webble_close()` (in that order — device must close first, since `dc_device_close()` sends a real "exit command mode" write over the still-open iostream) at the very start of every connect, before opening anything new. Both are safe no-ops the first time.

2. **Fingerprint-based incremental sync never actually engaged — every connect redownloaded the full history.** The original design read the device's serial number (used as the `localStorage` fingerprint key) via `webble_get_device_serial_hex()` *before* calling `webble_download_new_dives()` — but the serial only becomes known as a side effect of that same call (the `DC_EVENT_DEVINFO` event fires inside the family driver's `_device_foreach`, not at `_device_open` time). So the pre-download lookup key was always empty, the stored fingerprint was never found, and every connect passed an empty fingerprint (download everything). Fixed by keying the fingerprint off `state.device.id` instead — the Web Bluetooth API's own persistent per-device identifier, known immediately after `requestDevice()` resolves, sidestepping the serial's chicken-and-egg timing problem entirely.

### Second connect (same page session, after both fixes)

```
Selected device: Teric
Connected and subscribed to notifications.
libdivecomputer custom iostream opened.
Device session opened: Shearwater Petrel 2
Up to date -- no new dives.
```

Confirms the full round trip: `localStorage` fingerprint written after the first download → read back correctly on the second connect → passed to `dc_device_set_fingerprint` → libdivecomputer's own manifest walk stopped immediately, zero dives re-downloaded.

**Verdict:** the vendor-generic, multi-dive, fingerprinted download-and-decode engine works end to end against real hardware — full history on first connect, correct incremental "nothing new" on repeat connects, real per-dive sample profiles with plausible physical data. This closes out subsystem #1 (BLE decode engine) of the DiveSend web port.

## Open questions for any future round

- Fingerprint-based incremental sync is now implemented and confirmed working for the single-device, single-browser-tab case tested here. Multi-device (two different dive computers used from the same browser) and cross-browser/cross-device sync scenarios are unexplored.
- Only tested against a Shearwater Teric so far — the generic `dc_descriptor_filter`/`dc_device_open`/`dc_parser_new` API path should work for any libdivecomputer-supported BLE dive computer, but no other vendor has been hardware-tested yet. Worth verifying against a second vendor before treating the "vendor-generic" claim as fully proven, not just architecturally sound.
- The 20ms write-pacing delay (Round 3) is still an untuned, conservative default — unchanged this round.
- No UI beyond the bare log pane and in-memory `dives` array — persisting dives durably (IndexedDB) and a real Connect-screen UI are the next subsystem, not part of this round.
