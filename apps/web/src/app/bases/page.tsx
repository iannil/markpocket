'use client';

import type { FormEvent } from 'react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc/client';

export default function BasesPage() {
  const utils = trpc.useUtils();
  const { data: bases } = trpc.base.list.useQuery();
  const create = trpc.base.create.useMutation({
    onSuccess: () => utils.base.list.invalidate(),
  });
  const [name, setName] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate({ name: name.trim() });
    setName('');
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Bases</h1>

      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New base name"
          className="max-w-xs"
        />
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          Create base
        </Button>
      </form>

      <ul className="divide-y rounded border">
        {bases?.map((b) => (
          <li key={b.id}>
            <Link
              href={`/bases/${b.id}`}
              className="flex items-center justify-between p-3 hover:bg-muted/50"
            >
              <span>
                {b.icon ? `${b.icon} ` : ''}
                {b.name}
              </span>
              <span className="text-sm text-muted-foreground">→</span>
            </Link>
          </li>
        ))}
        {bases?.length === 0 && (
          <li className="p-4 text-sm text-muted-foreground">No bases yet.</li>
        )}
      </ul>
    </div>
  );
}
