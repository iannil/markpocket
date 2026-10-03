'use client';

import { useState } from 'react';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { trpc } from '@/lib/trpc/client';

interface ViewLike {
  id: string;
  name: string;
  type: string;
}

export function ViewTabs({
  tableId,
  views,
  activeViewId,
  onSelect,
  readOnly = false,
}: {
  tableId: string;
  views: ViewLike[];
  activeViewId: string | null;
  onSelect: (id: string) => void;
  readOnly?: boolean;
}) {
  const utils = trpc.useUtils();
  const create = trpc.view.create.useMutation({
    onSuccess: () => utils.view.list.invalidate({ tableId }),
    onError: (err) => toast.error(err.message),
  });
  const rename = trpc.view.rename.useMutation({
    onSuccess: () => utils.view.list.invalidate({ tableId }),
    onError: (err) => toast.error(err.message),
  });
  const remove = trpc.view.delete.useMutation({
    onSuccess: () => utils.view.list.invalidate({ tableId }),
    onError: (err) => toast.error(err.message),
  });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  // Inline rename (spec §7.2: inline over prompt/popover): the tab itself
  // swaps to an input; Enter commits, Esc or blur cancels.
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  function commitRename() {
    const trimmed = renaming?.name.trim();
    if (renaming && trimmed && trimmed !== views.find((v) => v.id === renaming.id)?.name) {
      rename.mutate({ id: renaming.id, name: trimmed });
    }
    setRenaming(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border">
      {views.map((v) => {
        const isRenaming = renaming?.id === v.id;
        return (
          <div
            key={v.id}
            className={`group flex items-center border-b-2 px-2 py-1 text-sm ${
              v.id === activeViewId
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {isRenaming ? (
              <Input
                autoFocus
                value={renaming.name}
                onChange={(e) => setRenaming({ id: v.id, name: e.target.value })}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenaming(null);
                }}
                className="h-6 w-28 px-1 text-sm"
                aria-label="View name"
              />
            ) : (
              <button
                onClick={() => onSelect(v.id)}
                onDoubleClick={() => {
                  if (!readOnly) setRenaming({ id: v.id, name: v.name });
                }}
                title="Click to switch, double-click to rename"
              >
                {v.name}
              </button>
            )}
            {views.length > 1 && !readOnly && (
              <button
                className="ml-1 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => setDeleteTarget({ id: v.id, name: v.name })}
                title="Delete view"
                aria-label={`Delete view ${v.name}`}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      {readOnly ? null : adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            create.mutate({ tableId, name: name.trim() }, { onSuccess: (nv) => onSelect(nv.id) });
            setAdding(false);
            setName('');
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setAdding(false);
              setName('');
            }}
            className="h-7 w-32"
            placeholder="View name"
          />
        </form>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 rounded-md text-muted-foreground hover:text-foreground"
          onClick={() => setAdding(true)}
        >
          + view
        </Button>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete view “${deleteTarget?.name ?? ''}”?`}
        description="The view's saved filter, sort and grouping settings are deleted with it. Records are not affected."
        confirmLabel="Delete view"
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate({ id: deleteTarget.id })}
      />
    </div>
  );
}
