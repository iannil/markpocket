'use client';

import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { trpc } from '@/lib/trpc/client';

function timeAgo(ts: string | number | Date): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function BasesPage() {
  const { data: bases, isLoading } = trpc.base.list.useQuery();

  if (isLoading) {
    return (
      <div className="flex-1 p-6">
        <div className="mx-auto max-w-3xl">
          <div className="h-12 animate-pulse rounded bg-muted" />
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
            <Link
              href="/bases/new"
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:opacity-90"
            >
              create your first base
            </Link>
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
          <Link
            href="/bases/new"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm text-primary-foreground hover:opacity-90"
          >
            + new base
          </Link>
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
                  created {timeAgo(b.createdAt)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
