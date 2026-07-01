'use client';

import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import type { SortSpec } from '@/lib/view-ast';

interface FieldLike {
  id: string;
  name: string;
}

export function SortMenu({
  fields,
  sort,
  onChange,
}: {
  fields: FieldLike[];
  sort: SortSpec[] | undefined;
  onChange: (s: SortSpec[] | undefined) => void;
}) {
  const list = sort ?? [];
  function update(i: number, patch: Partial<SortSpec>) {
    onChange(list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function remove(i: number) {
    const next = list.filter((_, idx) => idx !== i);
    onChange(next.length ? next : undefined);
  }
  function add() {
    const f = fields[0];
    if (f) onChange([...list, { fieldId: f.id, direction: 'asc' }]);
  }

  return (
    <Popover>
      <PopoverTrigger className="rounded border px-2 py-1 text-sm hover:bg-muted/50">
        Sort{list.length > 0 ? ` (${list.length})` : ''}
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-1">
          {list.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <Select
                value={s.fieldId}
                onValueChange={(fid) => {
                  if (fid) update(i, { fieldId: fid });
                }}
              >
                <SelectTrigger className="h-7 flex-1">
                  {fields.find((f) => f.id === s.fieldId)?.name ?? 'Field'}
                </SelectTrigger>
                <SelectContent>
                  {fields.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title={s.direction === 'asc' ? 'Ascending' : 'Descending'}
                onClick={() => update(i, { direction: s.direction === 'asc' ? 'desc' : 'asc' })}
              >
                {s.direction === 'asc' ? (
                  <ArrowUp className="h-3.5 w-3.5" />
                ) : (
                  <ArrowDown className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(i)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={add}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add sort
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
