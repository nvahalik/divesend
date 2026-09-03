// Persisted SSI credentials for the logbook commands.
//
// `divesend login` verifies an email + password against SSI and, on success,
// writes them here as JSON so `list` / `get` / `push` / `create` / `update` work
// without `SSI_EMAIL` / `SSI_PASSWORD` in the environment. The password is
// stored in plaintext (mode 600) -- no more secret than `SSI_PASSWORD` in a
// shell profile. `divesend logout` removes the file.

import { mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export interface Auth {
  email: string;
  password: string;
}

/** `$XDG_CONFIG_HOME/divesend/auth.json`, defaulting to `~/.config`. */
export function authFilePath(): string {
  const base =
    process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config');
  return path.join(base, 'divesend', 'auth.json');
}

/**
 * Read the stored credentials. Returns `null` -- never throws -- when the file
 * is absent, unreadable, not JSON, or missing a string `email` / `password`.
 */
export function loadAuth(): Auth | null {
  let raw: string;
  try {
    raw = readFileSync(authFilePath(), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.email === 'string' && typeof parsed.password === 'string') {
      return { email: parsed.email, password: parsed.password };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Write the credentials, creating the dir, with tight (600) permissions. */
export function saveAuth(a: Auth): void {
  const file = authFilePath();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 });
  // writeFileSync's `mode` is a no-op if the file already existed with looser
  // perms; force them regardless.
  chmodSync(file, 0o600);
}

/** Remove the stored credentials. No error if there are none. */
export function clearAuth(): void {
  rmSync(authFilePath(), { force: true });
}
