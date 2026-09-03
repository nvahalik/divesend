// Persists the last-confirmed ExtraDiveDetails as JSON in localStorage, so the next time
// the extra-details modal opens it pre-fills with what was last used rather than always
// re-fetching the account's most recent SSI dive.

import { readLocalStorage, writeLocalStorage } from '../lib/storage';
import type { ExtraDiveDetails } from './extraDiveDetails';

export const LAST_USED_STORAGE_KEY = 'ssi-last-used-dive-details';

export function loadLastUsed(): ExtraDiveDetails | undefined {
  const raw = readLocalStorage(LAST_USED_STORAGE_KEY);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as ExtraDiveDetails;
  } catch {
    return undefined;
  }
}

export function saveLastUsed(details: ExtraDiveDetails): void {
  writeLocalStorage(LAST_USED_STORAGE_KEY, JSON.stringify(details));
}
