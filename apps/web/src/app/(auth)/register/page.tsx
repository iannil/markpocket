'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { safeCallbackUrl } from '@/lib/http-guards';
import { cn } from '@/lib/utils';

// better-auth's default minimum; kept in sync so the client rejects short
// passwords with an inline hint instead of a raw server message.
const MIN_PASSWORD_LENGTH = 8;

// Which field a given error belongs to — drives the red border placement.
type ErrorField = 'name' | 'email' | 'password' | 'confirm' | null;

// Map raw better-auth messages to user-facing copy. The server can reject
// sign-ups (e.g. DISABLE_SIGNUP=1) — surface that case clearly instead of the
// raw API wording. No client-side toggle: the server is the source of truth.
function friendlySignUpError(message: string | undefined): { text: string; field: ErrorField } {
  const msg = message ?? '';
  if (/password.*short/i.test(msg)) {
    return {
      text: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      field: 'password',
    };
  }
  if (/already (exists|registered)/i.test(msg)) {
    return { text: 'An account with this email already exists.', field: 'email' };
  }
  if (/sign\s*up.*disabled|registration.*disabled|not accepting/i.test(msg)) {
    return { text: 'Registration is currently disabled on this server.', field: null };
  }
  return { text: msg || 'Sign up failed', field: null };
}

function RegisterPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<ErrorField>(null);
  const [loading, setLoading] = useState(false);

  function fail(text: string, field: ErrorField) {
    setError(text);
    setErrorField(field);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      fail('passwords do not match', 'confirm');
      return;
    }
    setError(null);
    setErrorField(null);
    setLoading(true);
    try {
      const res = await authClient.signUp.email({ email, password, name });
      if (res.error) {
        const { text, field } = friendlySignUpError(res.error.message);
        fail(text, field);
        setLoading(false);
        return;
      }
      // Replace (not push) and honor the invite flow's callbackUrl —
      // mirrors the login page's redirect handling.
      const callbackUrl = searchParams.get('callbackUrl');
      router.replace(safeCallbackUrl(callbackUrl, window.location.origin));
    } catch {
      fail('Network error — please try again', null);
      setLoading(false);
    }
  }

  const fieldCls = (field: Exclude<ErrorField, null>) =>
    cn(
      'mt-1 w-full h-8 px-2.5 text-sm rounded-md border bg-background focus:outline-none focus:ring-2',
      errorField === field
        ? 'border-destructive focus:ring-destructive/30'
        : 'border-input focus:ring-ring',
    );

  // Error copy rendered directly under the field it refers to.
  const fieldError = (field: Exclude<ErrorField, null>) =>
    errorField === field ? (
      <p className="mt-0.5 text-xs text-destructive" role="alert">
        {error}
      </p>
    ) : null;

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
            name="name"
            required
            maxLength={64}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={errorField === 'name'}
            className={fieldCls('name')}
          />
          {fieldError('name')}
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errorField === 'email'}
            aria-describedby={errorField === 'email' ? 'register-email-error' : undefined}
            className={fieldCls('email')}
          />
          {errorField === 'email' && (
            <p id="register-email-error" className="mt-0.5 text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">password</span>
          <input
            type="password"
            name="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={errorField === 'password'}
            aria-describedby="register-password-hint"
            className={fieldCls('password')}
          />
          <span
            id="register-password-hint"
            className="mt-0.5 block text-[10px] text-muted-foreground"
          >
            at least {MIN_PASSWORD_LENGTH} characters
          </span>
          {fieldError('password')}
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">confirm password</span>
          <input
            type="password"
            name="confirm-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={errorField === 'confirm'}
            className={fieldCls('confirm')}
          />
          {fieldError('confirm')}
        </label>

        {/* Form-level errors (server-wide rejections, network) land here. */}
        {error && errorField === null && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

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

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
        </div>
      }
    >
      <RegisterPageInner />
    </Suspense>
  );
}
