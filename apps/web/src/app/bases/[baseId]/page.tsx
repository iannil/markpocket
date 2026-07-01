'use client';

import { Hash, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc/client';

export default function BasePage() {
  const { baseId } = useParams<{ baseId: string }>();
  const utils = trpc.useUtils();
  const { data: base } = trpc.base.get.useQuery({ id: baseId });
  const { data: tables } = trpc.table.list.useQuery({ baseId });
  const create = trpc.table.create.useMutation({
    onSuccess: () => utils.table.list.invalidate({ baseId }),
  });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate({ baseId, name: name.trim() });
    setAdding(false);
    setName('');
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{base?.name ?? 'Base'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tables?.length ?? 0} table{(tables?.length ?? 0) !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="space-y-2">
          {tables?.map((t) => (
            <Link
              key={t.id}
              href={`/bases/${baseId}/tables/${t.id}`}
              className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-all hover:border-primary/40 hover:shadow-md hover:shadow-primary/5"
            >
              <Hash className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
              <span className="font-medium">{t.name}</span>
              <span className="ml-auto text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                Open →
              </span>
            </Link>
          ))}
          {tables?.length === 0 && !adding && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No tables yet. Create one below.
            </div>
          )}
        </div>

        <div>
          {adding ? (
            <form onSubmit={onSubmit} className="flex gap-2">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  setAdding(false);
                  setName('');
                }}
                placeholder="Table name"
                className="max-w-xs border-border bg-card"
              />
              <Button type="submit" size="sm">
                Create
              </Button>
            </form>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> New table
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
