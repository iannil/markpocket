'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/empty-state';
import { useBasesList } from '@/lib/bases-context';
import { fmtTimeAgo } from '@/lib/format';
import { trpc } from '@/lib/trpc/client';

// Stable absolute form for the SSR pass: the relative form is computed from
// Date.now() and can differ between server render and hydration across a
// minute/hour/day boundary (a text mismatch React logs as a hydration error).
function createdLabel(b: { createdAt: string }, mounted: boolean): string {
  if (!mounted) return new Date(b.createdAt).toISOString().slice(0, 10);
  return fmtTimeAgo(b.createdAt);
}

export default function BasesPage() {
  // The RSC layout already fetched base.list; seed the query with those rows
  // (empty list included) so mounting issues no second identical request —
  // initialDataUpdatedAt marks the seed fresh, otherwise TanStack Query
  // treats it as stale-from-1970 and refetches anyway.
  const initial = useBasesList();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const utils = trpc.useUtils();
  const {
    data: bases,
    isLoading,
    isError,
  } = trpc.base.list.useQuery(undefined, {
    initialData: initial,
    initialDataUpdatedAt: Date.now(),
  });

  if (isLoading) {
    return (
      <div className="flex-1 p-6">
        <div className="mx-auto max-w-3xl">
          <div className="h-12 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center">
          <h1 className="text-sm font-semibold text-destructive">Failed to load bases</h1>
          <p className="mt-1 text-xs text-muted-foreground">Check your connection and try again.</p>
          <button
            onClick={() => void utils.base.list.invalidate()}
            className="mt-3 inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!bases || bases.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          title="No bases yet"
          description="Create one to get going"
          action={
            <div className="flex gap-3">
              <Link
                href="/bases/new"
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:opacity-90"
              >
                create your first base
              </Link>
              <Link
                href="/bases/import-airtable"
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
              >
                Import from Airtable
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Workspace</h1>
            <p className="font-mono text-xs text-muted-foreground">
              {bases.length} {bases.length === 1 ? 'base' : 'bases'}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/bases/import-airtable"
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
            >
              Import from Airtable
            </Link>
            <Link
              href="/bases/new"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm text-primary-foreground hover:opacity-90"
            >
              + new base
            </Link>
          </div>
        </header>

        <ul className="border-t border-border">
          {bases.map((b) => (
            <li key={b.id}>
              <Link
                href={`/bases/${b.id}`}
                className="-mx-3 block rounded border-b border-border px-3 py-3 hover:bg-muted"
              >
                <div className="truncate text-sm font-medium">{b.name}</div>
                <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  created {createdLabel(b, mounted)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
