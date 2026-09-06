// app/src/App.tsx
import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate, useParams } from 'react-router-dom';
import { ConnectScreen } from './screens/ConnectScreen';
import { DiveListScreen } from './screens/DiveListScreen';
import { DiveDetailScreen } from './screens/DiveDetailScreen';
import { AccountsScreen } from './screens/AccountsScreen';
import { AuthForm } from './components/AuthForm';
import { BluetoothUnsupportedNotice } from './components/BluetoothUnsupportedNotice';
import { isWebBluetoothSupported } from './lib/webBluetooth';
import { resolveSession, enableGuestMode, type CurrentUser } from './auth/session';
import { useDownloadSession } from './engine/downloadSession';

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: '/dives', label: 'Dives' },
  { to: '/connect', label: 'Device' },
  { to: '/account', label: 'Account' },
];

const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'font-semibold text-cyan-400' : 'text-slate-300 hover:text-white';

function DiveDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // The route is only ever reached via /dives/:id, so id is always present.
  // `id` is the dive's opaque UUID primary key (StoredDive.id), not the
  // content-derived StoredDive.diveId.
  return <DiveDetailScreen id={id!} onBack={() => navigate('/dives')} />;
}

export function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);
  const [guestModeError, setGuestModeError] = useState<string | null>(null);
  const downloadSession = useDownloadSession();

  const refreshUser = () => resolveSession().then(setUser);

  useEffect(() => {
    refreshUser();
  }, []);

  // The BLE download runs independently of which screen is mounted (see
  // engine/downloadSession.ts) -- watch its monotonic totalImported counter
  // here, at the App root, so the Dives list refreshes as soon as a dive
  // lands even if the user wandered off to Account or Dives mid-download.
  // totalImported never resets (unlike diveCount, which restarts each run),
  // so a plain !== check is enough; no risk of missing an update.
  const lastSeenImportedRef = useRef(downloadSession.totalImported);
  useEffect(() => {
    if (downloadSession.totalImported !== lastSeenImportedRef.current) {
      lastSeenImportedRef.current = downloadSession.totalImported;
      setRefreshKey((k) => k + 1);
    }
  }, [downloadSession.totalImported]);

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
                <span className="inline-flex items-center gap-1.5">
                  {item.label}
                  {/* Live indicator so a download in progress is visible from any
                      screen, not just while /connect is mounted -- see
                      engine/downloadSession.ts. */}
                  {item.to === '/connect' && downloadSession.connecting && (
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" title="Downloading…" />
                  )}
                </span>
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
            <Route path="/dives/:id" element={<DiveDetailRoute />} />
            <Route path="/connect" element={<ConnectScreen />} />
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
      // `id` is the dive's opaque UUID primary key -- URL-safe as-is.
      onSelectDive={(id) => navigate(`/dives/${id}`)}
      ssiReady={ssiReady}
    />
  );
}
