import { useState, type FormEvent } from 'react';
import { AuthHttpError, login, signup } from '../auth/authClient';

interface Props {
  onAuthenticated: () => void;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500';

export function AuthForm({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await signup(email, password);
      } else {
        await login(email, password);
      }
      onAuthenticated();
    } catch (err) {
      setError(err instanceof AuthHttpError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="auth-email" className="text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="auth-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="auth-password" className="text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="auth-password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT_CLASS}
        />
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-fit rounded-lg bg-slate-900 px-6 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {submitting ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'login' ? 'signup' : 'login');
          setError(null);
        }}
        className="text-sm text-slate-600 underline"
      >
        {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
      </button>
    </form>
  );
}
