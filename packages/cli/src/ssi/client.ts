// Direct client for SSI's app API (api.divessi.com/app/a21.php) -- a port of
// `divelog_api_client.py`'s HTTP layer. This talks straight to SSI with the
// Node global `fetch`; it is NOT the Cloudflare Worker proxy that
// `app/src/ssi/ssiClient.ts` uses (different codebase, different transport).
//
// Endpoint shape, all via a21.php with a `what=` query param selecting the
// action:
//   - what=authenticate  (GET,  l=email, p=password)          -> { authenticated, token }
//   - what=get_divelog   (GET,  token=...)                     -> full logbook dump
//   - what=save_divelog  (POST, token=..., json_data=<json>)   -> updated record
//   - what=get_gear / save_gear / delete_gear / get_gearsets / save_gearset
//
// Auth is token-based, passed as a query param on every call after
// authenticate. Tokens are not persisted here -- call `authenticate()` each run.

export const BASE_URL = 'https://api.divessi.com/app/a21.php';

// Identifies the client to the API the same way the Android app does. There is
// no indication the server rejects other values, but this is what is known to
// work. Ported verbatim from `divelog_api_client.py`'s APP_PARAMS.
export const APP_PARAMS: Record<string, string> = {
  ssiapp: '0815_ADR',
  version: 'ADR_4.1.272-ssi',
  lang: 'en',
  context: 's',
};

export interface DiveRecord {
  odin_user_log_id: number;
  odin_user_log_nr: number;
  [key: string]: unknown;
}

export interface Divelog {
  logbook_details: DiveRecord[];
  [key: string]: unknown;
}

/** `BASE_URL?<APP_PARAMS + params>`, mirroring requests' `params={**APP_PARAMS, ...}`. */
function buildUrl(params: Record<string, string>): string {
  const search = new URLSearchParams({ ...APP_PARAMS, ...params });
  return `${BASE_URL}?${search.toString()}`;
}

/** GET `<what>` (+ token / extras); throw the response text on a non-2xx. */
async function getJson(params: Record<string, string>): Promise<unknown> {
  const resp = await fetch(buildUrl(params));
  if (!resp.ok) {
    throw new Error(await resp.text());
  }
  return resp.json();
}

/**
 * POST `<what>` (+ token in the query). `body`, when given, is form-encoded
 * (`application/x-www-form-urlencoded`); when omitted the POST carries no body
 * (the `delete_gear` case, where `gear_id` rides the query string). Throws the
 * response text on a non-2xx.
 */
async function postJson(
  params: Record<string, string>,
  body?: Record<string, string>,
): Promise<unknown> {
  const init: RequestInit = { method: 'POST' };
  if (body) {
    init.body = new URLSearchParams(body).toString();
    init.headers = { 'content-type': 'application/x-www-form-urlencoded' };
  }
  const resp = await fetch(buildUrl(params), init);
  if (!resp.ok) {
    throw new Error(await resp.text());
  }
  return resp.json();
}

/** GET `?what=authenticate&l=<email>&p=<password>` -> token. */
export async function authenticate(email: string, password: string): Promise<string> {
  const data = (await getJson({ what: 'authenticate', l: email, p: password })) as Record<
    string,
    unknown
  >;
  if (!data.authenticated) {
    const detail = data.error_message ?? JSON.stringify(data);
    throw new Error(`Authentication failed: ${detail}`);
  }
  return data.token as string;
}

/** GET `?what=get_divelog&token=<token>` -> full logbook dump. */
export async function getDivelog(token: string): Promise<Divelog> {
  return (await getJson({ what: 'get_divelog', token })) as Divelog;
}

/** GET `?what=get_gear&token=<token>`. */
export async function getGear(token: string): Promise<unknown> {
  return getJson({ what: 'get_gear', token });
}

/**
 * POST `?what=save_gear&token=<token>`, body `json_data=<payload>`. Create vs
 * update is signalled inside the payload: `gear_id: ""` (empty string) creates,
 * a real id updates -- both resend the full record.
 */
export async function saveGear(token: string, payload: unknown): Promise<unknown> {
  return postJson({ what: 'save_gear', token }, { json_data: JSON.stringify(payload) });
}

/**
 * POST `?what=delete_gear&token=<token>&gear_id=<id>` with no body -- `gear_id`
 * travels as a query param here, not in the POST body. Returns the account's
 * remaining gear list.
 */
export async function deleteGear(token: string, gearId: number | string): Promise<unknown> {
  return postJson({ what: 'delete_gear', token, gear_id: String(gearId) });
}

/** GET `?what=get_gearsets&token=<token>`. */
export async function getGearsets(token: string): Promise<unknown> {
  return getJson({ what: 'get_gearsets', token });
}

/**
 * POST `?what=save_gearset&token=<token>`, body `json_data=<payload>`.
 * `gearset_id: ""` creates; there is no dedicated delete endpoint -- delete is a
 * save with `gearset_deleted: true` and the full record resent.
 */
export async function saveGearset(token: string, payload: unknown): Promise<unknown> {
  return postJson({ what: 'save_gearset', token }, { json_data: JSON.stringify(payload) });
}

/**
 * POST `?what=save_divelog&token=<token>`, body `token=<token>&json_data=<json>`.
 * `jsonData` is the already-serialized payload string.
 */
export async function saveDivelog(
  token: string,
  jsonData: string,
): Promise<Record<string, unknown>> {
  return (await postJson(
    { what: 'save_divelog', token },
    { token, json_data: jsonData },
  )) as Record<string, unknown>;
}

/** `saveDivelog` with the payload object serialized for you. */
export async function saveDive(
  token: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return saveDivelog(token, JSON.stringify(payload));
}

/** Find a dive in a `get_divelog` dump by its `odin_user_log_id`. */
export function findDive(divelog: Divelog, odinUserLogId: number): DiveRecord {
  for (const dive of divelog.logbook_details) {
    if (dive.odin_user_log_id === odinUserLogId) {
      return dive;
    }
  }
  throw new Error(
    `No dive with odin_user_log_id=${odinUserLogId} in this account's logbook`,
  );
}
