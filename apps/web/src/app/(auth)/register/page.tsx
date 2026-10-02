'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';

// Map raw better-auth messages to user-facing copy. The server can reject
// sign-ups (e.g. DISABLE_SIGNUP=1) — surface that case clearly instead of the
// raw API wording. No client-side toggle: the server is the source of truth.
function friendlySignUpError(message: string | undefined): string {
  const msg = message ?? '';
  if (/sign\s*up.*disabled|registration.*disabled|not accepting/i.test(msg)) {
    return 'Registration is currently disabled on this server.';
  }
  if (/already (exists|registered)/i.test(msg)) {
    return 'An account with this email already exists.';
  }
  return msg || 'Sign up failed';
}

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await authClient.signUp.email({ email, password, name });
      if (res.error) {
        setError(friendlySignUpError(res.error.message));
        return;
      }
      router.push('/bases');
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">markpocket</h1>
        <p className="text-sm text-muted-foreground mt-1">the airtable you own</p>
      </div>

      <form onSubmit={onSubmit} className="w-[360px] space-y-3">
        <label className="block">
          <span className="text-xs text-muted-foreground">name</span>
          <input
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full h-8 px-2.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full h-8 px-2.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full h-8 px-2.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">confirm password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full h-8 px-2.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-8 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {loading ? '···' : 'register'}
        </button>
      </form>

      <p className="mt-6 text-xs text-muted-foreground">
        already have an account?{' '}
        <Link href="/login" className="text-foreground underline underline-offset-2">
          sign in
        </Link>
      </p>
    </main>
  );
}
