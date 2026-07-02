'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { EmptyState } from '@/components/empty-state';
import { trpc } from '@/lib/trpc/client';

export default function BasePage() {
  const { baseId } = useParams<{ baseId: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: tables, isLoading } = trpc.table.list.useQuery({ baseId });

  const firstTableId = tables?.[0]?.id;
  useEffect(() => {
    if (firstTableId) {
      router.replace(`/bases/${baseId}/tables/${firstTableId}`);
    }
  }, [firstTableId, baseId, router]);

  const create = trpc.table.create.useMutation({
    onSuccess: (row) => {
      void utils.table.list.invalidate({ baseId });
      router.replace(`/bases/${baseId}/tables/${row.id}`);
    },
  });
  const [name, setName] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate({ baseId, name: trimmed });
  }

  // Loading, or tables exist and redirect is in flight.
  if (isLoading || firstTableId) {
    return (
      <div className="flex-1 p-6">
        <div className="mx-auto max-w-md">
          <div className="h-8 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <EmptyState
        title="No tables yet"
        description="Create the first table in this base."
        action={
          <form onSubmit={onSubmit} className="flex items-center gap-2">
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Table name"
              className="h-8 w-56 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={create.isPending}
              className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {create.isPending ? '···' : 'create'}
            </button>
          </form>
        }
      />
    </div>
  );
}
