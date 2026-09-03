// app/src/App.tsx
import { useEffect, useState } from 'react';
import { ConnectScreen } from './screens/ConnectScreen';
import { DiveListScreen } from './screens/DiveListScreen';
import { DiveDetailScreen } from './screens/DiveDetailScreen';
import { AccountsScreen } from './screens/AccountsScreen';
import { AuthForm } from './components/AuthForm';
import { resolveSession, enableGuestMode, type CurrentUser } from './auth/session';

type Screen = { name: 'list' } | { name: 'connect' } | { name: 'detail'; diveId: string } | { name: 'account' };

const NAV_ITEMS: { screen: Screen; label: string }[] = [
  { screen: { name: 'list' }, label: 'Dives' },
  { screen: { name: 'connect' }, label: 'Connect' },
  { screen: { name: 'account' }, label: 'Account' },
];

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'list' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);

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
            enableGuestMode();
            void refreshUser();
          }}
          className="text-sm text-slate-600 underline"
        >
          Continue without an account
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <nav className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white">
        <span className="font-bold tracking-tight">DiveSend</span>
        <div className="flex gap-4 text-sm">
          {user.kind === 'guest' && (
            <button
              type="button"
              onClick={() => setScreen({ name: 'account' })}
              className="rounded-full bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-200 hover:bg-slate-600"
            >
              Guest
            </button>
          )}
          {NAV_ITEMS.map((item) => (
            <button
              key={item.screen.name}
              onClick={() => setScreen(item.screen)}
              className={
                screen.name === item.screen.name
                  ? 'font-semibold text-cyan-400'
                  : 'text-slate-300 hover:text-white'
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>
      <main className="mx-auto max-w-3xl px-4 py-6">
        {screen.name === 'list' && (
          <DiveListScreen
            refreshKey={refreshKey}
            onSelectDive={(diveId) => setScreen({ name: 'detail', diveId })}
            ssiReady={user.ssiLinked}
          />
        )}
        {screen.name === 'connect' && (
          <ConnectScreen
            onDivesImported={() => {
              setRefreshKey((k) => k + 1);
              setScreen({ name: 'list' });
            }}
          />
        )}
        {screen.name === 'detail' && <DiveDetailScreen diveId={screen.diveId} onBack={() => setScreen({ name: 'list' })} />}
        {screen.name === 'account' && <AccountsScreen />}
      </main>
    </div>
  );
}
