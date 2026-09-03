# DiveSend web app — hardware test results

## Round 1 — full app end-to-end (spec: `docs/superpowers/specs/2026-08-24-app-persistence-and-dive-list-design.md`, plan: `docs/superpowers/plans/2026-08-24-app-persistence-and-dive-list-implementation.md`)

First real hardware test of the actual React app (`app/`, `npm run dev`), as opposed to `webble/`'s plain-JS test harness used for all prior rounds. Exercises the whole subsystem #2 pipeline: WASM engine bridge, multi-vendor characteristic resolution, IndexedDB persistence, and the Connect/List/Detail screens together for the first time.

### Device under test

Shearwater Teric, same unit as all prior rounds. Resolved via the generic vendor-probe loop as `Shearwater Petrel 2` (expected — the Teric shares the Petrel 2 descriptor entry in libdivecomputer's table, already noted in `webble/NOTES.md` Round 4; not a bug).

### One hiccup on the very first Connect click

The first Connect attempt hung indefinitely after GATT connect succeeded and notifications were subscribed (the Teric's own screen showed "Wait connect," its normal BLE-command-mode idle state) — no further log lines appeared, and no console error, for well over the 5s read timeout that should have unwound the stalled call on its own. Retrying (clicking Connect again) surfaced:

```
libdivecomputer.js:569 Aborted(Assertion failed: We cannot start an async operation when one is already in flight)
```

This is Emscripten's Asyncify runtime correctly refusing to start a second suspended WASM call while the first attempt's was still stuck — i.e. it caught the symptom, not the cause. The underlying stall itself was never root-caused in this round; the working theory is BLE-session flakiness on the device's side (plausible after the many repeated connect/disconnect cycles this device has been through across every round of this project so far), not a bug in this round's new code specifically. After the aborted retry, a subsequent Connect click worked cleanly and the rest of the flow completed correctly (see below) — no further hangs. Worth watching for recurrence in a future round; if it repeats, the natural next step is to reproduce it while capturing the exact point of the stall (e.g. by adding a log line before each `await` in `ConnectScreen.connect()`) rather than guessing further.

### Successful run

```
Selected device: Teric
Resolved vendor: Shearwater
Connected and subscribed to notifications.
Device session opened: Shearwater Petrel 2
Downloaded dive 1: ...
...
Downloaded dive 20: ...
Downloaded 20 new dive(s).
```

20 dives downloaded. The app auto-switched to the Dives list (`onDivesImported` → `refreshKey` bump + navigate to `'list'`), showing all 20 with sparklines.

### List/detail UI

Confirmed: dive rows render correctly (date, depth, duration, sparkline). Opening a dive's detail view renders correctly — real depth-profile chart, not blank or broken.

### Persistence survives a reload

Confirmed: a full browser reload (not just in-app navigation) still shows all 20 dives immediately, proving `db.ts`'s IndexedDB persistence is real, not an in-memory illusion.

### Fingerprint round-trip works from the real app

Confirmed: a second Connect click (after the reload) returned `Up to date -- no new dives.` — the full fingerprint persistence chain (keyed by `state.device.id` in `localStorage`, read/written by `ConnectScreen`, compared by `webble_download_new_dives`'s `dc_device_set_fingerprint`) works correctly end-to-end from the actual React app, not just `webble/`'s plain-JS harness where this was originally debugged and fixed (two real bugs found and fixed there: a missing session-teardown reentrancy guard, and the fingerprint key needing to be `device.id` instead of the C-side serial — see `webble/NOTES.md` Round 4).

### Verdict

Subsystem #2 (local persistence + dive list/detail UI) works end to end against real hardware: connect, multi-vendor characteristic resolution (exercised for Shearwater; other vendors' resolution logic is exercised by the same code path but untested against non-Shearwater hardware), full 20-dive download, correct list/detail rendering, real IndexedDB persistence across a reload, and correct incremental-sync behavior on repeat connects. The one open item is the unexplained first-attempt hang — not blocking, but worth a closer look if it recurs.

## Round 2 — SSI authentication (spec: `docs/superpowers/specs/2026-08-24-ssi-auth-design.md`, plan: `docs/superpowers/plans/2026-08-24-ssi-auth-implementation.md`)

First real test of the SSI login/logout flow, including the Vite dev-server CORS proxy for `api.divessi.com` (that API sends no `Access-Control-Allow-Origin` header — confirmed with `curl` before this subsystem was designed; a direct browser `fetch()` would have failed outright without the proxy).

### Results

- **Login with a real SSI account**: succeeded, switched to the logged-in view.
- **Wrong-password login**: showed the correct inline error message on the form, not a blank failure or console-only error.
- **Reload persistence**: after logging in and reloading the page, the app still showed logged in (token correctly read back from `localStorage` on mount, dive count re-fetched live via the `useEffect` keyed on `token`, not stale).
- **Logout clears storage**: after clicking Log out, `localStorage.getItem('ssi-token')` returned `null` in devtools — confirmed the token is actually removed, not just hidden by in-memory state.

### Verdict

Subsystem #3 (SSI authentication) works end to end against the real SSI API: the CORS proxy correctly bridges the browser to `api.divessi.com`, login/logout/error-display/reload-persistence all behave as designed, and the token-only persistence model (no password ever touches browser storage) round-trips correctly across a reload.
