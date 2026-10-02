'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { safeCallbackUrl } from '@/lib/http-guards';

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authClient.signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? 'Sign in failed');
        return;
      }
      // Same-origin redirect only, resolved against the real origin:
      // "//host", "/\host" and control-char variants of them all resolve
      // off-origin and fall back to /bases (see safeCallbackUrl).
      const callbackUrl = searchParams.get('callbackUrl');
      router.push(safeCallbackUrl(callbackUrl, window.location.origin));
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
          <span className="text-xs text-muted-foreground">email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full h-8 px-2.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full h-8 px-2.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-8 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {loading ? '···' : 'sign in'}
        </button>
      </form>

      <p className="mt-6 text-xs text-muted-foreground">
        no account?{' '}
        <Link href="/register" className="text-foreground underline underline-offset-2">
          register
        </Link>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
