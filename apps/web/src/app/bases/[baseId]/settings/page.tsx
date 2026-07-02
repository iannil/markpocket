'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { EmptyState } from '@/components/empty-state';
import { trpc } from '@/lib/trpc/client';

export default function TablesTab() {
  const { baseId } = useParams<{ baseId: string }>();
  const utils = trpc.useUtils();
  const { data: tables, isLoading } = trpc.table.list.useQuery({ baseId });
  const [name, setName] = useState('');
  const create = trpc.table.create.useMutation({
    onSuccess: () => {
      void utils.table.list.invalidate({ baseId });
      setName('');
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (n) create.mutate({ baseId, name: n });
  }

  if (isLoading) return <div className="h-8 animate-pulse rounded bg-muted" />;

  return (
    <div className="space-y-4">
      {tables && tables.length > 0 ? (
        <ul className="border-t border-border">
          {tables.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between border-b border-border py-2.5"
            >
              <span className="text-sm font-medium">{t.name}</span>
              <Link
                href={`/bases/${baseId}/tables/${t.id}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                open →
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No tables yet" description="Create the first table below." />
      )}
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <input
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
          {create.isPending ? '···' : '+ add table'}
        </button>
      </form>
      {create.error && <p className="text-xs text-destructive">{create.error.message}</p>}
    </div>
  );
}
