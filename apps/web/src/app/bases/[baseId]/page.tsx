'use client';

import type { FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

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
  const [name, setName] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate({ baseId, name: name.trim() });
    setName('');
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">{base?.name ?? 'Base'}</h1>

      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New table name"
          className="max-w-xs"
        />
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          Create table
        </Button>
      </form>

      <ul className="divide-y rounded border">
        {tables?.map((t) => (
          <li key={t.id}>
            <Link
              href={`/bases/${baseId}/tables/${t.id}`}
              className="flex items-center justify-between p-3 hover:bg-muted/50"
            >
              <span>{t.name}</span>
              <span className="text-sm text-muted-foreground">grid →</span>
            </Link>
          </li>
        ))}
        {tables?.length === 0 && (
          <li className="p-4 text-sm text-muted-foreground">No tables yet.</li>
        )}
      </ul>
    </div>
  );
}
