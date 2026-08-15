'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { CellRenderer } from '@/app/bases/[baseId]/tables/[tableId]/cell-renderers';
import type { FieldType } from '@/lib/field-types';

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const { data: baseInfo } = trpc.publicShare.getBase.useQuery({ token });
  const { data: tables } = trpc.publicShare.getTables.useQuery({ token });
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const { data: tableData } = trpc.publicShare.getRecords.useQuery(
    { token, tableId: activeTableId ?? '' },
    { enabled: Boolean(activeTableId) },
  );

  useEffect(() => {
    if (tables && tables.length > 0 && !activeTableId) {
      setActiveTableId(tables[0]!.id);
    }
  }, [tables, activeTableId]);

  if (baseInfo === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Link expired or not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This share link may have expired or been removed.
          </p>
        </div>
      </div>
    );
  }

  if (!baseInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-6xl bg-background">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-base">{baseInfo.icon ?? '📁'}</span>
          <h1 className="text-sm font-semibold">{baseInfo.name}</h1>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            shared view
          </span>
        </div>
      </header>

      {tables && tables.length > 1 && (
        <div className="flex gap-1 border-b border-border px-4 py-2">
          {tables.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTableId(t.id)}
              className={`rounded-md px-2.5 py-1 text-xs ${
                activeTableId === t.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {tableData && (
        <div className="overflow-auto p-4">
          <table className="markpocket-grid w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40">
                <th className="w-10 border-b border-border p-1 text-xs text-muted-foreground">#</th>
                {tableData.fields.map((f: { id: string; name: string; type: string }) => (
                  <th
                    key={f.id}
                    className="border-b border-l border-border p-2 text-left text-xs font-medium text-foreground"
                  >
                    <div>{f.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{f.type}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData.records.map(
                (rec: { id: string; cells: Record<string, unknown> }, i: number) => (
                  <tr key={rec.id} className="group">
                    <td className="border-b border-border px-2 text-center text-xs text-muted-foreground">
                      {i + 1}
                    </td>
                    {tableData.fields.map((f) => (
                      <td key={f.id} className="border-b border-l border-border p-0">
                        <CellRenderer
                          field={{
                            id: f.id,
                            name: f.name,
                            type: f.type as FieldType,
                            options: (f.options ?? {}) as Record<string, unknown>,
                          }}
                          record={rec}
                          users={[]}
                          isEditing={false}
                          draft=""
                          onDraftChange={() => {}}
                          onStartEdit={() => {}}
                          onCommitEdit={() => {}}
                          onUpsert={() => {}}
                          readOnly
                        />
                      </td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
