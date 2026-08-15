'use client';

import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';

function fmtVal(v: unknown): string {
  if (v == null) return '(empty)';
  if (typeof v === 'string') return v === '' ? '(empty)' : v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === 'object' && v !== null && '__error' in v) {
    return `error: ${(v as { __error: string }).__error}`;
  }
  return JSON.stringify(v).slice(0, 40);
}

function fmtTime(iso: Date | string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

export default function BaseHistoryPage() {
  const { baseId } = useParams<{ baseId: string }>();
  const { data, isLoading } = trpc.history.listByBase.useQuery({ baseId });

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h1 className="text-lg font-semibold">History</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        All changes across this base, newest first.
      </p>

      {isLoading ? (
        <div className="mt-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : data && data.rows.length > 0 ? (
        <div className="mt-6 space-y-1">
          {data.rows.map(
            (r: {
              id: string;
              changedAt: Date | string;
              changedByName: string | null;
              changedByEmail: string | null;
              tableName: string;
              fieldName: string;
              oldValue: unknown;
              newValue: unknown;
            }) => (
              <div
                key={r.id}
                className="flex items-center gap-3 border-b border-border py-2 text-sm"
              >
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
            ),
          )}
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">No changes recorded yet.</p>
      )}
    </div>
  );
}
