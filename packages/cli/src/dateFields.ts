// Deterministic SSI datetime fields from an offset-bearing ISO 8601 string.
//
// core's `payloadTransformer` (shared with `app/`) formats
// `odin_user_log_datetime` / `_date` / `_entry_time` with *local* `Date`
// getters and derives `_dive_ref` via `toISOString()` (UTC). That is correct
// for `app/` (its `startTime` is built from timezone-less device fields) but
// not for `convert`'s dc-xml -> ssi path, whose `startTime` carries the dive
// computer's own UTC offset — the CLI must emit the same bytes on any host
// timezone.
//
// This helper reproduces what `shearwater_transformers.to_ssi_payload`
// produces for the real fixture, computed purely from the wall-clock
// components + stated offset in the string (no host-local getters):
//   odin_user_log_datetime  -> "2026-07-28 12:26"
//   odin_user_log_date      -> "2026-07-28"
//   odin_user_log_entry_time-> "12:26"
//   odin_user_log_dive_ref  -> "2026-07-28T12:26:13.000-04:00_0"
//     (Python: `start_time.isoformat(timespec="milliseconds") + "_0"` — keeps
//      the offset; a "Z" input becomes "+00:00", matching Python's UTC form.)

export interface SsiDateFields {
  datetime: string;
  date: string;
  entry_time: string;
  dive_ref: string;
}

const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Turn a true-UTC ISO string (`"...Z"`) plus a UTC-offset in minutes into the
 * offset-bearing *local* ISO string `ssiDateFields` expects
 * (`YYYY-MM-DDTHH:MM:SS±HH:MM`) — so SSI stores the wall-clock the diver saw.
 *
 * `offsetMinutes === null` returns the input untouched: that is the
 * timezone-less case (a decoder whose `startTime` fields are already the local
 * wall-clock, merely labelled `Z`), where no shift is wanted.
 *
 * Uses epoch math and `getUTC*` getters only, so the result never depends on
 * the host timezone.
 */
export function localIsoFromUtc(utcIso: string, offsetMinutes: number | null): string {
  if (offsetMinutes === null) return utcIso;

  const shifted = new Date(new Date(utcIso).getTime() + offsetMinutes * 60_000);
  if (Number.isNaN(shifted.getTime())) return utcIso; // let ssiDateFields report the bad input

  const abs = Math.abs(offsetMinutes);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const p = (n: number): string => String(n).padStart(2, '0');
  const offset = `${sign}${p(Math.trunc(abs / 60))}:${p(abs % 60)}`;

  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
    `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}${offset}`
  );
}

export function ssiDateFields(isoWithOffset: string): SsiDateFields {
  const m = ISO_WITH_OFFSET.exec(isoWithOffset.trim());
  if (!m) {
    throw new Error(`ssiDateFields: expected an offset-bearing ISO 8601 string, got ${JSON.stringify(isoWithOffset)}`);
  }
  const [, y, mo, d, hh, mm, ss, rawOffset] = m;
  const offset = rawOffset === 'Z' ? '+00:00' : rawOffset;

  const date = `${y}-${mo}-${d}`;
  const entry_time = `${hh}:${mm}`;
  return {
    date,
    entry_time,
    datetime: `${date} ${entry_time}`,
    dive_ref: `${date}T${hh}:${mm}:${ss}.000${offset}_0`,
  };
}
