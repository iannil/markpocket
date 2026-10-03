'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc/client';
import { fmtTime, fmtVal } from '@/lib/format';

export function CellHistoryDock({
  cell,
  fieldName,
  rowNumber,
  currentValue,
  onRestore,
  onClose,
  onCollapse,
}: {
  cell: { recordId: string; fieldId: string };
  fieldName: string;
  rowNumber: number;
  currentValue: unknown;
  onRestore: (value: unknown) => void;
  onClose: () => void;
  /** Collapse to the narrow rail (grid keeps its width). */
  onCollapse?: () => void;
}) {
  const [showDiff, setShowDiff] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<{ value: unknown } | null>(null);
  const {
    data: history,
    isLoading,
    isError,
    refetch,
  } = trpc.history.list.useQuery({
    recordId: cell.recordId,
    fieldId: cell.fieldId,
  });

  return (
    // Sibling panel (w-72 spacing token) — never overlays the grid, so it can't
    // cover the cell being edited.
    <aside className="flex h-full w-72 flex-none flex-col overflow-hidden rounded-md border border-border bg-background">
      <div className="flex items-start justify-between border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {fieldName} · row {rowNumber}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {fmtVal(currentValue)}
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="rounded px-1 text-muted-foreground hover:text-foreground"
              title="Collapse (keep selection)"
              aria-label="Collapse cell history"
            >
              »
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded px-1 text-muted-foreground hover:text-foreground"
            title="Close (Esc)"
            aria-label="Close cell history"
          >
            ×
          </button>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : isError ? (
          // A failed load must not masquerade as "no history" — that would
          // read as "this cell was never edited".
          <div className="space-y-2 text-xs text-destructive">
            <p>Failed to load history.</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : !history || history.length === 0 ? (
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
                onClick={() => setRestoreTarget({ value: h.newValue })}
                className="mt-0.5 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                restore
              </button>
              <button
                onClick={() => setShowDiff(showDiff === h.id ? null : h.id)}
                className="ml-2 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {showDiff === h.id ? 'hide diff' : 'diff'}
              </button>
              {showDiff === h.id && (
                <div className="mt-1 rounded bg-muted p-1.5 font-mono text-[10px]">
                  <div className="text-muted-foreground">Old: {fmtVal(h.oldValue)}</div>
                  <div className="text-foreground">New: {fmtVal(h.newValue)}</div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(o) => !o && setRestoreTarget(null)}
        title="Restore this version?"
        description="The current value is kept in history, so you can always restore back."
        confirmLabel="Restore"
        onConfirm={() => {
          if (restoreTarget) onRestore(restoreTarget.value);
          setRestoreTarget(null);
        }}
      />
    </aside>
  );
}
