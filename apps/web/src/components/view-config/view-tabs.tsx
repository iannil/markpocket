'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
}: {
  tableId: string;
  views: ViewLike[];
  activeViewId: string | null;
  onSelect: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const create = trpc.view.create.useMutation({
    onSuccess: () => utils.view.list.invalidate({ tableId }),
  });
  const rename = trpc.view.rename.useMutation({
    onSuccess: () => utils.view.list.invalidate({ tableId }),
  });
  const remove = trpc.view.delete.useMutation({
    onSuccess: () => utils.view.list.invalidate({ tableId }),
  });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border">
      {views.map((v) => (
        <div
          key={v.id}
          className={`group flex items-center border-b-2 px-2 py-1 text-sm ${
            v.id === activeViewId
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <button
            onClick={() => onSelect(v.id)}
            onDoubleClick={() => {
              const next = window.prompt('Rename view', v.name);
              if (next && next.trim()) rename.mutate({ id: v.id, name: next.trim() });
            }}
            title="Click to switch, double-click to rename"
          >
            {v.name}
          </button>
          {views.length > 1 && (
            <button
              className="ml-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
              onClick={() => {
                if (window.confirm(`Delete view "${v.name}"?`)) remove.mutate({ id: v.id });
              }}
              title="Delete view"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {adding ? (
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
    </div>
  );
}
