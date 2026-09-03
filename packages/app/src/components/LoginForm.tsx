import { useState, type FormEvent } from 'react';

interface Props {
  onLogin: (email: string, password: string) => Promise<void>;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500';

export function LoginForm({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">
        Your SSI credentials are needed to sync with your account. Your credentials are only used to log in.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="ssi-email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="ssi-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
          className={INPUT_CLASS}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="ssi-password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="ssi-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className={INPUT_CLASS}
        />
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={busy || !email || !password}
        className="w-fit rounded-lg bg-slate-900 px-6 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? 'Logging in…' : 'Log In'}
      </button>
    </form>
  );
}
