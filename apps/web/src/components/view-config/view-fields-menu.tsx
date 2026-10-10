'use client';

import { useRef } from 'react';
import { trpc } from '@/lib/trpc/client';
import { toast } from '@/lib/toast';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface FieldLike {
  id: string;
  name: string;
}

export function ViewFieldsMenu({
  tableId,
  readOnly = false,
  fields,
  hiddenFields,
  onChange,
}: {
  tableId: string;
  readOnly?: boolean;
  fields: FieldLike[];
  hiddenFields: string[];
  onChange: (ids: string[]) => void;
}) {
  const utils = trpc.useUtils();
  const moving = useRef(false);
  const reorder = trpc.field.reorder.useMutation();
  async function move(index: number, offset: number) {
    if (readOnly || moving.current || index + offset < 0 || index + offset >= fields.length) return;
    moving.current = true;
    const ids = fields.map((f) => f.id);
    [ids[index], ids[index + offset]] = [ids[index + offset]!, ids[index]!];
    try {
      await reorder.mutateAsync({ tableId, fieldIds: ids });
      await utils.field.list.invalidate({ tableId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reorder fields');
      await utils.field.list.invalidate({ tableId });
    } finally {
      moving.current = false;
    }
  }
  function toggle(id: string, visible: boolean) {
    onChange(visible ? hiddenFields.filter((x) => x !== id) : [...hiddenFields, id]);
  }

  return (
    <Popover>
      <PopoverTrigger className="flex h-7 items-center rounded-md border border-border px-2 text-sm hover:bg-muted">
        Fields
      </PopoverTrigger>
      <PopoverContent className="w-56 border-border">
        <div className="space-y-0.5">
          {fields.map((f, index) => (
            <div
              key={f.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-muted"
            >
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={!hiddenFields.includes(f.id)}
                  onChange={(e) => toggle(f.id, e.target.checked)}
                />
                <span className="truncate">{f.name}</span>
              </label>
              <button
                type="button"
                aria-label="Move field up"
                title={`Move ${f.name} up`}
                disabled={readOnly || reorder.isPending || index === 0}
                onClick={() => void move(index, -1)}
                className="rounded px-1 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move field down"
                title={`Move ${f.name} down`}
                disabled={readOnly || reorder.isPending || index === fields.length - 1}
                onClick={() => void move(index, 1)}
                className="rounded px-1 disabled:opacity-30"
              >
                ↓
              </button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
