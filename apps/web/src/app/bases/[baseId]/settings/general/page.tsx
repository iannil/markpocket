'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { trpc } from '@/lib/trpc/client';

export default function GeneralTab() {
  const { baseId } = useParams<{ baseId: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const base = trpc.base.get.useQuery({ id: baseId });
  const tables = trpc.table.list.useQuery({ baseId });

  const [name, setName] = useState('');
  useEffect(() => {
    if (base.data?.name) setName(base.data.name);
  }, [base.data?.name]);

  const rename = trpc.base.rename.useMutation({
    onSuccess: () => {
      void utils.base.get.invalidate({ id: baseId });
      void utils.base.list.invalidate();
    },
  });
  const del = trpc.base.delete.useMutation({
    onSuccess: () => {
      void utils.base.list.invalidate();
      router.push('/bases');
    },
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 text-sm font-semibold">Base name</h2>
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 w-64 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={() => name.trim() && rename.mutate({ id: baseId, name: name.trim() })}
            disabled={rename.isPending}
            className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Export (CSV)</h2>
        <ul className="border-t border-border">
          {tables.data?.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between rounded border-b border-border px-2 py-2.5 hover:bg-muted"
            >
              <span className="text-sm">{t.name}</span>
              <a
                href={`/api/export?tableId=${t.id}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                download →
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-destructive">Danger zone</h2>
        <button
          onClick={() => setConfirmOpen(true)}
          className="h-8 rounded-md border border-destructive px-3 text-sm text-destructive hover:bg-destructive/10"
        >
          Delete base
        </button>
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete base?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            这会删除该 base 下所有表、字段与记录，且不可撤销。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => del.mutate({ id: baseId })} disabled={del.isPending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
