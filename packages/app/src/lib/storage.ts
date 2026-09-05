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

/**
 * Removes every localStorage key starting with `prefix` -- for keys that are
 * namespaced per-device (or otherwise not individually known ahead of time),
 * e.g. ConnectScreen's per-device sync fingerprint. Snapshots the key list
 * before removing anything, since mutating localStorage while iterating it
 * live is unreliable across browsers.
 */
export function removeLocalStorageByPrefix(prefix: string): void {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    // Storage disabled/unavailable -- nothing more to do.
  }
}
