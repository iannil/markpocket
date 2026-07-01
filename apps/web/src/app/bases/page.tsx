'use client';

import { Database } from 'lucide-react';
import Link from 'next/link';

import { trpc } from '@/lib/trpc/client';

export default function BasesPage() {
  const { data: bases } = trpc.base.list.useQuery();

  return (
    <div className="flex flex-1 items-center justify-center overflow-auto p-8">
      <div className="w-full max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your bases</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select a base from the sidebar, or pick one below.
          </p>
        </div>
        {bases && bases.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bases.map((b) => (
              <Link
                key={b.id}
                href={`/bases/${b.id}`}
                className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-primary/70 transition-colors group-hover:text-primary" />
                  <span className="font-semibold tracking-tight">{b.name}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(b.createdAt).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <p className="text-sm text-muted-foreground">
              No bases yet. Click <span className="font-medium text-primary">New base</span> in the
              sidebar to create one.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
