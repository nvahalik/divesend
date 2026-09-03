// app/src/ssi/ssiClient.ts
// Calls this app's own Worker backend (not api.divessi.com directly) -- the Worker holds the
// user's linked SSI credentials and proxies the actual SSI API calls server-side. Session
// auth is a cookie the browser sends automatically (`credentials: 'include'`); no token is
// threaded through these functions' parameters anymore.

import { getGuestSsiSession } from './guestSsiSession';

const BASE_PATH = '/api/ssi';

function withGuestAuth(headers: Record<string, string> = {}): Record<string, string> {
  const guest = getGuestSsiSession();
  return guest ? { ...headers, Authorization: `Bearer ${guest.token}` } : headers;
}

export class SSIHttpError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message ?? `SSI request failed: HTTP ${status}`);
    this.status = status;
  }
}

async function parseErrorMessage(res: Response): Promise<string | undefined> {
  try {
    const data = await res.json();
    return typeof data?.error === 'string' ? data.error : undefined;
  } catch {
    return undefined;
  }
}

export async function linkSSI(ssiEmail: string, ssiPassword: string): Promise<void> {
  const res = await fetch(`${BASE_PATH}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ssiEmail, ssiPassword }),
  });
  if (!res.ok) throw new SSIHttpError(res.status, await parseErrorMessage(res));
}

export async function fetchGuestSsiToken(ssiEmail: string, ssiPassword: string): Promise<string> {
  const res = await fetch(`${BASE_PATH}/guest-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ssiEmail, ssiPassword }),
  });
  if (!res.ok) throw new SSIHttpError(res.status, await parseErrorMessage(res));
  const data = (await res.json()) as { ssiToken?: string };
  if (typeof data.ssiToken !== 'string') throw new SSIHttpError(res.status, 'SSI token missing from response.');
  return data.ssiToken;
}

export async function unlinkSSI(): Promise<void> {
  const res = await fetch(`${BASE_PATH}/link`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new SSIHttpError(res.status, await parseErrorMessage(res));
}

export async function getDivelog(): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${BASE_PATH}/divelog`, { credentials: 'include', headers: withGuestAuth() });
  if (!res.ok) throw new SSIHttpError(res.status, await parseErrorMessage(res));
  return res.json();
}

export async function getDiveSites(): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${BASE_PATH}/sites`, { credentials: 'include', headers: withGuestAuth() });
  if (!res.ok) throw new SSIHttpError(res.status, await parseErrorMessage(res));
  return res.json();
}

export async function saveDivelog(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_PATH}/divelog`, {
    method: 'POST',
    headers: withGuestAuth({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new SSIHttpError(res.status, await parseErrorMessage(res));
  return res.json();
}
