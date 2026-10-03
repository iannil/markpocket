import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';

export const metadata: Metadata = {
  title: 'Page not found',
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <EmptyState
        as="h1"
        title="Page not found"
        description="The page you’re looking for doesn’t exist."
        action={
          <Link
            href="/"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            ← Back home
          </Link>
        }
      />
    </main>
  );
}
