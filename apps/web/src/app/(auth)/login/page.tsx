'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { safeCallbackUrl } from '@/lib/http-guards';
import { cn } from '@/lib/utils';

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
        setLoading(false);
        return;
      }
      // Same-origin redirect only, resolved against the real origin:
      // "//host", "/\host" and control-char variants of them all resolve
      // off-origin and fall back to /bases (see safeCallbackUrl).
      // replace, not push: Back from the landed page must not return to the
      // (now useless) login form.
      const callbackUrl = searchParams.get('callbackUrl');
      router.replace(safeCallbackUrl(callbackUrl, window.location.origin));
    } catch {
      setError('Network error — please try again');
      setLoading(false);
    }
  }

  // Preserve the invite-flow context across the login → register hop.
  const callbackUrl = searchParams.get('callbackUrl');
  const registerHref = callbackUrl
    ? `/register?callbackUrl=${encodeURIComponent(callbackUrl)}`
    : '/register';

  // Both credentials are equally suspect on a failed sign-in — mark both.
  const invalid = error != null;
  const fieldCls = cn(
    'mt-1 w-full h-8 px-2.5 text-sm rounded-md border bg-background focus:outline-none focus:ring-2',
    invalid
      ? 'border-destructive focus:ring-destructive/30'
      : 'border-input focus:ring-ring focus:ring-offset-0',
  );

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">markpocket</h1>
        <p className="text-sm text-muted-foreground mt-1">the airtable you own</p>
      </div>

      <form onSubmit={onSubmit} className="w-[360px] space-y-3" noValidate={false}>
        <label className="block">
          <span className="text-xs text-muted-foreground">email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'login-error' : undefined}
            className={fieldCls}
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">password</span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'login-error' : undefined}
            className={fieldCls}
          />
        </label>

        {/* Field-level placement: the message sits directly under the
            credentials it refers to, not floating above the submit button.
            role=alert announces it to screen readers the moment it appears. */}
        {error && (
          <p id="login-error" className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

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
        <Link href={registerHref} className="text-foreground underline underline-offset-2">
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
          <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
