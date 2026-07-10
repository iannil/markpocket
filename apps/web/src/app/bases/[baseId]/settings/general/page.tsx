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
import { Slot } from '@/lib/plugins/ui-slot-client';
import { toast } from '@/lib/toast';
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
      toast.success('Base renamed');
    },
  });
  const del = trpc.base.delete.useMutation({
    onSuccess: () => {
      void utils.base.list.invalidate();
      toast.success('Base deleted');
      router.push('/bases');
    },
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const importMut = trpc.csv.import.useMutation();

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
        <h2 className="mb-2 text-sm font-semibold">Tables (CSV)</h2>
        <Slot
          id="table-tools"
          ctx={{
            tables: tables.data ?? [],
            onExport: async (tableId: string) => {
              const { csv } = await utils.client.csv.export.query({ tableId });
              const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = `${tableId}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            },
            onImport: async (tableId: string, file: File) => {
              const csvText = await file.text();
              const { imported } = await importMut.mutateAsync({ tableId, csvText });
              toast.success(`Imported ${imported} rows`);
              void utils.table.list.invalidate({ baseId });
            },
          }}
        />
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
