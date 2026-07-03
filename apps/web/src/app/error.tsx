'use client';

import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <EmptyState
        title="Something went wrong"
        description={error.message || 'An unexpected error occurred.'}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={reset}
              className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Try again
            </button>
            <Link
              href="/bases"
              className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm hover:bg-muted"
            >
              ← Back to bases
            </Link>
          </div>
        }
      />
    </main>
  );
}
