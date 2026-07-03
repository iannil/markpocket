import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <EmptyState
        title="Page not found"
        description="The page you’re looking for doesn’t exist."
        action={
          <Link
            href="/bases"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:opacity-90"
          >
            ← Back to bases
          </Link>
        }
      />
    </main>
  );
}
