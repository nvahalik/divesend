// app/src/screens/AccountsScreen.tsx
import { useEffect, useState } from 'react';
import { me, logout, type AuthUser } from '../auth/authClient';
import { linkSSI, unlinkSSI, getDivelog } from '../ssi/ssiClient';
import { AuthForm } from '../components/AuthForm';
import { LoginForm } from '../components/LoginForm';

export function AccountsScreen() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [diveCount, setDiveCount] = useState<number | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  const refreshUser = () => me().then(setUser);

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
        <AuthForm onAuthenticated={refreshUser} />
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
