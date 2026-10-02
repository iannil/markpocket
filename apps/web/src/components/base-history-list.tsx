// apps/web/src/components/base-history-list.tsx
'use client';

import { useParams } from 'next/navigation';

import { fmtTime, fmtVal } from '@/lib/format';
import { trpc } from '@/lib/trpc/client';

interface HistoryRow {
  id: string;
  changedAt: string;
  changedByName: string | null;
  changedByEmail: string | null;
  tableName: string;
  fieldName: string;
  oldValue?: unknown;
  newValue?: unknown;
}

// Shared by the standalone /bases/<id>/history page and the settings tab so
// both render the same list without one redirecting out of its layout.
export function BaseHistoryList() {
  const { baseId } = useParams<{ baseId: string }>();
  const { data, isLoading } = trpc.history.listByBase.useQuery({ baseId });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  if (!data || data.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No changes recorded yet.</p>;
  }

  return (
    <div className="space-y-1">
      {data.rows.map((r: HistoryRow) => (
        <div key={r.id} className="flex items-center gap-3 border-b border-border py-2 text-sm">
          <span className="w-24 shrink-0 text-xs text-muted-foreground">
            {fmtTime(r.changedAt)}
          </span>
          <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
            {r.changedByName ?? r.changedByEmail ?? 'unknown'}
          </span>
          <span className="w-24 shrink-0 text-xs text-muted-foreground">{r.tableName}</span>
          <span className="w-24 shrink-0 text-xs font-medium">{r.fieldName}</span>
          <span className="min-w-0 truncate font-mono text-xs">
            {fmtVal(r.oldValue)} → {fmtVal(r.newValue)}
          </span>
        </div>
      ))}
    </div>
  );
}
