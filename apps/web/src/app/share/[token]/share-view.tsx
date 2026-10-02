// apps/web/src/app/share/[token]/share-view.tsx
'use client';

import { useEffect, useState } from 'react';
import { Folder } from 'lucide-react';

import type { inferRouterOutputs } from '@trpc/server';

import { trpc } from '@/lib/trpc/client';
import type { AppRouter } from '@/server/trpc/router';
import { CellRenderer } from '@/app/bases/[baseId]/tables/[tableId]/cell-renderers';
import type { FieldType } from '@/lib/field-types';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ShareRecords = NonNullable<RouterOutputs['publicShare']['getRecords']>;
type ShareRecord = ShareRecords['records'][number];

// Page size for offset paging (getRecords.offset) — "Show more" appends the
// next page instead of growing the limit, so page cost stays constant.
const PAGE_SIZE = 100;

export interface ShareViewData {
  baseInfo: RouterOutputs['publicShare']['getBase'];
  tables: RouterOutputs['publicShare']['getTables'];
}

export function ShareView({ token, initial }: { token: string; initial: ShareViewData }) {
  const { data: baseInfo } = trpc.publicShare.getBase.useQuery(
    { token },
    {
      initialData: initial.baseInfo,
    },
  );
  const { data: tables } = trpc.publicShare.getTables.useQuery(
    { token },
    {
      initialData: initial.tables,
    },
  );
  const utils = trpc.useUtils();
  const [activeTableId, setActiveTableId] = useState<string | null>(initial.tables[0]?.id ?? null);
  // First page via the query hook (keeps the existing loading semantics);
  // further pages are appended imperatively with offset paging.
  const { data: firstPage, isFetching } = trpc.publicShare.getRecords.useQuery(
    { token, tableId: activeTableId ?? '', limit: PAGE_SIZE, offset: 0 },
    { enabled: Boolean(activeTableId) },
  );
  const [extraRecords, setExtraRecords] = useState<ShareRecord[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  // Switching tables resets the accumulated pages back to the first page.
  useEffect(() => {
    setExtraRecords([]);
  }, [activeTableId]);

  async function loadMore() {
    if (!activeTableId || !firstPage) return;
    setLoadingMore(true);
    try {
      const page = await utils.client.publicShare.getRecords.query({
        token,
        tableId: activeTableId,
        limit: PAGE_SIZE,
        offset: firstPage.records.length + extraRecords.length,
      });
      if (page) {
        // Dedupe by id: a record inserted between fetches can shift offsets
        // and hand us a row we already show.
        const seen = new Set([...firstPage.records, ...extraRecords].map((r) => r.id));
        setExtraRecords((prev) => [...prev, ...page.records.filter((r) => !seen.has(r.id))]);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  if (!baseInfo) {
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

  const records = firstPage ? [...firstPage.records, ...extraRecords] : [];
  const total = firstPage?.total ?? 0;

  return (
    <div className="mx-auto min-h-screen max-w-6xl bg-background">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {baseInfo.icon ? (
            <span className="text-base">{baseInfo.icon}</span>
          ) : (
            <Folder className="size-4 text-muted-foreground" />
          )}
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

      {firstPage && (
        <div className="overflow-auto p-4">
          <table className="markpocket-grid w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40">
                <th className="w-10 border-b border-border p-1 text-xs text-muted-foreground">#</th>
                {firstPage.fields.map((f: { id: string; name: string; type: string }) => (
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
              {records.map((rec: { id: string; cells: Record<string, unknown> }, i: number) => (
                <tr key={rec.id} className="group">
                  <td className="border-b border-border px-2 text-center text-xs text-muted-foreground">
                    {i + 1}
                  </td>
                  {firstPage.fields.map((f) => (
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
                        onUpsertCell={() => {}}
                        readOnly
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {records.length < total && (
            <button
              type="button"
              className="mt-2 rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              onClick={() => void loadMore()}
              disabled={loadingMore || isFetching}
            >
              {loadingMore ? 'Loading…' : `Show more — ${records.length} of ${total}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
