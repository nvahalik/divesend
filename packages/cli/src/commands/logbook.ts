// `divesend list|get|push|create|update` -- the SSI logbook client commands,
// a port of `divelog_api_client.py`'s `cmd_list` / `cmd_get` / `cmd_push` /
// `cmd_create` / `cmd_update`.
//
// Credentials come from `--email` / `--password`, else `SSI_EMAIL` /
// `SSI_PASSWORD` in the environment (same as the Python), else the stored-auth
// file written by `divesend login` (`~/.config/divesend/auth.json`, see
// `../auth.ts`). No token is persisted -- every invocation authenticates fresh.

import { readFile } from 'node:fs/promises';
import { buildCreatePayload, buildWritePayload } from '@divesend/core';
import { fail, writeOutput } from '../io.js';
import { loadAuth } from '../auth.js';
import {
  authenticate,
  getDivelog,
  findDive,
  saveDive,
  type Divelog,
  type DiveRecord,
} from '../ssi/client.js';

export interface LogbookOptions {
  email?: string;
  password?: string;
  json?: boolean;
  field?: string;
  output?: string;
  set?: string[];
  fromFile?: string;
  accountDiveId?: string;
  showResponse?: boolean;
}

/**
 * Resolve SSI credentials (flags, then SSI_EMAIL / SSI_PASSWORD, then the file
 * written by `divesend login`; first non-empty wins) and exchange them for a
 * session token. Throws if either half is missing or the login is rejected.
 */
async function resolveAuth(options: LogbookOptions): Promise<string> {
  const stored = loadAuth();
  const email = options.email ?? process.env.SSI_EMAIL ?? stored?.email;
  const password = options.password ?? process.env.SSI_PASSWORD ?? stored?.password;
  if (!email || !password) {
    fail(
      'Not logged in. Run `divesend login`, set SSI_EMAIL and SSI_PASSWORD, or pass --email and --password.',
    );
  }
  return authenticate(email, password);
}

/** `divesend list` -- print every dive in the logbook. */
export async function list(options: LogbookOptions = {}): Promise<void> {
  await cmdList(await resolveAuth(options), options);
}

/** `divesend get <id>` -- dump one dive as JSON, or a single field with --field. */
export async function get(id: string | undefined, options: LogbookOptions = {}): Promise<void> {
  await cmdGet(await resolveAuth(options), options, id);
}

/** `divesend push <file.json>` -- send an edited save_divelog payload. */
export async function push(
  file: string | undefined,
  options: LogbookOptions = {},
): Promise<void> {
  await cmdPush(await resolveAuth(options), options, file);
}

/** `divesend create` -- create a dive from --set / --from-file overrides. */
export async function create(options: LogbookOptions = {}): Promise<void> {
  await cmdCreate(await resolveAuth(options), options);
}

/** `divesend update <id>` -- merge --set / --from-file overrides into a dive. */
export async function update(
  id: string | undefined,
  options: LogbookOptions = {},
): Promise<void> {
  await cmdUpdate(await resolveAuth(options), options, id);
}

// --- Python format-spec helpers -------------------------------------------------

/** Python `str()` for the values that reach `cmd_list` (None/bool/other). */
function pyStr(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  return String(value);
}

/** Emulate Python's `f"{value:<width}"` / `f"{value:>width}"`. No truncation. */
function pad(value: unknown, align: '<' | '>', width: number): string {
  const s = typeof value === 'string' ? value : String(value);
  if (s.length >= width) return s;
  const fill = ' '.repeat(width - s.length);
  return align === '>' ? fill + s : s + fill;
}

// --- commands -----------------------------------------------------------------

async function cmdList(token: string, v: LogbookOptions): Promise<void> {
  const divelog = await getDivelog(token);
  const dives = [...divelog.logbook_details].sort(
    (a, b) => (a.odin_user_log_nr as number) - (b.odin_user_log_nr as number),
  );

  if (v.json) {
    process.stdout.write(JSON.stringify(dives, null, 2) + '\n');
    return;
  }

  const header =
    pad('nr', '>', 3) +
    '  ' +
    pad('odin_user_log_id', '>', 16) +
    '  ' +
    pad('date', '<', 16) +
    '  ' +
    pad('depth_m', '>', 7) +
    '  ' +
    pad('min', '>', 4) +
    '  ' +
    pad('confirmed', '<', 9) +
    '  ' +
    pad('computer', '<', 20);

  const lines = [header, '-'.repeat(header.length)];
  for (const d of dives) {
    const manufacturer = (d.odin_user_log_divecomputer_manufacturer as string) || '';
    const name = (d.odin_user_log_divecomputer_name as string) || '';
    lines.push(
      pad(d.odin_user_log_nr, '>', 3) +
        '  ' +
        pad(d.odin_user_log_id, '>', 16) +
        '  ' +
        pad(d.odin_user_log_datetime ?? '', '<', 16) +
        '  ' +
        pad(d.odin_user_log_depth_m ?? '', '>', 7) +
        '  ' +
        pad(d.odin_user_log_divetime ?? '', '>', 4) +
        '  ' +
        pad(pyStr(d.odin_user_log_confirmed ?? null), '<', 9) +
        '  ' +
        `${manufacturer} ${name}`,
    );
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function requireDiveId(raw: string | undefined, cmd: string): number {
  const id = Number(raw);
  if (!raw || Number.isNaN(id)) {
    fail(`\`divesend ${cmd}\` needs a numeric dive <id>.`);
  }
  return id;
}

async function cmdGet(token: string, v: LogbookOptions, id?: string): Promise<void> {
  const diveId = requireDiveId(id, 'get');
  const divelog = await getDivelog(token);
  const dive = findDive(divelog, diveId) as Record<string, unknown>;

  if (v.field !== undefined) {
    if (!Object.hasOwn(dive, v.field)) {
      fail(`Dive ${diveId} has no field "${v.field}".`);
    }
    const val = dive[v.field];
    const text =
      val !== null && typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
    process.stdout.write(text + '\n');
    return;
  }

  writeOutput(JSON.stringify(dive, null, 2), v.output);
}

/** `result.get("success", result)` + optional full-response dump. */
function printResult(result: Record<string, unknown>, showResponse?: boolean): void {
  const summary = 'success' in result ? result.success : result;
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  if (showResponse) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
}

async function cmdPush(token: string, v: LogbookOptions, file?: string): Promise<void> {
  if (!file) {
    fail('`divesend push` needs a <file.json> holding a save_divelog payload.');
  }
  const edited = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  if (!edited.odin_user_log_id) {
    fail(`${file} has no odin_user_log_id, so there is no way to tell which dive to update.`);
  }
  const payload = buildWritePayload(edited, {});
  const result = await saveDive(token, payload);
  printResult(result, v.showResponse);
}

/**
 * `--from-file f.json` (an object of {field: value}) merged first, then each
 * repeatable `--set K=V` on top. Values are best-effort JSON-parsed so numeric
 * / boolean overrides don't get sent as strings; a parse failure keeps the raw
 * string (matching `json.loads(...)` with an `except JSONDecodeError: pass`).
 */
async function collectOverrides(v: LogbookOptions): Promise<Record<string, unknown>> {
  const overrides: Record<string, unknown> = {};
  if (v.fromFile) {
    Object.assign(
      overrides,
      JSON.parse(await readFile(v.fromFile, 'utf8')) as Record<string, unknown>,
    );
  }
  for (const kv of v.set ?? []) {
    const eq = kv.indexOf('=');
    if (eq === -1) {
      fail(`--set expects name=value, but got ${JSON.stringify(kv)}.`);
    }
    const key = kv.slice(0, eq);
    const raw = kv.slice(eq + 1);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    overrides[key] = value;
  }
  return overrides;
}

function mostRecent(dives: DiveRecord[]): DiveRecord {
  return dives.reduce((a, b) =>
    (b.odin_user_log_nr as number) > (a.odin_user_log_nr as number) ? b : a,
  );
}

async function cmdCreate(token: string, v: LogbookOptions): Promise<void> {
  const divelog: Divelog = await getDivelog(token);
  const dives = divelog.logbook_details;
  if (dives.length === 0) {
    fail('This account has no dives, so there is no record to derive the account and next number from.');
  }

  const accountRecord = v.accountDiveId
    ? findDive(divelog, Number(v.accountDiveId))
    : mostRecent(dives);
  const nextNr = Math.max(...dives.map((d) => d.odin_user_log_nr as number)) + 1;

  const overrides = await collectOverrides(v);
  if (Object.keys(overrides).length === 0) {
    fail('Nothing to create. Pass --set name=value and/or --from-file dive.json.');
  }

  const payload = buildCreatePayload(accountRecord, overrides, nextNr);
  const result = await saveDive(token, payload);
  printResult(result, v.showResponse);
}

async function cmdUpdate(token: string, v: LogbookOptions, id?: string): Promise<void> {
  const diveId = requireDiveId(id, 'update');
  const divelog = await getDivelog(token);
  const dive = findDive(divelog, diveId) as Record<string, unknown>;

  const overrides = await collectOverrides(v);
  if (Object.keys(overrides).length === 0) {
    fail('Nothing to update. Pass --set name=value and/or --from-file changes.json.');
  }

  const payload = buildWritePayload(dive, overrides);
  const result = await saveDive(token, payload);
  printResult(result, v.showResponse);
}
