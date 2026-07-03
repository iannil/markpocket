'use client';

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

export function CellHistoryDock({
  cell,
  fieldName,
  rowNumber,
  currentValue,
  onRestore,
  onClose,
}: {
  cell: { recordId: string; fieldId: string };
  fieldName: string;
  rowNumber: number;
  currentValue: unknown;
  onRestore: (value: unknown) => void;
  onClose: () => void;
}) {
  const { data: history } = trpc.history.list.useQuery({
    recordId: cell.recordId,
    fieldId: cell.fieldId,
  });

  return (
    <div className="absolute right-0 top-0 z-10 flex h-full w-[280px] flex-col border-l border-border bg-background">
      <div className="flex items-start justify-between border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {fieldName} · row {rowNumber}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {fmtVal(currentValue)}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded px-1 text-muted-foreground hover:text-foreground"
          title="Close (Esc)"
        >
          ×
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {!history || history.length === 0 ? (
          <p className="text-xs text-muted-foreground">No changes recorded.</p>
        ) : (
          history.map((h) => (
            <div key={h.id} className="border-l-2 border-border pl-2">
              <div className="text-xs font-medium">
                {fmtVal(h.oldValue)} → {fmtVal(h.newValue)}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span>{h.changedByName ?? h.changedByEmail ?? 'unknown'}</span>
                <span>·</span>
                <span>{fmtTime(h.changedAt)}</span>
              </div>
              <button
                onClick={() => onRestore(h.newValue)}
                className="mt-0.5 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                restore
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
