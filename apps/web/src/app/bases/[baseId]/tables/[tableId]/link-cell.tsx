'use client';

import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { trpc } from '@/lib/trpc/client';

interface GroupLike {
  key: string | null;
  records: Array<{ id: string; cells: Record<string, unknown> }>;
}

export function LinkCell({
  recordIds,
  targetTableId,
  onChange,
}: {
  recordIds: string[];
  targetTableId?: string;
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const { data: fieldsData } = trpc.field.list.useQuery(
    { tableId: targetTableId! },
    { enabled: !!targetTableId },
  );
  const { data: recordsData } = trpc.record.list.useQuery(
    { tableId: targetTableId!, limit: 1000 },
    { enabled: !!targetTableId },
  );

  const targetFields = fieldsData ?? [];
  const primaryField = targetFields.find((f) => f.type === 'text') ?? targetFields[0];
  const allRecords = useMemo(
    () => (recordsData?.groups ?? []).flatMap((g: GroupLike) => g.records),
    [recordsData],
  );

  const labelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of allRecords) {
      m.set(
        r.id,
        primaryField ? String(r.cells[primaryField.id] ?? r.id.slice(0, 8)) : r.id.slice(0, 8),
      );
    }
    return m;
  }, [allRecords, primaryField]);
  const visibleRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRecords;
    return allRecords.filter((r) => labelById.get(r.id)?.toLowerCase().includes(q));
  }, [allRecords, search, labelById]);

  function toggle(id: string) {
    const next = recordIds.includes(id) ? recordIds.filter((x) => x !== id) : [...recordIds, id];
    onChange(next);
  }

  return (
    <Popover>
      <PopoverTrigger className="flex h-7 w-full items-center px-2 text-left text-sm">
        {recordIds.length > 0 ? (
          <span className="truncate">
            {recordIds.map((id) => labelById.get(id) ?? id.slice(0, 8)).join(', ')}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="max-h-64 w-64 overflow-auto border-border p-1">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search records…"
          className="mb-1 h-7 text-xs"
        />
        {visibleRecords.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            {allRecords.length === 0 ? 'No records in target table.' : 'No matches.'}
          </p>
        )}
        {visibleRecords.map((r) => (
          <label
            key={r.id}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted"
          >
            <input
              type="checkbox"
              checked={recordIds.includes(r.id)}
              onChange={() => toggle(r.id)}
            />
            <span className="truncate">{labelById.get(r.id) ?? r.id.slice(0, 8)}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
