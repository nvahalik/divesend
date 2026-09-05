// app/src/screens/AccountsScreen.tsx
import { useEffect, useState } from 'react';
import { logout } from '../auth/authClient';
import { disableGuestMode, type CurrentUser } from '../auth/session';
import {
  getGuestSsiSession,
  setGuestSsiSession,
  clearGuestSsiSession,
  rememberGuestSsiPassword,
  takeGuestSsiPassword,
} from '../ssi/guestSsiSession';
import { linkSSI, unlinkSSI, getDivelog, fetchGuestSsiToken, SSIHttpError } from '../ssi/ssiClient';
import { clearAllDives } from '../db/db';
import { removeLocalStorageByPrefix } from '../lib/storage';
import { FINGERPRINT_STORAGE_PREFIX } from '../engine/webble';
import { AuthForm } from '../components/AuthForm';
import { LoginForm } from '../components/LoginForm';

/**
 * Forgets every per-device "newest dive already downloaded" fingerprint ConnectScreen keeps in
 * localStorage. Non-destructive to any stored dive -- it only affects future syncs, which will
 * redownload everything from each dive computer instead of just what's new. Low-stakes enough
 * (unlike ClearAllDivesSection) that it doesn't need a confirm step.
 */
function ForgetSyncedDevicesSection() {
  const [cleared, setCleared] = useState(false);

  const handleClick = () => {
    removeLocalStorageByPrefix(FINGERPRINT_STORAGE_PREFIX);
    setCleared(true);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-2 text-sm font-semibold text-slate-700">Sync history</div>
      <p className="mb-3 text-sm text-slate-500">
        Forget which dives were already downloaded from each dive computer. The next connect will
        redownload every dive on the device instead of just the new ones -- already-imported dives
        won't be duplicated, but the download will take longer.
      </p>
      {cleared ? (
        <p className="text-sm text-slate-500">Done -- the next connect will redownload from scratch.</p>
      ) : (
        <button
          onClick={handleClick}
          className="w-fit rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Forget synced devices
        </button>
      )}
    </div>
  );
}

/**
 * Deletes every dive stored in this browser. Local-only (doesn't touch SSI), so it's offered
 * the same way regardless of account/SSI-link state -- rendered once per branch below rather
 * than lifted into AccountsScreen's own state, since its confirm/error state is entirely
 * self-contained and none of the branches need to react to it.
 */
function ClearAllDivesSection() {
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);

  const handleClear = async () => {
    setClearing(true);
    setError(null);
    try {
      await clearAllDives();
      setConfirming(false);
      setCleared(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
      <div className="mb-2 text-sm font-semibold text-red-800">Danger zone</div>
      {cleared ? (
        <p className="text-sm text-red-700">All dives stored in this browser have been cleared.</p>
      ) : confirming ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-red-700">
            This permanently deletes every dive stored in this browser. This cannot be undone.
          </p>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-3">
            <button
              onClick={() => void handleClear()}
              disabled={clearing}
              className="w-fit rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {clearing ? 'Clearing…' : 'Yes, clear all dives'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={clearing}
              className="w-fit rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="w-fit rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100"
        >
          Clear all dives
        </button>
      )}
    </div>
  );
}

interface Props {
  /** App.tsx's `if (!user)` gate guarantees a resolved, non-null session before this renders. */
  user: CurrentUser;
  /** Re-runs `resolveSession()` in App.tsx. Used instead of a full page reload so the
   *  in-memory guest SSI password survives from "connect SSI" until signup. */
  onSessionChange: () => Promise<void>;
}

export function AccountsScreen({ user, onSessionChange }: Props) {
  const [diveCount, setDiveCount] = useState<number | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [carryOver, setCarryOver] = useState<{ ssiEmail: string; password: string } | null>(null);
  const [carryOverError, setCarryOverError] = useState<string | null>(null);

  // Fetches fresh (never persists the count itself) whenever the user's SSI-linked
  // status changes -- including on initial mount if already linked from a previous
  // session, so a reload without unlinking still shows a correct, live dive count.
  useEffect(() => {
    if (!user.ssiLinked) {
      setDiveCount(null);
      setCountError(null);
      return;
    }
    let cancelled = false;
    setLoadingCount(true);
    setCountError(null);
    getDivelog()
      .then((records) => {
        if (!cancelled) setDiveCount(records.length);
      })
      .catch((err) => {
        if (cancelled) return;
        // Only an auth/upstream failure means the guest token is actually dead. A transient
        // network blip must not force the guest through a full SSI re-auth.
        if (getGuestSsiSession() && err instanceof SSIHttpError && (err.status === 401 || err.status === 502)) {
          clearGuestSsiSession();
          setCountError('SSI session expired — reconnect below.');
        } else {
          setCountError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCount(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user.ssiLinked]);

  const handleLinkSSI = async (ssiEmail: string, ssiPassword: string) => {
    await linkSSI(ssiEmail, ssiPassword);
    await onSessionChange();
  };

  const handleUnlinkSSI = async () => {
    setUnlinkError(null);
    try {
      await unlinkSSI();
      await onSessionChange();
    } catch (err) {
      setUnlinkError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLogout = async () => {
    await logout();
    await onSessionChange();
  };

  const handleAuthenticated = async () => {
    // A guest just signed up / logged in. If they connected SSI earlier in this same page
    // session, offer to move that link onto their new account in one click.
    const password = takeGuestSsiPassword();
    const guestSsi = getGuestSsiSession();
    disableGuestMode();
    if (password && guestSsi) {
      // Deliberately no re-resolve here: App.tsx still sees `kind: 'guest'`, so the guest
      // branch below stays mounted and renders the carry-over prompt. The session is
      // re-resolved once the prompt is answered either way.
      setCarryOver({ ssiEmail: guestSsi.ssiEmail, password });
    } else {
      await onSessionChange();
    }
  };

  const handleGuestConnectSSI = async (ssiEmail: string, ssiPassword: string) => {
    const token = await fetchGuestSsiToken(ssiEmail, ssiPassword);
    setGuestSsiSession({ token, ssiEmail });
    rememberGuestSsiPassword(ssiPassword);
    // Must NOT reload: the remembered password is a non-persisted module variable and has
    // to survive until the guest signs up, for the post-signup carry-over offer.
    await onSessionChange();
  };

  const handleGuestDisconnectSSI = async () => {
    clearGuestSsiSession();
    await onSessionChange();
  };

  const handleCompleteCarryOver = async () => {
    if (!carryOver) return;
    setCarryOverError(null);
    try {
      await linkSSI(carryOver.ssiEmail, carryOver.password);
      clearGuestSsiSession();
      await onSessionChange();
    } catch (err) {
      setCarryOverError(err instanceof Error ? err.message : String(err));
    }
  };

  if (user.kind === 'guest') {
    if (carryOver) {
      return (
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-bold">Account</h1>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-700">
              Finish connecting your SSI account ({carryOver.ssiEmail}) to your new DiveSend account?
            </p>
            {carryOverError && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{carryOverError}</p>
            )}
            <div className="mt-3 flex gap-3">
              <button
                onClick={() => void handleCompleteCarryOver()}
                className="w-fit rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Connect SSI
              </button>
              <button
                onClick={() => void onSessionChange()}
                className="w-fit rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Account</h1>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">
            You're using DiveSend as a guest. Your dives are saved in this browser only.
          </div>
          {user.ssiLinked && (
            <>
              <div className="mt-2 text-sm text-slate-500">SSI account: {user.ssiEmail}</div>
              <div className="mt-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dives in SSI</div>
                <div className="text-2xl font-bold">
                  {loadingCount ? 'Loading…' : countError ? `Error: ${countError}` : (diveCount ?? '—')}
                </div>
              </div>
            </>
          )}
        </div>

        {user.ssiLinked ? (
          <button
            onClick={() => void handleGuestDisconnectSSI()}
            className="w-fit rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Disconnect SSI
          </button>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-slate-700">Connect an SSI account</div>
            <LoginForm onLogin={handleGuestConnectSSI} />
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2 text-sm font-semibold text-slate-700">Create an account</div>
          <AuthForm onAuthenticated={handleAuthenticated} />
        </div>

        <ForgetSyncedDevicesSection />
        <ClearAllDivesSection />
      </div>
    );
  }

  // Logged in, SSI not linked yet.
  if (!user.ssiLinked) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Account</h1>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Logged in as {user.email}</div>
        </div>
        <LoginForm onLogin={handleLinkSSI} />
        <ForgetSyncedDevicesSection />
        <ClearAllDivesSection />
      </div>
    );
  }

  // Logged in and SSI linked.
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Account</h1>
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-sm text-slate-500">Logged in as {user.email}</div>
        <div className="mt-2 text-sm text-slate-500">SSI account: {user.ssiEmail}</div>
        <div className="mt-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dives in SSI</div>
          <div className="text-2xl font-bold">
            {loadingCount ? 'Loading…' : countError ? `Error: ${countError}` : (diveCount ?? '—')}
          </div>
        </div>
      </div>
      {unlinkError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{unlinkError}</p>}
      <div className="flex gap-3">
        <button
          onClick={() => void handleUnlinkSSI()}
          className="w-fit rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Unlink SSI
        </button>
        <button
          onClick={() => void handleLogout()}
          className="w-fit rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Log out
        </button>
      </div>
      <ForgetSyncedDevicesSection />
      <ClearAllDivesSection />
    </div>
  );
}
