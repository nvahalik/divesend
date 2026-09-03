// worker/src/ssi/client.ts
// Server-side SSI API client -- mirrors app/src/ssi/ssiClient.ts's pre-existing logic, but
// calls api.divessi.com directly (a Worker isn't subject to browser CORS, so no dev-proxy
// rewrite is needed here, unlike the client-side version this supersedes).

const BASE_URL = 'https://api.divessi.com/app/a21.php';

const APP_PARAMS: Record<string, string> = {
  ssiapp: '0815_ADR',
  version: 'ADR_4.1.272-ssi',
  lang: 'en',
  context: 's',
};

function buildUrl(what: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ ...APP_PARAMS, what, ...extra });
  return `${BASE_URL}?${params.toString()}`;
}

export class SSIUpstreamError extends Error {
  status: number;
  constructor(status: number) {
    super(`SSI request failed: HTTP ${status}`);
    this.status = status;
  }
}

export class SSIAuthenticationError extends Error {}
export class SSIResponseShapeError extends Error {}

export async function ssiAuthenticate(email: string, password: string): Promise<string> {
  const res = await fetch(buildUrl('authenticate', { l: email, p: password }));
  if (!res.ok) throw new SSIUpstreamError(res.status);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.authenticated === true && typeof data.token === 'string') {
    return data.token;
  }
  const message = typeof data.error_message === 'string' ? data.error_message : 'Authentication failed';
  throw new SSIAuthenticationError(message);
}

export async function ssiGetDivelog(token: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(buildUrl('get_divelog', { token }));
  if (!res.ok) throw new SSIUpstreamError(res.status);
  const data = (await res.json()) as Record<string, unknown>;
  if (!Array.isArray(data.logbook_details)) {
    throw new SSIResponseShapeError('Unexpected get_divelog response shape (missing logbook_details array)');
  }
  return data.logbook_details as Record<string, unknown>[];
}

export async function ssiGetDiveSites(token: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(buildUrl('get_divelog', { token }));
  if (!res.ok) throw new SSIUpstreamError(res.status);
  const data = (await res.json()) as Record<string, unknown>;
  return Array.isArray(data.logbook_sites) ? (data.logbook_sites as Record<string, unknown>[]) : [];
}

export async function ssiSaveDivelog(token: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(buildUrl('save_divelog', { token }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ json_data: JSON.stringify(payload) }).toString(),
  });
  if (!res.ok) throw new SSIUpstreamError(res.status);
  return res.json();
}
