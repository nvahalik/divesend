// The app's effective session state. Replaces raw `AuthUser | null` handling: a visitor is
// either a signed-in account, a guest (chose "continue without an account"), or anonymous
// (nothing chosen yet -> the landing wall renders).

import { readLocalStorage, removeLocalStorage, writeLocalStorage } from '../lib/storage';
import { clearGuestSsiSession, getGuestSsiSession } from '../ssi/guestSsiSession';
import { me } from './authClient';

export const GUEST_MODE_STORAGE_KEY = 'divesend.guestMode';

export interface AccountUser {
  kind: 'account';
  email: string;
  ssiLinked: boolean;
  ssiEmail: string | null;
}

export interface GuestUser {
  kind: 'guest';
  ssiLinked: boolean;
  ssiEmail: string | null;
}

export type CurrentUser = AccountUser | GuestUser;

export function isGuestMode(): boolean {
  return readLocalStorage(GUEST_MODE_STORAGE_KEY) === '1';
}

/** Returns false if the guest flag could not be persisted (storage disabled/full) -- the
 *  caller must surface that rather than leaving the visitor on a dead-end button. */
export function enableGuestMode(): boolean {
  return writeLocalStorage(GUEST_MODE_STORAGE_KEY, '1');
}

export function disableGuestMode(): void {
  removeLocalStorage(GUEST_MODE_STORAGE_KEY);
}

export async function resolveSession(): Promise<CurrentUser | null> {
  const account = await me();
  if (account) {
    // An account uses the server-side SSI link, never the browser-held guest token.
    if (getGuestSsiSession()) clearGuestSsiSession();
    return { kind: 'account', email: account.email, ssiLinked: account.ssiLinked, ssiEmail: account.ssiEmail };
  }

  if (isGuestMode()) {
    const guestSsi = getGuestSsiSession();
    return { kind: 'guest', ssiLinked: guestSsi !== null, ssiEmail: guestSsi?.ssiEmail ?? null };
  }

  return null;
}
