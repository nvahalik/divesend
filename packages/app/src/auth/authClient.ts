// Talks to this app's own Worker backend (not SSI directly) for account signup/login/logout
// and the current-session check. Session state is a cookie the browser manages automatically
// (`credentials: 'include'` on every call); this module never touches the cookie itself.

const BASE_PATH = '/api/auth';

export class AuthHttpError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message ?? `Auth request failed: HTTP ${status}`);
    this.status = status;
  }
}

export interface AuthUser {
  email: string;
  ssiLinked: boolean;
  ssiEmail: string | null;
}

async function parseErrorMessage(res: Response): Promise<string | undefined> {
  try {
    const data = await res.json();
    return typeof data?.error === 'string' ? data.error : undefined;
  } catch {
    return undefined;
  }
}

async function postJson(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${BASE_PATH}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new AuthHttpError(res.status, await parseErrorMessage(res));
  return res;
}

export async function signup(email: string, password: string): Promise<void> {
  await postJson('/signup', { email, password });
}

export async function login(email: string, password: string): Promise<void> {
  await postJson('/login', { email, password });
}

export async function logout(): Promise<void> {
  const res = await fetch(`${BASE_PATH}/logout`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new AuthHttpError(res.status, await parseErrorMessage(res));
}

export async function me(): Promise<AuthUser | null> {
  const res = await fetch(`${BASE_PATH}/me`, { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) throw new AuthHttpError(res.status, await parseErrorMessage(res));
  return res.json();
}
