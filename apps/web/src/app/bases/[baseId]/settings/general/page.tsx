'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { Slot } from '@/lib/plugins/ui-slot-client';
import { toast } from '@/lib/toast';
import { useBreadcrumbSetter } from '@/lib/breadcrumb-context';
import { trpc } from '@/lib/trpc/client';

const MAX_BASE_NAME = 64;

export default function GeneralTab() {
  const { baseId } = useParams<{ baseId: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const base = trpc.base.get.useQuery({ id: baseId });
  const tables = trpc.table.list.useQuery({ baseId });
  useBreadcrumbSetter([{ label: 'General' }]);

  const [name, setName] = useState('');
  // Only seed from the server while the input is pristine — after the user
  // types, a refetch (e.g. a teammate's rename arriving over realtime) must
  // not clobber the in-progress edit.
  const [nameDirty, setNameDirty] = useState(false);
  useEffect(() => {
    if (!nameDirty && base.data?.name) setName(base.data.name);
  }, [base.data?.name, nameDirty]);

  const rename = trpc.base.rename.useMutation({
    onSuccess: () => {
      void utils.base.get.invalidate({ id: baseId });
      void utils.base.list.invalidate();
      toast.success('Base renamed');
      setNameDirty(false);
    },
    onError: (err) => toast.error(err.message),
  });
  const del = trpc.base.delete.useMutation({
    onSuccess: () => {
      void utils.base.list.invalidate();
      toast.success('Base deleted');
      router.push('/bases');
    },
    onError: (err) => toast.error(err.message),
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
            maxLength={MAX_BASE_NAME}
            aria-label="Base name"
            onChange={(e) => {
              setName(e.target.value);
              setNameDirty(true);
            }}
            className="h-8 w-64 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={() => name.trim() && rename.mutate({ id: baseId, name: name.trim() })}
            disabled={rename.isPending || !name.trim()}
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
              try {
                const { csv, exported } = await utils.client.csv.export.query({
                  tableId,
                });
                const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                const a = document.createElement('a');
                a.href = url;
                const tableName = (tables.data ?? []).find((t) => t.id === tableId)?.name;
                const fileBase = tableName ? tableName.replace(/[^a-zA-Z0-9_-]/g, '_') : tableId;
                const safeTableId = tableId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
                a.download = `${fileBase}-${safeTableId}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success(`Exported ${exported} records`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Export failed');
              }
            },
            onImport: async (tableId: string, file: File) => {
              try {
                const csvText = await file.text();
                const { imported, skippedHeaders, emptyCellRows } = await importMut.mutateAsync({
                  tableId,
                  csvText,
                });
                const notes: string[] = [`Imported ${imported} rows`];
                if (skippedHeaders.length > 0)
                  notes.push(`unmatched columns: ${skippedHeaders.join(', ')}`);
                if (emptyCellRows.length > 0)
                  notes.push(`${emptyCellRows.length} rows had no values`);
                toast.success(notes.join(' · '));
                // Grid reads records via record.list; invalidate the record query it
                // actually reads (mirrors grid-editor.tsx) so the Grid repaints.
                void utils.record.list.invalidate({ tableId });
              } catch (err) {
                // The import commits in batches — a mid-way failure still leaves the
                // already-imported rows in the table, so refresh the grid too.
                // Matched via the stable contract token plugin-csv's server
                // appends to partial-failure messages; matching prose (e.g.
                // "were imported") breaks the moment the wording changes.
                if (err instanceof Error && /\[partial-import\]/.test(err.message)) {
                  void utils.record.list.invalidate({ tableId });
                }
                toast.error(err instanceof Error ? err.message : 'Import failed');
              }
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

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete base?"
        description="This permanently deletes every table, field, and record in this base. There is no undo."
        confirmLabel="Delete base"
        pending={del.isPending}
        onConfirm={() => del.mutate({ id: baseId })}
      />
    </div>
  );
}
