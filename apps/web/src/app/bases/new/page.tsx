'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { toast } from '@/lib/toast';
import { trpc } from '@/lib/trpc/client';

export default function NewBasePage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  const create = trpc.base.create.useMutation({
    onSuccess: (row) => {
      void utils.base.list.invalidate();
      router.push(`/bases/${row.id}`);
    },
    onError: (err) => toast.error(err.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate({ name: trimmed });
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <form onSubmit={onSubmit} className="w-[360px] space-y-3">
        <div className="mb-2">
          <h1 className="text-lg font-semibold tracking-tight">New base</h1>
          <p className="text-xs text-muted-foreground">Give it a name to get started.</p>
        </div>

        <label className="block">
          <span className="text-xs text-muted-foreground">name</span>
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customer DB"
            className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {create.error && <p className="text-xs text-destructive">{create.error.message}</p>}

        <button
          type="submit"
          disabled={create.isPending}
          className="h-8 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {create.isPending ? '···' : 'create base'}
        </button>

        <p className="pt-1 text-xs text-muted-foreground">
          <Link href="/bases" className="text-foreground underline underline-offset-2">
            cancel
          </Link>
        </p>
      </form>
    </div>
  );
}
