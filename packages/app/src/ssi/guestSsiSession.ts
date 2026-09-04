// Browser-held SSI session for a guest (no app account). The Worker stores nothing for a
// guest, so the derived SSI token lives here in localStorage until the guest disconnects
// SSI or clears their browser data. The SSI *password* is never persisted -- it is held in
// a non-persisted module variable only long enough to offer a one-click "carry the link
// over" step if the guest signs up in the same page session.

import { readLocalStorage, removeLocalStorage, writeLocalStorage } from '../lib/storage';

export const GUEST_SSI_STORAGE_KEY = 'divesend.ssiGuest';

export interface GuestSsiSession {
  token: string;
  ssiEmail: string;
}

export function getGuestSsiSession(): GuestSsiSession | null {
  const raw = readLocalStorage(GUEST_SSI_STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GuestSsiSession>;
    if (typeof parsed.token === 'string' && typeof parsed.ssiEmail === 'string') {
      return { token: parsed.token, ssiEmail: parsed.ssiEmail };
    }
    return null;
  } catch {
    return null;
  }
}

export function setGuestSsiSession(session: GuestSsiSession): void {
  writeLocalStorage(GUEST_SSI_STORAGE_KEY, JSON.stringify({ token: session.token, ssiEmail: session.ssiEmail }));
}

export function clearGuestSsiSession(): void {
  removeLocalStorage(GUEST_SSI_STORAGE_KEY);
}

let inMemoryPassword: string | null = null;

export function rememberGuestSsiPassword(password: string): void {
  inMemoryPassword = password;
}

export function takeGuestSsiPassword(): string | null {
  const value = inMemoryPassword;
  inMemoryPassword = null;
  return value;
}
