# SSI (MySSI / "Mares") Dive Log API — Reference

Reverse-engineered documentation for the private JSON API that the MySSI
mobile app (Android package, `ssiapp=0815_ADR`, tested against app version
`4.1.272`) uses to sync a diver's logbook. There is no public/official API —
everything here was derived from MITM-intercepting the Android app's
traffic and from live testing against a real account, and is implemented in
[`divelog_api_client.py`](../divelog_api_client.py).

A second, older interface exists at `my.divessi.com` (the web dive log,
a server-rendered multi-step HTML wizard) and is documented separately in
[Appendix C](#appendix-c-legacy-web-form-client-my.divessi.com). Prefer the
JSON API below — it's simpler (one POST per save vs. a 3-fragment
scrape-and-resubmit) and is what this repo's Shearwater→SSI upload pipeline
uses.

> **Note on naming:** the underlying account is a Mares/SSI dive computer
> ecosystem account (the mobile app and most of your existing dives are
> branded "Mares"; SSI = Scuba Schools International, which owns Mares).
> Field names throughout use an `odin_user_log_*` / `odin_dive_sites_*`
> prefix inherited from SSI's backend schema ("Odin").

## Contents

- [Base URL & authentication](#base-url--authentication)
- [Endpoints](#endpoints)
  - [`authenticate`](#authenticate)
  - [`get_divelog` (list/read)](#get_divelog-listread)
  - [`save_divelog` (create/update)](#save_divelog-createupdate)
  - [Delete (soft-delete via update)](#delete-soft-delete-via-update)
  - [Gear (`get_gear` / `save_gear`)](#gear-get_gear--save_gear)
  - [Buddies & sites (`get_buddies` / `get_divesites_global`)](#buddies--sites-get_buddies--get_divesites_global)
  - [Certification cards & awards (`get_ccards` / `get_user_badges`)](#certification-cards--awards-get_ccards--get_user_badges)
  - [Other observed `what=` actions (unmapped)](#other-observed-what-actions-unmapped)
- [CLI (`divelog_api_client.py`)](#cli-divelog_api_clientpy)
- [The dive record: full field reference](#the-dive-record-full-field-reference)
- [`odin_user_log_diveSamples` sub-schema](#odin_user_log_divesamples-sub-schema)
- [Known gotchas & caveats](#known-gotchas--caveats)
- [Appendix A: `get_divelog` response shape (siblings of `logbook_details`)](#appendix-a-get_divelog-response-shape-siblings-of-logbook_details)
- [Appendix B: enum ID fields (`var_*_id`)](#appendix-b-enum-id-fields-var_id)
- [Appendix C: legacy web-form client (my.divessi.com)](#appendix-c-legacy-web-form-client-my.divessi.com)

---

## Base URL & authentication

```
https://api.divessi.com/app/a21.php
```

Every request is a GET or POST to this single endpoint; the action is
selected by a `what=` query parameter. Every request also sends these four
fixed query params, which identify the client the same way the Android app
does (no evidence other values are rejected, but these are what's confirmed
to work):

| Param | Value |
|---|---|
| `ssiapp` | `0815_ADR` |
| `version` | `ADR_4.1.272-ssi` |
| `lang` | `en` |
| `context` | `s` |

Auth is a simple bearer-style token, obtained once and passed as a query
param (`token=...`) on every subsequent call. Tokens are long-lived enough
for a session (hours), but this client doesn't persist them — it
re-authenticates on every run.

---

## Endpoints

### `authenticate`

```
GET /app/a21.php?what=authenticate&l=<email>&p=<password>&ssiapp=...&version=...&lang=en&context=s
```

**Response:**
```json
{ "authenticated": true, "token": "..." }
```
On failure: `{"authenticated": false, "error_message": "..."}` (message
varies; wrong password, unknown account, etc.).

Python:
```python
import divelog_api_client as c
token = c.authenticate(email, password)
```

### `get_divelog` (list/read)

```
GET /app/a21.php?what=get_divelog&token=<token>&ssiapp=...&version=...&lang=en&context=s
```

Returns the **entire logbook in one call** — there is no pagination and no
way to fetch a single dive server-side; fetch everything and filter
client-side. This is both the "list dives" and "get one dive" operation.

**Top-level response shape:**

```json
{
  "verified_dives": 21,
  "homescreen_dives": 21,
  "verified_freediving_sessions": 0,
  "homescreen_sessions": 0,
  "highest_certified_divelognumber_scuba": 7,
  "highest_certified_divelognumber_freediving": 0,
  "logbook_details": [ /* array of dive records — see below */ ],
  "logbook_sites": [ /* array of dive site records */ ],
  "logbook_buddies": [ /* array of buddy/contact records */ ],
  "logbook_stats": { /* aggregate account stats */ },
  "logbook_history": { "history_confirmed": 0 }
}
```

See [Appendix A](#appendix-a-get_divelog-response-shape-siblings-of-logbook_details)
for the shapes of `logbook_sites`, `logbook_buddies`, and `logbook_stats`.

Each entry in `logbook_details` is a **dive record** — a flat JSON object
with ~381 keys (a superset of the 342-key write schema below; the extra
keys are read-only bookkeeping like `updates`, `app_version`,
`log_divecomputer_archive_id`, etc. that the server manages and that
aren't part of what you send back). See
[the full field reference](#the-dive-record-full-field-reference).

Python:
```python
divelog = c.get_divelog(token)
dives = divelog["logbook_details"]           # list all
dive = c.find_dive(divelog, 26647462)         # get one, by odin_user_log_id
```

CLI:
```bash
python3 divelog_api_client.py list              # summary table of every dive
python3 divelog_api_client.py list --json       # full raw logbook_details array
python3 divelog_api_client.py get 26647462      # dumps one dive's full JSON
```

### `save_divelog` (create/update)

```
POST /app/a21.php?what=save_divelog&token=<token>&ssiapp=...&version=...&lang=en&context=s
Content-Type: application/x-www-form-urlencoded

json_data=<JSON-encoded dive record>
```

**One endpoint does both create and update**, disambiguated purely by
whether `odin_user_log_id` in the posted JSON is `null`/absent (→ `INSERT`,
i.e. create) or a real existing ID (→ `UPDATE`). Confirmed by inspecting the
raw response, which includes `"sql_success": "INSERT"` or `"UPDATE"`.

The POST body isn't real form data — it's a single field, `json_data`,
whose value is the entire dive record JSON-encoded as a string. The
**fixed 342-key schema** (`WRITE_SCHEMA_KEYS` in the client) must be sent
in full — sending exactly this key set, with unused fields explicitly
`null`, matches observed real-app behavior. Omitting keys is untested.

**Response** (both create and update):
```json
{
  "ok": "added to Log",
  "error": "",
  "temp_id": null,
  "odin_user_log_id": 27497631
}
```
On update, `"ok"` reads `"updated"` (or similar) instead. `odin_user_log_id`
in the response is the authoritative ID — for a create, this is the
server-assigned new ID (your posted `odin_user_log_id: null` is just the
create signal, not an ID you choose).

#### Update

Fetch the dive, apply your changes on top of its **own** current field
values (so untouched fields round-trip unchanged), post it back.

```python
divelog = c.get_divelog(token)
dive = c.find_dive(divelog, 26647462)
payload = c.build_write_payload(dive, {"odin_user_log_comment": "Great viz!", "odin_user_log_rating": 5})
result = c.save_dive(token, payload)
```

`build_write_payload(read_record, overrides)` walks the 342 write keys; for
each one it takes `read_record`'s own value if present (falling back to a
couple of read/write name aliases — see
[Known gotchas](#known-gotchas--caveats) — then to `WRITE_ONLY_DEFAULTS` for
the handful of fields with no read-side source at all), then applies
`overrides` on top.

CLI:
```bash
python3 divelog_api_client.py update 26647462 \
    --set odin_user_log_comment="Great viz, saw a manta" \
    --set odin_user_log_rating=5
# or bulk:
python3 divelog_api_client.py update 26647462 --set-file changes.json
```

#### Create

**Do not reuse `build_write_payload` with a "template" dive for this** —
that blanket-copies the template's own subjective data (site, buddies,
rating, tank size, air temp, dive-shop verification...) into the new
record, which is wrong. Use `build_create_payload` instead, which defaults
every field to null/empty and only carries forward the one field that's
genuinely account-level rather than dive-specific
(`odin_user_log_user_master_id`, the owner ID):

```python
divelog = c.get_divelog(token)
dives = divelog["logbook_details"]
account_record = max(dives, key=lambda d: d["odin_user_log_nr"])   # any real dive, just for the owner ID
next_nr = max(d["odin_user_log_nr"] for d in dives) + 1

new_dive_fields = {...}   # e.g. shearwater_xml_convert.convert_to_ssi_payload(...)
payload = c.build_create_payload(account_record, new_dive_fields, next_nr)
result = c.save_dive(token, payload)
new_id = result["odin_user_log_id"]
```

CLI:
```bash
python3 divelog_api_client.py create --set-file payload.json
# payload.json is typically the output of shearwater_xml_convert.py or
# shearwater_transformers.to_ssi_payload()
```

You must supply `odin_user_log_nr` yourself (the next sequential dive
number for the account — `max(existing nrs) + 1`); the client computes this
automatically in `cmd_create`. `internalPk` should match `odin_user_log_nr`.

See [Known gotchas](#known-gotchas--caveats) for the unresolved
`odin_user_log_confirmed`/`verified` limitation on created dives.

### Delete (soft-delete via update)

There's no separate delete endpoint — deletion is just an **update** that
sets `odin_user_log_deleted: 1`:

```bash
python3 divelog_api_client.py update 27497631 --set odin_user_log_deleted=1
```
Response: `{"ok": "deleted", "error": "", "temp_id": "", "odin_user_log_id": 27497631}`.
The dive drops out of `logbook_details` on the next `get_divelog` (soft
delete — the record presumably still exists server-side with
`odin_user_log_deleted=1`, but this client has no evidence of an
"undelete" path).

---

## Gear (`get_gear` / `save_gear`)

Reverse-engineered by MITM-capturing the Android app's own "Gear" screen
(profile → gear icon → item list → item detail → Edit → Save) in a rooted
emulator — not previously covered by `divelog_api_client.py`, which only
implements the dive-log endpoints. Same `a21.php` host, same auth token.

**List:**
```
GET /app/a21.php?what=get_gear&token=<token>&ssiapp=...&version=...&lang=en&context=s
```
Returns a flat JSON array (no wrapper object) of every gear item on the
account, active and inactive both apparently included (filter client-side
on `gear_deleted`):
```json
{
  "gear_id": 382015,
  "gear_user_master_id": 5012047,
  "gear_deleted": 0,
  "gear_manufacturer_id": 40,
  "gear_main_cat_id": 4,
  "gear_main_product_id": 19,
  "gear_manufacturer_misc": "",
  "gear_product_name_modell": "Ergo Dry - White",
  "gear_product_serial": "",
  "gear_bluetooth_address": "",
  "gear_buy_date": "2026-06-19",
  "gear_buy_dealer_odin_id": 0,
  "gear_buy_dealer": "Scuba Diver’s Paradise",
  "gear_hide_service_badge": 0,
  "gear_comment": "",
  "gear_images_upload_id": 0,
  "gear_files_upload_id": 0,
  "timestamp": "2026-06-21 01:00:52",
  "gear_used_count": 0
}
```
`gear_main_cat_id`/`gear_main_product_id` are enum FKs into the app's
bundled category/product catalog (same "no enum-listing endpoint exists"
situation as the dive record's `var_*_id` fields — see
[Appendix B](#appendix-b-enum-id-fields-var_id)); observed categories in
the UI: Snorkeling System, Exposure System, Delivery System, Information
System, Buoyancy Control System, Specialty Training and Accessory System.
`gear_manufacturer_id` is a similar FK (`40` = Mares in every capture, the
only manufacturer this account has gear from).

**Update (and by inference, create):**
```
POST /app/a21.php?what=save_gear&token=<token>&ssiapp=...&version=...&lang=en&context=s
Content-Type: application/x-www-form-urlencoded

json_data=<JSON-encoded gear record>
```
Much smaller fixed schema than `save_divelog` — 16 keys, confirmed by two
live edit-and-save captures (changing `gear_product_serial` and
`gear_comment` independently, each time resending the full record):
```json
{
  "gear_id": 382015,
  "gear_user_master_id": 5012047,
  "gear_deleted": 0,
  "gear_manufacturer_id": 40,
  "gear_manufacturer_misc": "",
  "gear_main_cat_id": 4,
  "gear_main_product_id": 19,
  "gear_product_name_modell": "Ergo Dry - White",
  "gear_buy_date": "2026-06-19 00:00:00.000",
  "gear_product_serial": "SN-RECON-TEST-02",
  "gear_buy_dealer": "Scuba Diver’s Paradise",
  "gear_date_last_service": null,
  "gear_date_next_service": null,
  "gear_comment": "recon-test-comment",
  "timestamp": "2026-08-15 14:05:16.000",
  "gear_bluetooth_address": "",
  "needsUpload": true
}
```
Response is the single updated gear record, same shape as a `get_gear`
list entry. Notes:
- `gear_buy_date` is sent with a full `HH:MM:SS.mmm` time component on
  write (`00:00:00.000`) but comes back date-only (`YYYY-MM-DD`) on read —
  same read/write asymmetry pattern as other date fields in this API.
- `timestamp` is set to the current wall-clock time by the client on every
  save (confirmed: it changed between two edits of the same record,
  independent of `gear_buy_date`) — treat it as a client-side
  last-modified stamp, not a server-authoritative one.
- `needsUpload: true` is always sent — same local-sync-bookkeeping pattern
  as `WRITE_ONLY_DEFAULTS` in the dive-record schema; the real app writes
  to a local Drift DB first (edits apply and display instantly, offline)
  and syncs to `save_gear` opportunistically in the background (observed
  an "image uploaded" snackbar firing seconds *after* the edit screen had
  already returned to the read-only detail view) — don't assume a save is
  synced just because the UI shows the new value immediately.
**Create** — confirmed by capturing a real "Manual input equipment" →
Save flow (the initial captures in this section had this button
silently no-op; that turned out to be mistargeted taps in the automation,
not an app/API limitation — the flow works fine). Two differences from
update:
```json
{
  "gear_id": "",
  "gear_user_master_id": 5012047,
  "gear_deleted": 0,
  "gear_manufacturer_id": 40,
  "gear_manufacturer_misc": null,
  "gear_main_cat_id": 4,
  "gear_main_product_id": 4,
  "gear_product_name_modell": "RECON-CREATE-TEST",
  "gear_buy_date": "2026-08-15 07:12:34.000",
  "gear_product_serial": "",
  "gear_buy_dealer": "",
  "gear_date_last_service": null,
  "gear_date_next_service": null,
  "gear_comment": "",
  "timestamp": null,
  "gear_bluetooth_address": "",
  "needsUpload": true
}
```
- `gear_id` is `""` (**empty string**, not `null` and not omitted) — this
  is the create signal, distinct from the dive record's `null`-means-create
  convention.
- `timestamp` is `null` on create (server assigns it — compare to update,
  where the client always sends the current wall-clock time).

  Response is the created record with a server-assigned `gear_id`:
  `{"gear_id":396560,"gear_user_master_id":5012047,...}` — same shape as a
  `get_gear` entry. `gear_used_count` (read-only, appears in `get_gear` but
  not in the write payload) presumably counts dive-log associations.

**Delete** — a distinct endpoint, not a soft-delete-via-update like the
dive log:
```
POST /app/a21.php?gear_id=<id>&what=delete_gear&token=<token>&ssiapp=...&version=...&lang=en&context=s
```
Empty POST body (`gear_id` travels as a query param, not in `json_data`).
Response is the account's **remaining** gear array (the deleted item is
simply absent — no `gear_deleted:1` marker was observed to persist
client-visibly, unlike the dive log's soft-delete pattern, though the
field still exists in the schema so the server may retain it internally).

**Equipment sets (`get_gearsets` / `save_gearset`):**
```
GET /app/a21.php?what=get_gearsets&token=<token>&ssiapp=...&version=...&lang=en&context=s
```
Named bundles of gear items (e.g. "Cold water kit"), a separate feature
from individual gear, reachable via the Gear screen's "Equipment sets" tab.
Returns `[]` when empty. Create/update both go through:
```
POST /app/a21.php?what=save_gearset&token=<token>&ssiapp=...&version=...&lang=en&context=s
json_data=<JSON-encoded gearset record>
```
```json
{
  "gearset_id": "",
  "gearset_mid": 5012047,
  "gearset_name": "RECON-SET-TEST",
  "gearset_description": "",
  "gearset_created": "2026-08-15 07:19:36.000",
  "gearset_updated": "2026-08-15 07:19:36.000",
  "gearset_deleted": false,
  "gear": [382015],
  "needsUpload": true
}
```
Same create convention as gear: `gearset_id: ""` (empty string) signals
create; response returns the server-assigned ID
(`"gearset_id":30431,...`). `gear` is a plain array of `gear_id`s — no
per-item metadata, just membership. **Delete has no dedicated endpoint** —
unlike `delete_gear`, it's a `save_gearset` call with the full record
resent and `gearset_deleted: true`:
```json
{ "gearset_id": 30431, "gearset_mid": 5012047, "gearset_name": "RECON-SET-TEST",
  "gearset_description": "", "gearset_created": "2026-08-15 14:19:38.000",
  "gearset_updated": "2026-08-15 14:19:38.000", "gearset_deleted": true,
  "gear": [382015], "needsUpload": true }
```
Response echoes back with `"gearset_deleted":1` and an updated
`gearset_updated` timestamp; the set then disappears from `get_gearsets`.

---

## Buddies & sites (`get_buddies` / `get_divesites_global`)

Two more dedicated endpoints beyond the `logbook_buddies`/`logbook_sites`
arrays embedded in `get_divelog` (see
[Appendix A](#appendix-a-get_divelog-response-shape-siblings-of-logbook_details)).
Whether these are simply duplicate/refresh sources for the same data or
back different app screens (e.g. a standalone "Buddies" contact list vs.
the dive-log's site/buddy picker) is unconfirmed, but they're real,
separately-invoked endpoints — worth knowing about even without a fully
mapped purpose.

**`get_buddies`:**
```
GET /app/a21.php?what=get_buddies&token=<token>&ssiapp=...&version=...&lang=en&context=s
```
```json
{
  "user_buddies": [
    {
      "id": 3718067, "master_id": 3368383, "buddy_master_id": 3368383,
      "firstname": "Tyler", "lastname": "McEowen", "forename": "Tyler",
      "dob": "1976-05-31", "favorite": 0,
      "email": "...", "phone": "...", "mobile_c": 12545980906, "phone_c": "",
      "address": "", "comment": "", "nickname": "",
      "city": "Belton", "country": "USA",
      "added": "2026-07-11 18:08:25",
      "image": "https://my.divessi.com/data/user_files/.../pic/3368383.png",
      "image_timestamp": 1652447331,
      "leader_nr": 104609, "leader_active": 1,
      "confirmed": 1, "deleted": 0
    }
  ]
}
```
Superset of `logbook_buddies` (adds `comment`, `nickname`, `added`,
`image_timestamp`; drops the dive-log-embedded `id ` naming quirk — same
person, same `id`/`master_id` values in both). No corresponding
`save_buddies`/create-buddy call was captured — adding a buddy wasn't
exercised during this session.

**`get_divesites_global`:**
```
GET /app/a21.php?what=get_divesites_global&last_sync=<unix_ts>&offset=0&limit=10000&ssiapp=...&version=...&lang=en&context=s
```
```json
{ "divesites_timestamp": "2026-08-12 17:26:42", "divesites": [] }
```
Distinct from `logbook_sites` (which is scoped to sites *you've* logged
dives at) — this looks like an incremental-sync feed of SSI's **global**
dive-site database, paginated via `offset`/`limit` and filtered by
`last_sync` (only sites added/changed after that timestamp come back).
Returned an empty `divesites` array in this capture because the client's
`last_sync` was already current — the response shape for a real payload
(what a site record looks like here, whether it matches
`logbook_sites`'s shape) is unconfirmed.

**This is *not* what backs the app's "Locations" browse/nearby UI,
despite the name.** Confirmed by MITM-watching a full visit to the
Locations tab (bottom nav → Locations → List view, showing a real,
distance-sorted list — "Crystal Lake, 26 km", "Shadow Cliffs Lake, 35
km", etc.): **zero requests to `api.divessi.com` fired.** The entire
browse/search-all-sites experience — names, distances computed from
device GPS — is served from a bundled offline database, downloaded (and
presumably periodically refreshed) as a flat, **unauthenticated** static
file — no `token` param, works with `curl`:
```
GET /app/APP_CACHE_SITES.zip
```
(sibling `APP_CACHE_GEAR.zip`/`APP_CACHE_CENTER.zip` bundles exist too,
same pattern, not yet inspected.) `get_divesites_global`'s
`last_sync`/`offset`/`limit` shape suggests it exists to keep this cache
incrementally fresh between full re-downloads, but no client code path
that calls it fired during normal Locations-tab usage in this session —
possibly cold-start-only.

The zip contains one file, `sites.json` (~2.5 MB compressed / ~19 MB
raw as of this capture — this is the **entire global SSI dive-site
database**, no auth or per-account scoping at all):
```json
{
  "created": "2026-08-15 12:40:04",
  "divesites_total": 36424,
  "divesites_locked_total": 24262,
  "divesites_deleted_total": 330118,
  "divesites": [ /* 24,304 entries */ ]
}
```
Every entry in the `divesites` array has `odin_dive_sites_geo_locked: 1`
— the array is the **locked** (verified/fixed-location) subset only;
the ~12k non-locked sites (`divesites_total - divesites_locked_total`,
presumably user-submitted/unverified locations) aren't included in this
bulk file, matching a "don't mass-expose unverified/private coordinates"
policy. `divesites_deleted_total` (330k, far exceeding the total) is
almost certainly a lifetime counter, not a current-deleted count. A
site record:
```json
{
  "odin_dive_sites_id": 20,
  "odin_dive_sites_name": "Überlingen - Seezeichen 24",
  "odin_countries_code_iso": "DEU",
  "odin_dive_sites_meta_address": "",
  "odin_dive_sites_meta_country": "",
  "odin_dive_sites_meta_region": "",
  "odin_dive_sites_lat": 47.7705,
  "odin_dive_sites_lon": 9.1377,
  "odin_dive_sites_geo_locked": 1,
  "odin_dive_sites_is_private": 0,
  "odin_dive_sites_deleted": 0,
  "odin_dive_sites_alias_ids": "",
  "odin_dive_sites_comment": "added from LOG DB | 2022-02-05: Made Public by: DC: 700786 | IP: 84.176.190.253 | ...",
  "timestamp": "2025-07-19 19:42:17",
  "iso2": "de",
  "odin_user_log_animal_ids": [22, 27, 255, 256, 260],
  "bow": "fresh",
  "current": { "no_current": 444, "light_current": 203, "strong_current": 18, "ripping_current": 5 },
  "alias_names_search": "Überlingen, bau graf Überlingen baumarkt",
  "alias_names": ["Überlingen, Bau Graf", "Überlingen Baumarkt"]
}
```
Superset of `logbook_sites`'s shape — adds `odin_user_log_animal_ids`
(wildlife commonly sighted at that site, same ID space as the dive
record field of the same name), `alias_names`/`alias_names_search`
(alternate names the site is known by, e.g. after a name change or
regional variants), and `odin_dive_sites_comment` (a raw, unredacted
moderation/audit log — includes submitter dive-computer IDs and **IP
addresses**; worth being aware this is shipped client-side in plaintext
to every app install). 145 countries represented; USA (2195), Spain
(1556), and Japan (1214) are the largest by site count in this capture.
`bow`/`current` are the same aggregate stats shape seen on
`logbook_sites` entries. `meta_country`/`meta_region`/`meta_address`
are frequently empty even when `odin_countries_code_iso` is populated —
don't rely on them being filled in.

**If you need this data:** fetch `APP_CACHE_SITES.zip` directly (no
auth needed) rather than trying to page through `get_divesites_global` —
it's the real, complete dataset and the endpoint that *sounds* like it
should serve it apparently isn't in the normal client's call path.

---

## Certification cards (`get_ccards`) & awards (`get_user_badges`)

Two more read-only endpoints, captured from the app's "More" grid → Cards
/ Awards tiles. Both are pure GETs, standard four fixed query params plus
`token`, no pagination.

**`get_ccards`:**
```
GET /app/a21.php?what=get_ccards&token=<token>&ssiapp=...&version=...&lang=en&context=s
```
```json
{
  "ccard_amount": 4,
  "ccard_list": [
    {
      "ccard_uid": "801486N7837897949306-US",
      "ccard_course_name": "Open Water Diver",
      "ccard_course_short": "OWD",
      "ccard_cat": "scubadiving",
      "ccard_cat_title": "course_cat_scubadiving",
      "ccard_course_id": 225,
      "ccard_dives": 4,
      "ccard_issue_date": "2026-07-12",
      "ccard_expire_date": null,
      "ccard_instructor_number": 104609,
      "ccard_instructor_name": "Tyler McEowen",
      "ccard_divecenter_number": 801486,
      "ccard_divecenter_name": "Scuba Divers Paradise",
      "ccard_divecenter_city": "Belton",
      "ccard_divecenter_country": "United States",
      "ccard_image_back": "https://my.divessi.com/cert/801486N7837897949306-US?t=1783982285",
      "ccard_image_front": "https://cdn.divessi.com/assets/cards/1000/OWD.jpg",
      "ccard_image_front_thumb": "https://cdn.divessi.com/assets/cards/200/OWD.jpg"
    }
  ],
  "cat_array": [
    "scubadiving", "extendedrange", "ccr", "freediving", "mermaid",
    "ecologyandreactright", "swim", "snorkeling", "publicsafetydiving",
    "ssirecognition", "scubadivingpro", "extendedrangepro", "ccrpro",
    "freedivingpro", "mermaidpro", "ecologyandreactrightpro", "swimpro",
    "snorkelingpro", "publicsafetydivingpro", "ssiprorecognition", "other"
  ]
}
```
One entry per certification the account holds — `ccard_uid` is the
same certification-ID format shown in the app UI and printed on physical
cards (`<facility>X<hash>-<country>`), and matches the URL segments used
by the legacy web client's `/cert/<uid>` path
([Appendix C](#appendix-c-legacy-web-form-client-my.divessi.com)).
`ccard_image_front`/`_back` point at a static card graphic (by course
code, not personalized) and a personalized verification page
(`my.divessi.com/cert/<uid>?t=<cache-bust-ts>`) respectively — the app's
detail view (tap a card) renders entirely from this one list response, no
follow-up request. `ccard_dives` is dive-count-toward-completion for that
course, not a live counter. `cat_array` is the fixed list of course
categories the app can group by; only `scubadiving` and `snorkeling` are
populated on this account.

**`get_user_badges`:**
```
GET /app/a21.php?what=get_user_badges&token=<token>&ssiapp=...&version=...&lang=en&context=s
```
Returns one object keyed by badge-group code, each a list of badge
records (empty arrays for groups the account has no badges in — e.g. this
account has none in `AWD`/`FRDLVL`/`FRDACT`/`FRDAWD`/`PROYEARS`/
`PROCERTS`/`PROAWD`):
```json
{
  "LVL": [ /* "Diver Level" badges — tiered, e.g. Level 1/2/3 */ ],
  "ACT": [ /* activity-count badges — total dives, max depth, ... */ ],
  "AWD": [], "FRDLVL": [], "FRDACT": [], "FRDAWD": [],
  "PROYEARS": [], "PROCERTS": [], "PROAWD": []
}
```
Each badge record:
```json
{
  "id": 4,
  "name": "Maximum Depth (DC Confirmation required)",
  "translation_key": "badge_ACT_MAXD",
  "description_translation_key": "badge_ACT_MAXD_description",
  "description_value": "11.2",
  "description_to_do": "",
  "description_to_do_translation_key": "",
  "description_to_do_value": "",
  "date": "2026-07-12",
  "owned": true,
  "confirmed": true,
  "image_owned": "https://cdn.divessi.com/assets/badges/2022/SSI_App_Badge_MD_1.png",
  "image_confirmed": "https://cdn.divessi.com/assets/badges/2022/SSI_App_Badge_MD_1.png",
  "image_teaser": "https://cdn.divessi.com/assets/badges/2022/SSI_App_Badge_MD_2.png",
  "value_m": "11.2 m",
  "value_i": "37 ft"
}
```
Notes:
- `owned`/`confirmed` can differ — `owned` tracks whether the underlying
  stat/achievement has been reached, `confirmed` whether it's backed by
  DC (dive-computer)-confirmed rather than self-reported dives; every
  badge name in this account's captures is suffixed "(DC Confirmation
  required)", suggesting unconfirmed dives don't count toward badges at
  all currently.
- Unearned badges (`owned: false`) still return a full record with
  `description_to_do`/`description_to_do_value` filled in (e.g. "Remaining
  dives/sessions needed to qualify: 5") and a placeholder `date` of
  `"2000-01-01"` — useful for a progress UI without a second request.
  `value_m`/`value_i` are empty strings until owned.
  `award_cup_url` (seen only on `LVL` entries) links to a shareable
  `my.divessi.com/award/<base64-ish token>` page; absent/empty when
  unowned.
- `LVL`/`ACT` vs. `FRDLVL`/`FRDACT` mirror the scuba/freediving split seen
  elsewhere in this API (dive record's `frd_*` field cluster,
  `logbook_stats`'s `dives_per_activity`); the `PRO*` groups are presumably
  for SSI Pro (instructor) accounts and empty for a regular diver.

---

## Other observed `what=` actions (unmapped)

Seen in traffic during normal app navigation (home screen, profile, gear)
but not individually inspected — listed here so a future session doesn't
have to rediscover them by re-capturing: `get_available_courses`,
`get_emergency_contacts`, `get_insurance`, `get_tables_21` (dive tables),
`get_translations`, `get_user_data` (account profile — name, address,
DOB, units preference, etc.), `get_videolist`, `get_wildlife_vars`
(species enum, ties to `odin_user_log_animal_ids`), `get_divelog_history`,
`getaffiliations`, `events`, `home` (dashboard feed/banners), `jobs`,
`news`, `sonar` (purpose unknown from name alone). All confirmed to exist
and return data (mostly `200` JSON) but not worth documenting blind —
capture and inspect each on demand if a use case needs it, same MITM
setup as above.

---

## CLI (`divelog_api_client.py`)

```
export SSI_EMAIL=you@example.com
export SSI_PASSWORD=...

python3 divelog_api_client.py list [--json]
python3 divelog_api_client.py get <dive_id> [-o dive.json]
python3 divelog_api_client.py push <dive.json> [--show-response]
python3 divelog_api_client.py update <dive_id> [--set k=v ...] [--set-file changes.json] [--show-response]
python3 divelog_api_client.py create [--account-dive-id <id>] [--set k=v ...] [--set-file dive.json] [--show-response]
```

- `list` prints a summary table (nr, ID, date, depth, duration, confirmed status, computer) sorted by dive number; `--json` prints the full raw `logbook_details` array instead.
- `--set k=v` — repeatable; `v` is JSON-parsed if possible (so `--set odin_user_log_rating=5` sends an int, not the string `"5"`), otherwise sent as a literal string.
- `--set-file` — a JSON file of `{field_name: value}`, merged with `--set` (​`--set` wins on conflicts since it's applied after).
- `create`'s `--account-dive-id` picks which existing dive to borrow the owner ID from; defaults to the most recently numbered dive. It does **not** borrow anything else from that dive.
- `--show-response` prints the full raw JSON response in addition to the summarized `"success"` block.
- Credentials: `--email`/`--password` flags, or `SSI_EMAIL`/`SSI_PASSWORD` env vars.

**Hand-edit round trip** (`get -o` + `push`): download a dive's full JSON
with `get <id> -o dive.json`, edit whatever fields you want directly in the
file, then `push dive.json` to send it back. `push` reads
`odin_user_log_id` from the file to know which dive it's targeting, and
sends the file's own values directly through `build_write_payload` — unlike
`update --set-file`, there's no separate fetch-and-merge step, so the file
is the single source of truth for what gets sent. This is distinct from
`update`, which always re-fetches the dive fresh and merges your
`--set`/`--set-file` overrides on top of *that*.

---

## MCP server (`ssi_mcp`)

A read/query + basic-write MCP server built on top of this API, for use
with an MCP-capable LLM client (e.g. Claude Desktop/Code). Implemented in
`ssi_mcp/` — see
`docs/superpowers/specs/2026-08-15-ssi-mcp-server-design.md` for the
phase 1 design and
`docs/superpowers/specs/2026-08-16-ssi-mcp-gear-tools-design.md` for the
phase 2 gear/equipment-set addition.

```bash
export SSI_EMAIL=you@example.com
export SSI_PASSWORD=...
python3 -m ssi_mcp
```

Runs as a stdio MCP server. Point your MCP client's config at
`python3 -m ssi_mcp` with those two env vars set. Exposes fifteen tools:
`list_dives`, `get_dive`, `list_buddies`, `list_sites` (read, enriched
with resolved site/buddy/weather names) and `update_dive`,
`batch_update_dives`, `add_buddy_to_dives` (write) from phase 1, plus
`list_gear`, `list_gearsets` (read, with equipment sets' member gear
resolved to names) and `create_gear`, `update_gear`, `delete_gear`,
`create_gearset`, `update_gearset`, `delete_gearset` (write) from phase
2. The auth token is cached in memory for the life of the server
process — no re-auth per tool call, and no token persisted to disk.
Buddy creation and dive creation are still not exposed (see the phase 1
design doc's "out of scope" section) — gear/equipment-set creation now
is.

Enum fields (`weather`, `current`, `surface`, `water_body`, `watertype`,
`tanktype`, `entry`, `divetype`, `specialdive`) are set/read by label
(e.g. `weather="cloudy"`), translated via `ssi_mcp/data/enum_values.json`
— extracted from the SSI Android app's own bundled id→label table (see
that file's home in `ssi_mcp/enums.py` for provenance).

---

## The dive record: full field reference

The tables below cover **all 342 keys** in the write schema
(`WRITE_SCHEMA_KEYS`), grouped by purpose. "Type" and "Example" are
inferred from live captured data (a real, richly-populated open-circuit
dive plus a computer-imported Shearwater dive) — not from any published
schema, so treat unconfirmed/never-observed fields (mostly the CCR/SCR/XR/
freediving groups, which are all `null` because this account has never
logged those gear types) as best-effort based on naming conventions alone.

Fields marked **write-only** have no equivalent in a `get_divelog` read
record at all — they're local-sync/offline bookkeeping in the real
Android app's local Drift database, sent because the fixed schema expects
them, but with no server-persisted meaning for a client with no local DB.

#### Identity & record bookkeeping

| Field | Type | Example | Notes |
|---|---|---|---|
| `internalPk` | null | `null` | mirrors `odin_user_log_nr` on write; local-sync artifact |
| `odin_user_log_id` | int | `27497631` | **create signal**: `null` → INSERT, real ID → UPDATE |
| `odin_user_log_nr` | int | `21` | sequential per-account dive number, 1-based |
| `odin_user_log_user_master_id` | int | `5012047` | account/owner ID |
| `odin_user_log_deleted` | int | `0` | `1` = soft-deleted |
| `reset_profile_divelog_number_with_deletion` | null | `null` | write-only, no read-side source |
| `odin_user_log_crdate` | null | `null` | write-only, no read-side source |
| `timestamp` | string | `"2026-08-13 14:06:19"` | last-write timestamp |

#### Date, time & duration

| Field | Type | Example | Notes |
|---|---|---|---|
| `odin_user_log_datetime` | string | `"2026-08-09 15:28"` | `YYYY-MM-DD HH:MM`, **no seconds** |
| `odin_user_log_date` | string | `"2026-08-09"` | |
| `odin_user_log_entry_time` | string | `"15:28"` | |
| `odin_user_log_divetime` | int | `38` | minutes |
| `odin_user_log_dive_type` | int | `0` | observed constant `0` across all captures; meaning unconfirmed |
| `odin_user_log_si_before` | int | `3080` | surface interval before this dive, minutes |

#### Depth

| Field | Type | Example | Notes |
|---|---|---|---|
| `odin_user_log_depth_m` | float | `9.6` | max depth |
| `odin_user_log_depth_ft` | float | `31.5` | |
| `odin_user_log_avg_depth_m` | float | `5.5` | |
| `odin_user_log_avg_depth_ft` | float | `18.2` | |

#### Site, buddies & social

| Field | Type | Example | Notes |
|---|---|---|---|
| `odin_user_log_dive_sites_id` | int | `22489` | FK into `logbook_sites` (Appendix A) |
| `localSiteId` | null | `null` | write-only, no read-side source |
| `odin_user_log_buddy_ids` | array | `[3606515]` | FKs into `logbook_buddies` (Appendix A) |
| `localBuddyIds` | null | `null` | write-only; default `[]` on create (see `CREATE_LIST_DEFAULTS`) |
| `odin_user_log_animal_ids` | array | `[121, 132, 130]` | species-sighting IDs (no local reference table captured) |
| `odin_user_log_leader_nr` | JSON string | `"0"` | instructor/leader license number, as a string |
| `odin_user_log_comment` | string | `""` | free text |
| `odin_user_log_rating` | int | `5` | 0–5 |

#### Conditions

Most of these are IDs into small enum tables the app ships locally (not
observed in any API response — no `GET /enums` equivalent was captured).
See [Appendix B](#appendix-b-enum-id-fields-var_id) for what's inferable.

| Field | Type | Example | Notes |
|---|---|---|---|
| `odin_user_log_var_divetype_id` | int | `24` | e.g. "fun dive", "education"... |
| `odin_user_log_var_water_body_id` | int | `16` | lake / ocean / quarry... |
| `odin_user_log_var_watertype_id` | int | `4` | fresh / salt |
| `odin_user_log_var_entry_id` | int | `21` | shore / boat entry |
| `odin_user_log_var_current_id` | int | `6` | current strength |
| `odin_user_log_var_surface_id` | int | `10` | surface conditions |
| `odin_user_log_var_weather_id` | int | `1` | |
| `odin_user_log_var_tanktype_id` | int | `20` | tank material/type |
| `odin_user_log_var_specialdive_id` | int | `25` | e.g. "computer", "boat"... |
| `odin_user_log_vis_m` | float | `1.5` | visibility |
| `odin_user_log_vis_ft` | int | `5` | |
| `odin_user_log_airtemp_c` | int | `36` | |
| `odin_user_log_airtemp_f` | int | `96` | |
| `odin_user_log_watertemp_c` | int | `30` | |
| `odin_user_log_watertemp_f` | int | `86` | |
| `odin_user_log_watertemp_max_c` | int | `33` | separate from `watertemp_c`; both min/max are tracked |
| `odin_user_log_watertemp_max_f` | int | `91` | |

#### Open-circuit gear & gas

| Field | Type | Example | Notes |
|---|---|---|---|
| `odin_user_log_weight_kg` | float | `0.9` | |
| `odin_user_log_weight_lb` | int | `2` | |
| `odin_user_log_tank_vol_l` | float | `11.1` | |
| `odin_user_log_tank_vol_cuft` | int | `80` | |
| `odin_user_log_ean` | int | `1` | `1` = nitrox, `0` = air |
| `odin_user_log_ean_percent` | int | `21` | **`0` when `ean=0`**, not `21` — only populated for actual enriched-air mixes |
| `odin_user_log_pressure_start_bar` | int | `189` | |
| `odin_user_log_pressure_start_psi` | int | `2736` | |
| `odin_user_log_pressure_end_bar` | int | `87` | |
| `odin_user_log_pressure_end_psi` | int | `1268` | |
| `odin_user_log_amv_l` | float | `20.8` | air consumption / SAC-adjacent metric, liters |
| `odin_user_log_amv_psi` | float | `0.92` | same, psi units — despite the name, this is a rate not a raw pressure |
| `odin_user_log_gear` | array | `[]` | default `[]` on create |
| `odin_user_log_gear_details` | string | `""` | free text |
| `odin_user_log_gearconfiguration_id` | int | `66` | FK to a server-side gear-configuration record created by the app's own "gear" flow — **cannot be meaningfully set by an external client**, since creating a real one requires a flow this API doesn't expose |

#### Verification / dive-shop confirmation

All of this is genuinely dive-shop-specific data (who checked you in, at
which facility) — **do not fabricate it** when creating dives from an
external source. See [Known gotchas](#known-gotchas--caveats).

| Field | Type | Example | Notes |
|---|---|---|---|
| `odin_user_log_confirmed` | bool | `true` | see caveat: not controllable via this API on create |
| `odin_user_log_verified` | bool | `true` | ditto |
| `odin_user_log_divecenter_confirmed` | int | `1` | `0`/`1` |
| `log_linked_facility_id` | int | `801486` | FK to the confirming dive shop |
| `odin_user_log_divecenter_confirmed_id` | int | `801486` | |
| `odin_user_log_divecenter_confirmed_name` | string | `"Scuba Divers Paradise, Belton"` | |
| `odin_user_log_divecenter_confirmed_logo` | null | `null` | never observed populated |
| `odin_user_log_leader_confirmed_id` | int | `104609` | instructor/leader who confirmed |
| `odin_user_log_leader_confirmed_name` | string | `"Tyler McEowen #104609"` | |
| `odin_user_log_user_confirmed_id` | int | `0` | |
| `odin_user_log_user_confirmed_name` | string | `""` | |
| `odin_user_log_transferDate` | string | `"0000-00-00"` | zero-date sentinel when unset, not `null` |

#### Deco / gradient factor / gas loading

| Field | Type | Example | Notes |
|---|---|---|---|
| `odin_user_log_gf_set` | string | `"50 / 85"` | `"LOW / HIGH"`, spaces around slash |
| `odin_user_log_gf_set_1` | int | `50` | GF low |
| `odin_user_log_gf_set_2` | int | `85` | GF high |
| `odin_user_log_gf_end` | float | `10.3` | end-of-dive GF |
| `odin_user_log_cns_start` | null | `null` | not populated on any captured dive |
| `odin_user_log_cns_end` | null | `null` | |
| `odin_user_log_otu_start` | null | `null` | |
| `odin_user_log_otu_end` | null | `null` | |
| `odin_user_log_alarm_fast_ascent` | int | `1` | count/flag of fast-ascent alarms during the dive |
| `odin_user_log_alarm_deco_stop` | int | `0` | |
| `odin_user_log_alarm_deco_violation` | int | `0` | |

#### Dive computer identity

| Field | Type | Example | Notes |
|---|---|---|---|
| `odin_user_log_diveComputer` | string | `""` | free-text computer description — **left blank** on real machine-imported dives; identity lives in the fields below instead |
| `odin_user_log_diveComputerData` | string | `""` | |
| `odin_user_log_divecomputer_dive_ref` | string | `"2026-08-09T15:28:04.000_0"` | ISO-ish per-dive reference, `_0` suffix constant so far |
| `odin_user_log_divecomputer_ref` | string | `"Teric"` | |
| `odin_user_log_divecomputer_imported` | int | `1` | `1` for any computer-synced dive |
| `odin_user_log_divecomputer_serial_nr` | string | `"4C579D0F"` | |
| `odin_user_log_divecomputer_ble_id` | string | `"63454DF3-..."` | Bluetooth ID; observed identical across dives from different computers on this account — likely the *phone's* BLE identity, not the dive computer's |
| `odin_user_log_divecomputer_id` | int | `64854` | server-assigned computer identity record |
| `odin_user_log_divecomputer_name` | string | `"Teric"` | |
| `odin_user_log_divecomputer_manufacturer` | string | `"Shearwater"` | |
| `odin_user_log_divecomputer_firmware` | JSON string | `"25"` | sent/read as a numeric-looking string |
| `odin_user_log_divecomputer_raw_data_header` | null | `null` | |
| `odin_user_log_divecomputer_raw_data_details` | null | `null` | |
| `odin_user_log_divecomputer_productname` | null | `null` | |
| `log_divecomputer_bottomtimer` | int | `1` | **server-computed**, not sent by any client — present read-side only in practice |
| `log_divecomputer_max_sensor_depth` | null | `null` | |

> Changing `odin_user_log_divecomputer_manufacturer` on an existing dive
> causes the server to create a **new** `log_divecomputer_archive_id`
> record rather than updating the old one, leaving the dive joined against
> two device rows (confirmed by an accidental live test — cosmetic only,
> shows as a "redundant dive number" warning in the app, no data loss). Set
> this correctly the first time rather than editing it later.

#### Profile datasets (per-sample time series)

All are JSON-encoded **strings** (not native JSON arrays) inside the outer
payload — you must `json.dumps()` the array/object before assigning it to
these keys. Array-shaped datasets are one entry per profile sample, same
ordering/length as `odin_user_log_diveSamples`.

| Field | Type | Example | Notes |
|---|---|---|---|
| `odin_user_log_diveSamples` | JSON string (array of objects) | — | the primary per-sample record; see [sub-schema](#odin_user_log_divesamples-sub-schema) |
| `odin_user_log_depthDataset` | JSON string (array of float) | `[0.67, 1.52, 2.8, ...]` | meters, one per sample |
| `odin_user_log_tempDataset` | JSON string (array of float) | `[32.8, 32.8, ...]` | °C |
| `odin_user_log_gfnowDataset` | JSON string (array of float) | `[0.0, 0.0, ...]` | GF Now % per sample |
| `odin_user_log_gfSurfDataset` | JSON string (array of float) | `[0.0, 0.0, ...]` | GF Surf % per sample |
| `odin_user_log_deepestDecoDataset` | string | `""` | never observed populated |
| `odin_user_log_tankPressureDataset` | JSON string (array of float, or empty) | `[188.64, ...]` | bar; empty string `""` when no tank-pressure sensor data |
| `odin_user_log_alarmDataset` | JSON string (array of objects) | `[{"deco": false, "speed": true, "position": 29, "violation": false, "fast_ascent": true}]` | one entry **per sample that has an alarm bit set** (sparse, not one-per-sample) — `position` is the 1-based sample number |
| `odin_user_log_pressureDataset` | null | `null` | distinct from `tankPressureDataset`; purpose/format unconfirmed, never observed populated |
| `odin_user_log_locationDataset` | null | `null` | never observed populated |

> **The app's chart widget (`mares_dive_charts`) only ever plots a fixed
> 5-line legend: Depth, Temp, GF Now, GF@Surf, NDL.** There is no
> tank-pressure trace in the UI regardless of whether `pressure` data is
> present in the samples — this is a rendering limitation, not a signal
> that the data is wrong or unnecessary to send.

#### Freediving

All `null` in every capture on this account (no freediving sessions
logged) — field names strongly suggest their purpose but none are
confirmed against a real populated example. One cluster of `frddisc_*`
fields exists per AIDA/CMAS freediving discipline (Static Apnea, Static
Apnea Table, Free Immersion, Constant Weight, No Fins, Free Recovery,
Dynamic, Dynamic No Fins, Variable Weight, Dynamic w/ fins Table); `_WU` =
warm-up, `_MAX_*` = personal best, `_TIME`/`_CT` = duration, `_RP` =
recovery/repetitions.

| Field | Type | Notes |
|---|---|---|
| `odin_user_log_frd_suit` | null | **read-side name is `x_odin_user_log_frd_suit`** (stray `x_` prefix on read) |
| `odin_user_log_frd_weight_kg` | null | |
| `odin_user_log_frd_weight_lb` | null | |
| `odin_user_log_frd_neutral_m` | null | neutral buoyancy depth |
| `odin_user_log_frd_neutral_ft` | null | |
| `odin_user_log_frd_divetype_id` | null | |
| `odin_user_log_frdwater_body_id` | null | **read-side name is `x_odin_user_log_frdwater_body_id`** |
| `odin_user_log_frddisc_STA` | null | Static Apnea |
| `odin_user_log_frddisc_STA_WU` | null | |
| `odin_user_log_frddisc_STA_MAX` | null | |
| `odin_user_log_frddisc_STA_CT` | null | |
| `odin_user_log_frddisc_STATT` | null | Static Apnea Table |
| `odin_user_log_frddisc_STATT_RP` | null | |
| `odin_user_log_frddisc_STATT_MAX` | null | |
| `odin_user_log_frddisc_WAPN` | null | (discipline abbreviation unconfirmed) |
| `odin_user_log_frddisc_WAPN_WU` | null | |
| `odin_user_log_frddisc_WAPN_RP` | null | |
| `odin_user_log_frddisc_WAPN_MAX` | null | |
| `odin_user_log_frddisc_DYN` | null | Dynamic Apnea |
| `odin_user_log_frddisc_DYN_WU` | null | |
| `odin_user_log_frddisc_DYN_MAX_m` | null | |
| `odin_user_log_frddisc_DYN_MAX_ft` | null | |
| `odin_user_log_frddisc_DYNTT` | null | Dynamic Table |
| `odin_user_log_frddisc_DYNTT_RP` | null | |
| `odin_user_log_frddisc_DYNTT_MAX_m` | null | |
| `odin_user_log_frddisc_DYNTT_MAX_ft` | null | |
| `odin_user_log_frddisc_FIM` | null | Free Immersion |
| `odin_user_log_frddisc_FIM_WU` | null | |
| `odin_user_log_frddisc_FIM_MAX_m` | null | |
| `odin_user_log_frddisc_FIM_MAX_ft` | null | |
| `odin_user_log_frddisc_FIM_TIME` | null | |
| `odin_user_log_frddisc_CWT` | null | Constant Weight |
| `odin_user_log_frddisc_CWT_WU` | null | |
| `odin_user_log_frddisc_CWT_MAX_m` | null | |
| `odin_user_log_frddisc_CWT_MAX_ft` | null | |
| `odin_user_log_frddisc_CWT_TIME` | null | |
| `odin_user_log_frddisc_CNF` | null | Constant No Fins |
| `odin_user_log_frddisc_CNF_WU` | null | |
| `odin_user_log_frddisc_CNF_MAX_m` | null | |
| `odin_user_log_frddisc_CNF_MAX_ft` | null | |
| `odin_user_log_frddisc_CNF_TIME` | null | |
| `odin_user_log_frddisc_VWT` | null | Variable Weight |
| `odin_user_log_frddisc_VWT_WU` | null | |
| `odin_user_log_frddisc_VWT_MAX_m` | null | |
| `odin_user_log_frddisc_VWT_MAX_ft` | null | |
| `odin_user_log_frddisc_VWT_TIME` | null | |
| `odin_user_log_frddisc_FRC` | null | Free Recovery |
| `odin_user_log_frddisc_FRC_RP` | null | |
| `odin_user_log_frddisc_FRC_MAX_m` | null | |
| `odin_user_log_frddisc_FRC_MAX_ft` | null | |
| `odin_user_log_frddisc_DNF` | null | Dynamic No Fins |
| `odin_user_log_frddisc_DNF_WU` | null | |
| `odin_user_log_frddisc_DNF_MAX_m` | null | |
| `odin_user_log_frddisc_DNF_MAX_ft` | null | |
| `odin_user_log_frd_NOTES` | null | |
| `odin_user_log_frddisc` | null | possibly a discipline selector; unconfirmed |

#### Sidemount / XR

All `null` in every capture (no sidemount/XR gear logged on this account).
"Back" = primary/back-mounted cylinder; "deco1/2/3" = up to 3 stage/deco
cylinders.

| Field | Type | Notes |
|---|---|---|
| `odin_user_log_xr_divetype_id` | null | |
| `odin_user_log_xr_planned_bottom_time` | null | |
| `odin_user_log_xr_total_deco_time` | null | |
| `odin_user_log_xr_back_tanktype_id` | null | |
| `odin_user_log_xr_deco_tanktype_id` | null | |
| `odin_user_log_xr_back_vol_l` | null | |
| `odin_user_log_xr_deco1_vol_l` | null | |
| `odin_user_log_xr_deco2_vol_l` | null | |
| `odin_user_log_xr_deco3_vol_l` | null | |
| `odin_user_log_xr_back_ean` | null | |
| `odin_user_log_xr_back_tmx` | null | trimix flag/label |
| `odin_user_log_xr_deco1_ean` | null | |
| `odin_user_log_xr_deco1_tmx` | null | |
| `odin_user_log_xr_deco2_ean` | null | |
| `odin_user_log_xr_deco2_tmx` | null | |
| `odin_user_log_xr_deco3_ean_o2` | null | deco3 uses `_ean_o2` instead of `_ean` — naming inconsistency observed in the schema itself |
| `odin_user_log_xr_back_start_bar` | null | |
| `odin_user_log_xr_back_end_bar` | null | |
| `odin_user_log_xr_deco1_start_bar` | null | |
| `odin_user_log_xr_deco1_end_bar` | null | |
| `odin_user_log_xr_deco2_start_bar` | null | |
| `odin_user_log_xr_deco2_end_bar` | null | |
| `odin_user_log_xr_deco3_start_bar` | null | |
| `odin_user_log_xr_deco3_end_bar` | null | |
| `odin_user_log_xr_sac_bottom_l` | null | |
| `odin_user_log_xr_sac_deco_l` | null | |
| `odin_user_log_xr_back` | null | flag/label for the back-gas cylinder config |
| `odin_user_log_xr_deco1` | null | |
| `odin_user_log_xr_deco2` | null | |
| `odin_user_log_xr_deco3` | null | |
| `odin_user_log_xr_deco1_tanktype_id` | null | |
| `odin_user_log_xr_deco2_tanktype_id` | null | |
| `odin_user_log_xr_deco3_tanktype_id` | null | |
| `odin_user_log_xr_planned_depth` | null | |
| `odin_user_log_xr_planned_deco_time` | null | |
| `odin_user_log_xr_back_o2` | null | |
| `odin_user_log_xr_back_he` | null | |
| `odin_user_log_xr_deco1_o2` | null | |
| `odin_user_log_xr_deco1_he` | null | |
| `odin_user_log_xr_deco2_o2` | null | |
| `odin_user_log_xr_deco2_he` | null | |
| `odin_user_log_xr_deco3_o2` | null | |
| `odin_user_log_xr_deco3_he` | null | |
| `odin_user_log_xr_back_vol_cuft` | null | |
| `odin_user_log_xr_back_start_psi` | null | |
| `odin_user_log_xr_back_end_psi` | null | |
| `odin_user_log_xr_deco1_vol_cuft` | null | |
| `odin_user_log_xr_deco1_start_psi` | null | |
| `odin_user_log_xr_deco1_end_psi` | null | |
| `odin_user_log_xr_deco2_vol_cuft` | null | |
| `odin_user_log_xr_deco2_start_psi` | null | |
| `odin_user_log_xr_deco2_end_psi` | null | |
| `odin_user_log_xr_deco3_vol_cuft` | null | |
| `odin_user_log_xr_deco3_start_psi` | null | |
| `odin_user_log_xr_deco3_end_psi` | null | |
| `odin_user_log_xr_sac_bottom_psi` | null | |
| `odin_user_log_xr_sac_deco_psi` | null | |

#### SCR (semi-closed rebreather)

All `null` in every capture. Bottom and deco gas each get their own
tank/gas/pressure cluster; setpoints are O2 setpoint fractions.

| Field | Type | Notes |
|---|---|---|
| `odin_user_log_scr_unit_id` | null | |
| `odin_user_log_scr_total_deco_time` | null | |
| `odin_user_log_scr_sac_bailout_l` | null | |
| `odin_user_log_scr_sac_deco_l` | null | |
| `odin_user_log_scr_bottom_tanktype_id` | null | |
| `odin_user_log_scr_bottom_tank_vol_l` | null | |
| `odin_user_log_scr_bottom_o2` | null | |
| `odin_user_log_scr_bottom_setpoint` | null | |
| `odin_user_log_scr_bottom_start_bar` | null | |
| `odin_user_log_scr_bottom_end_bar` | null | |
| `odin_user_log_scr_deco` | null | flag |
| `odin_user_log_scr_deco_tanktype_id` | null | |
| `odin_user_log_scr_deco_tank_vol_l` | null | |
| `odin_user_log_scr_deco_o2` | null | |
| `odin_user_log_scr_deco_setpoint` | null | |
| `odin_user_log_scr_deco_start_bar` | null | |
| `odin_user_log_scr_deco_end_bar` | null | |
| `odin_user_log_scr_sac_bailout_psi` | null | |
| `odin_user_log_scr_sac_deco_psi` | null | |
| `odin_user_log_scr_bottom_tank_vol_cuft` | null | |
| `odin_user_log_scr_bottom_start_psi` | null | |
| `odin_user_log_scr_bottom_end_psi` | null | |
| `odin_user_log_scr_deco_tank_vol_cuft` | null | |
| `odin_user_log_scr_deco_start_psi` | null | |
| `odin_user_log_scr_deco_end_psi` | null | |
| `odin_user_log_scr_start_time` | null | |
| `odin_user_log_scr_end_time` | null | |
| `odin_user_log_scr_oc` | null | open-circuit-bailout flag |

#### CCR (closed-circuit rebreather)

All `null` in every capture. `bailout01`/`02`/`03` are up to 3 bailout
cylinders; `diluent` and `o2` are the two CCR-specific gas loops.

| Field | Type | Notes |
|---|---|---|
| `odin_user_log_ccr_unit_id` | null | |
| `odin_user_log_ccr_total_deco_time` | null | |
| `odin_user_log_ccr_sac_bailout_l` | null | |
| `odin_user_log_ccr_sac_deco_l` | null | |
| `odin_user_log_ccr_bailout01` | null | flag |
| `odin_user_log_ccr_bailout01_tanktype_id` | null | |
| `odin_user_log_ccr_bailout01_tank_vol_l` | null | |
| `odin_user_log_ccr_bailout01_o2` | null | |
| `odin_user_log_ccr_bailout01_he` | null | |
| `odin_user_log_ccr_bailout01_start_bar` | null | |
| `odin_user_log_ccr_bailout01_end_bar` | null | |
| `odin_user_log_ccr_bailout02` | null | flag |
| `odin_user_log_ccr_bailout02_tanktype_id` | null | |
| `odin_user_log_ccr_bailout02_tank_vol_l` | null | |
| `odin_user_log_ccr_bailout02_o2` | null | |
| `odin_user_log_ccr_bailout02_he` | null | |
| `odin_user_log_ccr_bailout02_start_bar` | null | |
| `odin_user_log_ccr_bailout02_end_bar` | null | |
| `odin_user_log_ccr_bailout03` | null | flag |
| `odin_user_log_ccr_bailout03_tanktype_id` | null | |
| `odin_user_log_ccr_bailout03_tank_vol_l` | null | |
| `odin_user_log_ccr_bailout03_o2` | null | |
| `odin_user_log_ccr_bailout03_he` | null | |
| `odin_user_log_ccr_bailout03_start_bar` | null | |
| `odin_user_log_ccr_bailout03_end_bar` | null | |
| `odin_user_log_ccr_diluent_gas` | null | |
| `odin_user_log_ccr_diluent_tanktype_id` | null | |
| `odin_user_log_ccr_diluent_tank_vol_l` | null | |
| `odin_user_log_ccr_diluent_o2` | null | |
| `odin_user_log_ccr_diluent_he` | null | |
| `odin_user_log_ccr_diluent_start_bar` | null | |
| `odin_user_log_ccr_diluent_end_bar` | null | |
| `odin_user_log_ccr_sac_bailout_psi` | null | |
| `odin_user_log_ccr_sac_deco_psi` | null | |
| `odin_user_log_ccr_bottom_tank_vol_cuft` | null | |
| `odin_user_log_ccr_o2_start_psi` | null | |
| `odin_user_log_ccr_o2_end_psi` | null | |
| `odin_user_log_ccr_diluent_tank_vol_cuft` | null | |
| `odin_user_log_ccr_diluent_start_psi` | null | |
| `odin_user_log_ccr_diluent_end_psi` | null | |
| `odin_user_log_ccr_bailout01_tank_vol_cuft` | null | |
| `odin_user_log_ccr_bailout01_start_psi` | null | |
| `odin_user_log_ccr_bailout01_end_psi` | null | |
| `odin_user_log_ccr_bailout02_tank_vol_cuft` | null | |
| `odin_user_log_ccr_bailout02_start_psi` | null | |
| `odin_user_log_ccr_bailout02_end_psi` | null | |
| `odin_user_log_ccr_bailout03_tank_vol_cuft` | null | |
| `odin_user_log_ccr_bailout03_start_psi` | null | |
| `odin_user_log_ccr_bailout03_end_psi` | null | |
| `odin_user_log_ccr_o2_tanktype_id` | null | |
| `odin_user_log_ccr_o2_tank_vol_l` | null | |
| `odin_user_log_ccr_o2_tank_vol_cuft` | null | |
| `odin_user_log_ccr_o2_start_bar` | null | |
| `odin_user_log_ccr_o2_end_bar` | null | |

#### Deco gas (separate stage/deco cylinder, non-XR path)

All `null` in every capture — appears to be a simpler single-deco-cylinder
alternative to the XR deco1/2/3 fields above, for non-sidemount configs.

| Field | Type | Notes |
|---|---|---|
| `odin_user_log_deco_dive` | null | flag |
| `odin_user_log_deco_time` | null | |
| `odin_user_log_deco_gas` | null | |
| `odin_user_log_deco_gas_tanktype_id` | null | |
| `odin_user_log_deco_gas_tank_vol_l` | null | |
| `odin_user_log_deco_gas_o2` | null | |
| `odin_user_log_deco_gas_start_bar` | null | |
| `odin_user_log_deco_gas_end_bar` | null | |
| `odin_user_log_deco_gas_tank_vol_cuft` | null | |
| `odin_user_log_deco_gas_start_psi` | null | |
| `odin_user_log_deco_gas_end_psi` | null | |

#### Apple Watch / housing / GPS / biometrics

| Field | Type | Example | Notes |
|---|---|---|---|
| `odin_user_log_apple_watch` | int | `0` | flag |
| `odin_user_log_apple_watch_log_id` | int | (= `odin_user_log_id`) | |
| `odin_user_log_apple_watch_id` | int | `0` | |
| `odin_user_log_apple_watch_app_version` | null | | |
| `odin_user_log_apple_watch_os_version` | null | | |
| `odin_user_log_housing_local_dive_media` | JSON string (array) | photo/video attachment records with local device `saveLocation` paths | |
| `odin_user_log_heartRateMin` | null | | Apple Watch integration, unused on this account |
| `odin_user_log_heartRateMax` | null | | |
| `odin_user_log_heartRateAvg` | null | | |
| `odin_user_log_heartRateDataset` | null | | |
| `odin_user_log_batteryLevelDataset` | null | | |
| `odin_user_log_batteryLevelStart` | null | | |
| `odin_user_log_batteryLevelEnd` | null | | |
| `odin_user_log_accelerationDataset` | null | | |
| `odin_user_log_gyroDataset` | null | | |
| `odin_user_log_pos_start_latitude` | null | | GPS, distinct from the dive *site's* fixed lat/lon in `logbook_sites` |
| `odin_user_log_pos_start_longitude` | null | | |
| `odin_user_log_pos_end_latitude` | null | | |
| `odin_user_log_pos_end_longitude` | null | | |
| `odin_user_log_dive_on_own_risk` | int | `0` | |
| `odin_user_log_dive_on_own_risk_os_app` | null | | |
| `odin_user_log_freeDiveSessionCharts` | string | `""` | |

#### Local-sync bookkeeping (write-only)

No read-side value exists for these — they're Drift-local (offline sync
queue) state in the real Android app. Send the `WRITE_ONLY_DEFAULTS`
values shown; there's no reason for an external client to do anything
else.

| Field | Default sent |
|---|---|
| `needsUpload` | `false` |
| `needsVerificationUpload` | `false` |
| `needsUnverifyUpload` | `false` |
| `uploadError` | `null` |

#### Miscellaneous

| Field | Type | Example | Notes |
|---|---|---|---|
| `log_linked_brevet_rule_id` | int | `225` | purpose unconfirmed |
| `log_extended_data_cleanup_weight_kg` | null | | never observed populated |
| `log_extended_data_cleanup_weight_lb` | null | | never observed populated |

---

## `odin_user_log_diveSamples` sub-schema

Each element of the `odin_user_log_diveSamples` array (before
JSON-string-encoding the whole array for the wire) is one dive-computer
reading:

```json
{
  "n": 1, "t": 5000, "d": 1.7, "s": 0.0, "te": 30.2,
  "ndl": 99, "gs": 0.0, "gn": 0.0, "a": 0, "mf": 134217728,
  "o": false, "dr": false, "rv": 3.0,
  "pressure": 188.64
}
```

| Key | Meaning | Notes |
|---|---|---|
| `n` | sample number | 1-based |
| `t` | milliseconds since dive start | fixed 5000ms/5s intervals observed |
| `d` | depth, meters | `0.0` at surface |
| `s` | ascent/descent speed, m/min | negative = descending |
| `te` | water temperature, °C | may be `null` |
| `ndl` | no-decompression limit, minutes | capped at `99`; `0` = deco obligation exceeded |
| `gs` | GF Surf % | theoretical gradient factor if surfacing instantly |
| `gn` | GF Now % | stays `0` underwater, rises near the surface |
| `a` | alarm bitmask | see table below |
| `mf` | dive-phase bitmask | see table below |
| `o` | obligation flag | not observed to activate on recreational GF profiles |
| `dr` | deco-required flag | derived from `firstStopDepth`/deco-stop depth being nonzero, **not** from ascent/TTS time (a common bug — TTS is nonzero for the whole dive even with no deco owed) |
| `rv` | constant `3.0` | meaning undetermined; appears required by the app's `DiveSample` deserializer (`package:mares_dive_charts`) — omitting it has correlated with the detail-page chart hanging indefinitely |
| `pressure` | tank pressure, bar | **key omitted entirely** (not `null`) when no cylinder/AI data is available |

**Type fidelity matters.** The app's Dart JSON deserialization is strictly
typed — sending an int (`0`) where a float (`0.0`) or bool (`false`) is
expected can throw at parse time client-side, silently breaking the
logbook list for that dive. Always send `gs`/`gn`/`s` as floats and
`dr`/`o` as real JSON booleans, never bare `0`/`1`.

#### `mf` (dive-phase) bitmask

| Bit value | Flag | Behavior observed |
|---|---|---|
| `0x08000000` | `DIVE` | on for the entire dive |
| `0x00010000` | `AT_DEPTH` | on ~8.5m descent → off ~6m ascent |
| `0x00020000` | `SAFETY_STOP` | on ~6m ascent, active ~3 min — this appears to be a deliberate timed hold the computer flags explicitly, **not** just time-at-shallow-depth; a real captured dive spent most of its profile in the 1–6m band without ever setting this bit |
| `0x04000000` | `SURFACED` | on at ≤1.0m depth |

#### `a` (alarm) bitmask

| Bit value | Flag | Notes |
|---|---|---|
| `0x000002` | `ASCENT_ADVISORY` | moderate ascent rate, ~≥5 m/min (calibrated against one real dive — approximate) |
| `0x000004` | `ASCENT_WARNING` | fast ascent rate, ~≥6 m/min; often combined with advisory (`0x6`) |
| `0x040000` | `NDL_WARNING` | NDL dropped critically low |

Both bitmask tables are independently confirmed against
[`agrippa1994/divessi-log-importer`](https://github.com/agrippa1994/divessi-log-importer)'s
`DiveSample` TypeScript type, which decodes the same values.

---

## Known gotchas & caveats

- **`odin_user_log_confirmed`/`odin_user_log_verified` are not controllable
  via this API on create.** Every real dive on this account (even plain
  computer-synced ones with no dive-shop check-in) reads `confirmed: true,
  verified: true`, but sending `true` explicitly in a create payload has
  been tested live and reads back `false` — the server appears to derive
  these from real dive-shop facility linkage
  (`log_linked_facility_id`/`divecenter_confirmed*`), not the literal
  field. **This is a known, accepted risk**: dives created via this API
  stay unconfirmed, and tapping an unconfirmed dive in the SSI mobile app
  (at least v4.1.272) has reliably broken the logbook list (blank screen,
  no crash, client-side rendering bug) in live testing. No workaround is
  known; this would need to be reported to SSI as an app bug. Filling in
  site/buddies/rating/etc. manually through the app's own edit wizard
  after an API-create has *not* been confirmed to fix the confirmed-status
  issue.
- **Never borrow a "template" dive's own fields wholesale for a create.**
  `build_write_payload` (designed for updates) copies *everything* from the
  source record forward. Reusing it for create — even with a real dive as
  the "template" — leaks that dive's site, buddies, rating, tank size, air
  temp, and dive-shop verification into the new record. Use
  `build_create_payload`, which only carries forward the account owner ID.
- **Imperial vs. metric on Shearwater native XML exports**: when
  `<imperialUnits>true</imperialUnits>`, `<currentDepth>` is feet,
  `<waterTemp>` is Fahrenheit, and tank pressures (tagged `*PSI` regardless
  of the unit setting) are PSI — cross-checked against a UDDF export of the
  same dive (always SI) to confirm the conversion. The metric
  (`imperialUnits=false`) path is unverified against a real metric export.
- **`odin_user_log_datetime`/`entry_time` have no seconds**:
  `"YYYY-MM-DD HH:MM"` / `"HH:MM"`, confirmed against a real
  `save_divelog` capture (an earlier guess assumed `HH:MM:SS`).
- **Changing `odin_user_log_divecomputer_manufacturer` on an existing dive
  spawns a second device-archive row** (`log_divecomputer_archive_id`)
  rather than updating the original — the dive itself stays one record, but
  the app may show a "redundant dive number" warning. Set the manufacturer
  correctly at create time.
- **Two read/write field-name aliases** (`READ_TO_WRITE_ALIASES`): the read
  response prefixes two freediving fields with a stray `x_` that the write
  schema doesn't expect: `x_odin_user_log_frd_suit` →
  `odin_user_log_frd_suit`, `x_odin_user_log_frdwater_body_id` →
  `odin_user_log_frdwater_body_id`.
- **The app's chart widget has a fixed 5-line legend** (Depth, Temp, GF
  Now, GF@Surf, NDL) regardless of what profile data you send — there is no
  tank-pressure trace in the UI even when `pressure` is present on every
  sample. Don't treat a missing pressure chart as a sign your data is
  malformed.
- **`log_divecomputer_bottomtimer`/`log_divecomputer_max_sensor_depth`
  use a `log_` prefix, not `odin_user_log_`** — this was cross-checked
  against `divessi-log-importer`'s independently reverse-engineered schema,
  which guessed `odin_user_log_divecomputer_bottomtimer` instead; the
  `log_`-prefixed names are the ones actually observed in a live captured
  request/response and are what this client uses.
- **342 keys must all be present**, nulled out for anything inapplicable
  to the dive's gear type (OC/CCR/SCR/XR/freediving) — this matches
  observed real-app POSTs. Omitting keys entirely is untested and may not
  be tolerated.

---

## Appendix A: `get_divelog` response shape (siblings of `logbook_details`)

**`logbook_sites[]`** — one entry per dive site the account has logged:

```json
{
  "odin_dive_sites_id": 22489,
  "odin_dive_sites_country_iso3": "USA",
  "odin_dive_sites_region_id": 51,
  "odin_dive_sites_area_id": 7411,
  "odin_dive_sites_name": "Stillhouse Pavillion Buoy",
  "odin_dive_sites_meta_country": "United States",
  "odin_dive_sites_meta_region": "Texas",
  "odin_dive_sites_meta_address": "9398 Union Grove Ln, Salado, TX 76571, USA",
  "odin_dive_sites_lat": 31.0186,
  "odin_dive_sites_lon": -97.5876,
  "odin_countries_code_iso": "US",
  "odin_dive_sites_is_private": 0,
  "odin_dive_sites_deleted": 0,
  "current": { "no_current": 300, "light_current": 101, "strong_current": 4, "ripping_current": null },
  "myloggedDives": 7,
  "myAverageMaxDepth": 10,
  "myAverageRating": 0,
  "myAverageDivetime": 45,
  "bow": "fresh"
}
```

**`logbook_buddies[]`** — one entry per buddy/contact:

```json
{
  "id": 3718067,
  "master_id": 3368383,
  "buddy_master_id": 3368383,
  "firstname": "Tyler", "lastname": "McEowen", "forename": "Tyler",
  "dob": "1976-05-31",
  "email": "...", "phone": "...", "mobile_c": 12545980906,
  "city": "Belton", "country": "USA",
  "image": "https://my.divessi.com/data/user_files/.../pic/3368383.png",
  "leader_nr": 104609, "leader_active": 1,
  "confirmed": 1, "deleted": 0, "favorite": 0
}
```

**`logbook_stats`** — account-wide aggregates: `myLoggedDives`,
`myAverageMaxDepth[Ft]`, `myMaxDepth[Ft]`, `totalDepth[Ft]`,
`myAverageDivetime`, `totalDiveTime`, `min/maxDiveTime`, `myAverageRating`,
`myAverageVis`, water/air temp min/avg/max (C and F), weight min/avg/max,
`myVisitedSites`, `myNitroxDives`, `myAverageNitroxMix`, `myRatedDives`,
AMV stats, and breakdowns (`dives_per_year_month`, `dives_per_activity`,
`dives_per_var.{current,entry,divetype,specialdive,surface,tanktype,...}`)
keyed by the same enum categories as the `var_*_id` dive fields.

**`logbook_history`** — just `{"history_confirmed": 0}` in every capture;
purpose unconfirmed.

---

## Appendix B: enum ID fields (`var_*_id`)

The `odin_user_log_var_*_id` fields (divetype, water_body, watertype,
entry, current, surface, weather, tanktype, specialdive) are foreign keys
into small lookup tables the app ships locally/bundled — no
`get_divelog`-adjacent endpoint returning the ID→label mapping was ever
captured. `logbook_stats.dives_per_var` groups by the *same* categories
using human-readable keys (e.g. `"current": {"no_current": 3,
"light_current": 2}`, `"entry": {"shore": 6, "boat": 1}`,
`"divetype": {"education": 1, "fun": 8}`), which is the only
partial ID↔label correspondence available from this API. If you need the
full enum tables, the Android APK (`SSI_4.1.272-ssi_APKPure.xapk` in this
repo) likely bundles them as static resources — not yet extracted.

---

## Appendix C: legacy web-form client (my.divessi.com)

An older, separate interface — the server-rendered `my.divessi.com` dive
log — is also usable, implemented in
[`divelog_client.py`](../divelog_client.py). Prefer the JSON API above for
new work; this is documented for completeness / as a fallback if the app
API ever changes.

- **No JSON, no partial update.** The "edit dive" page is a 3-step wizard
  (basics/site/conditions in the main page; a gear/tank/deco/freediving
  fragment; a wildlife fragment) whose *entire combined field set* must be
  POSTed back to `/code/process/mydivelog_18.php` to change anything.
- **Auth is a raw session cookie**, not a token — no login flow was ever
  captured for this interface, so you must extract `Cookie:` manually from
  an authenticated browser session (`SSI_COOKIE` env var / `--cookie`
  flag).
- **No create-dive flow was ever captured** for this interface either —
  `/mydivelog/add` exists (linked from the logbook page) but no request to
  it appears in the HAR this was reverse-engineered from. Only
  `get`/`update` are implemented.
- Multi-value fields use `name[]` form-encoding (buddies, etc.), handled by
  `requests`' native support for `dict`-of-list `data=`.
- Sending blank fields for gear configs the dive didn't use (CCR,
  sidemount, freediving) alongside the real config's data has matched
  observed server behavior for standard open-circuit dives — the real
  site's JS omits those fields from the POST entirely instead, which is
  untested here.

```bash
export SSI_COOKIE="..."   # from browser devtools, Cookie header
python3 divelog_client.py get 7_26647462_5012047     # dive_nr_logid_usermasterid
python3 divelog_client.py update 7_26647462_5012047 --set odin_user_log_rating=5
```
