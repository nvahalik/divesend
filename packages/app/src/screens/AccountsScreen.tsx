// app/src/screens/AccountsScreen.tsx
import { useEffect, useState } from 'react';
import { logout } from '../auth/authClient';
import { resolveSession, disableGuestMode, type CurrentUser } from '../auth/session';
import {
  getGuestSsiSession,
  setGuestSsiSession,
  clearGuestSsiSession,
  rememberGuestSsiPassword,
  takeGuestSsiPassword,
} from '../ssi/guestSsiSession';
import { linkSSI, unlinkSSI, getDivelog, fetchGuestSsiToken } from '../ssi/ssiClient';
import { AuthForm } from '../components/AuthForm';
import { LoginForm } from '../components/LoginForm';

export function AccountsScreen() {
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);
  const [diveCount, setDiveCount] = useState<number | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [carryOver, setCarryOver] = useState<{ ssiEmail: string; password: string } | null>(null);
  const [carryOverError, setCarryOverError] = useState<string | null>(null);

  const refreshUser = () => resolveSession().then(setUser);

  useEffect(() => {
    refreshUser();
  }, []);

  // Fetches fresh (never persists the count itself) whenever the user's SSI-linked
  // status changes -- including on initial mount if already linked from a previous
  // session, so a reload without unlinking still shows a correct, live dive count.
  useEffect(() => {
    if (!user?.ssiLinked) {
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
        if (!cancelled) setCountError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingCount(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.ssiLinked]);

  const handleLinkSSI = async (ssiEmail: string, ssiPassword: string) => {
    await linkSSI(ssiEmail, ssiPassword);
    window.location.reload();
  };

  const handleUnlinkSSI = async () => {
    setUnlinkError(null);
    try {
      await unlinkSSI();
      window.location.reload();
    } catch (err) {
      setUnlinkError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLogout = async () => {
    await logout();
    window.location.reload();
  };

  const handleAuthenticated = () => {
    // A guest just signed up / logged in. If they connected SSI earlier in this same page
    // session, offer to move that link onto their new account in one click.
    const password = takeGuestSsiPassword();
    const guestSsi = getGuestSsiSession();
    disableGuestMode();
    if (password && guestSsi) {
      setCarryOver({ ssiEmail: guestSsi.ssiEmail, password });
    } else {
      window.location.reload();
    }
  };

  const handleGuestConnectSSI = async (ssiEmail: string, ssiPassword: string) => {
    const token = await fetchGuestSsiToken(ssiEmail, ssiPassword);
    setGuestSsiSession({ token, ssiEmail });
    rememberGuestSsiPassword(ssiPassword);
    window.location.reload();
  };

  const handleGuestDisconnectSSI = () => {
    clearGuestSsiSession();
    window.location.reload();
  };

  const handleCompleteCarryOver = async () => {
    if (!carryOver) return;
    setCarryOverError(null);
    try {
      await linkSSI(carryOver.ssiEmail, carryOver.password);
      clearGuestSsiSession();
      window.location.reload();
    } catch (err) {
      setCarryOverError(err instanceof Error ? err.message : String(err));
    }
  };

  // Loading state before the initial `me()` call resolves.
  if (user === undefined) {
    return <p className="text-center text-slate-500">Loading…</p>;
  }

  // Not logged into the app at all. In normal navigation App.tsx's own top-level
  // gate already handles this case before AccountsScreen ever renders, but this
  // stays as a defensive fallback (e.g. session expiring between App.tsx's check
  // and this component's own `me()` call).
  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Account</h1>
        <AuthForm onAuthenticated={handleAuthenticated} />
      </div>
    );
  }

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
                onClick={() => window.location.reload()}
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
            onClick={handleGuestDisconnectSSI}
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
