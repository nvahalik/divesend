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
import { AuthForm } from '../components/AuthForm';
import { LoginForm } from '../components/LoginForm';

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
    </div>
  );
}
