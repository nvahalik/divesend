// app/src/lib/storage.ts
// localStorage access can throw (Safari private browsing historically threw
// QuotaExceededError on any write; storage can also be disabled entirely).
// These wrappers turn that into a best-effort no-op instead of an uncaught
// exception -- reads fall back to null, writes/removes fail silently and
// report success/failure via return value so a caller can decide whether to
// surface that to the user (see AccountsScreen's persistenceWarning for an
// example).

export function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Returns true on success, false if the write failed (caller's choice whether to surface this). */
export function writeLocalStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeLocalStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing more to do -- callers that also clear in-memory state (e.g.
    // AccountsScreen's handleLogout) still get correct behavior for the
    // current tab even if the persisted copy couldn't be cleared.
  }
}
