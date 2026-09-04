// app/src/App.tsx
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate, useParams } from 'react-router-dom';
import { ConnectScreen } from './screens/ConnectScreen';
import { DiveListScreen } from './screens/DiveListScreen';
import { DiveDetailScreen } from './screens/DiveDetailScreen';
import { AccountsScreen } from './screens/AccountsScreen';
import { AuthForm } from './components/AuthForm';
import { BluetoothUnsupportedNotice } from './components/BluetoothUnsupportedNotice';
import { isWebBluetoothSupported } from './lib/webBluetooth';
import { resolveSession, enableGuestMode, type CurrentUser } from './auth/session';

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: '/dives', label: 'Dives' },
  { to: '/connect', label: 'Connect' },
  { to: '/account', label: 'Account' },
];

const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'font-semibold text-cyan-400' : 'text-slate-300 hover:text-white';

function DiveDetailRoute() {
  const { diveId } = useParams<{ diveId: string }>();
  const navigate = useNavigate();
  // The route is only ever reached via /dives/:diveId, so diveId is always present.
  return <DiveDetailScreen diveId={diveId!} onBack={() => navigate('/dives')} />;
}

export function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);
  const [guestModeError, setGuestModeError] = useState<string | null>(null);

  const refreshUser = () => resolveSession().then(setUser);

  useEffect(() => {
    refreshUser();
  }, []);

  if (user === undefined) {
    return <p className="p-6 text-center text-slate-500">Loading…</p>;
  }

  if (!user) {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
        <h1 className="text-2xl font-bold">DiveSend</h1>
        <AuthForm onAuthenticated={refreshUser} />
        <button
          type="button"
          onClick={() => {
            if (!enableGuestMode()) {
              setGuestModeError('Guest mode needs browser storage. Enable it (or leave private browsing) and try again.');
              return;
            }
            void refreshUser();
          }}
          className="text-sm text-slate-600 underline"
        >
          Continue without an account
        </button>
        {guestModeError && <p className="text-sm text-red-600">{guestModeError}</p>}
        {!isWebBluetoothSupported() && <BluetoothUnsupportedNotice />}
      </div>
    );
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <nav className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white">
          <span className="font-bold tracking-tight">DiveSend</span>
          <div className="flex gap-4 text-sm">
            {user.kind === 'guest' && (
              <NavLink
                to="/account"
                className="rounded-full bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-200 hover:bg-slate-600"
              >
                Guest
              </NavLink>
            )}
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClassName}>
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
        <main className="mx-auto max-w-3xl px-4 py-6">
          <Routes>
            <Route path="/" element={<Navigate to="/dives" replace />} />
            <Route
              path="/dives"
              element={<DiveListScreenRoute refreshKey={refreshKey} ssiReady={user.ssiLinked} />}
            />
            <Route path="/dives/:diveId" element={<DiveDetailRoute />} />
            <Route
              path="/connect"
              element={<ConnectScreenRoute onDivesImported={() => setRefreshKey((k) => k + 1)} />}
            />
            <Route path="/account" element={<AccountsScreen user={user} onSessionChange={refreshUser} />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

function DiveListScreenRoute({ refreshKey, ssiReady }: { refreshKey: number; ssiReady: boolean }) {
  const navigate = useNavigate();
  return (
    <DiveListScreen
      refreshKey={refreshKey}
      onSelectDive={(diveId) => navigate(`/dives/${diveId}`)}
      ssiReady={ssiReady}
    />
  );
}

function ConnectScreenRoute({ onDivesImported }: { onDivesImported: () => void }) {
  const navigate = useNavigate();
  return (
    <ConnectScreen
      onDivesImported={() => {
        onDivesImported();
        navigate('/dives');
      }}
    />
  );
}
