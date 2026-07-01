'use client';

import { Clock } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { trpc } from '@/lib/trpc/client';

function fmtVal(v: unknown): string {
  if (v == null) return '(empty)';
  if (typeof v === 'string') return v;
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
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

export function CellHistory({ recordId, fieldId }: { recordId: string; fieldId: string }) {
  const { data: history } = trpc.history.list.useQuery({ recordId, fieldId });

  return (
    <Popover>
      <PopoverTrigger className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100">
        <Clock className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="space-y-1">
          <p className="pb-1 text-xs font-medium text-muted-foreground">
            History {history && history.length > 0 ? `(${history.length})` : ''}
          </p>
          {!history || history.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">No changes recorded.</p>
          ) : (
            history.map((h) => (
              <div key={h.id} className="border-l-2 border-border pl-2 py-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium">
                    {fmtVal(h.oldValue)} → {fmtVal(h.newValue)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{h.changedByName ?? h.changedByEmail ?? 'unknown'}</span>
                  <span>·</span>
                  <span>{fmtTime(h.changedAt)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
