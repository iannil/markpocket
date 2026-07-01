'use client';

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
  const { data: fieldsData } = trpc.field.list.useQuery(
    { tableId: targetTableId! },
    { enabled: !!targetTableId },
  );
  const { data: recordsData } = trpc.record.list.useQuery(
    { tableId: targetTableId! },
    { enabled: !!targetTableId },
  );

  const targetFields = fieldsData ?? [];
  const primaryField = targetFields.find((f) => f.type === 'text') ?? targetFields[0];
  const allRecords = (recordsData?.groups ?? []).flatMap((g: GroupLike) => g.records);

  function labelFor(id: string): string {
    const rec = allRecords.find((r) => r.id === id);
    if (!rec || !primaryField) return id.slice(0, 8);
    return String(rec.cells[primaryField.id] ?? id.slice(0, 8));
  }

  function toggle(id: string) {
    const next = recordIds.includes(id) ? recordIds.filter((x) => x !== id) : [...recordIds, id];
    onChange(next);
  }

  return (
    <Popover>
      <PopoverTrigger className="flex h-7 w-full items-center px-2 text-left text-sm">
        {recordIds.length > 0 ? (
          <span className="truncate">{recordIds.map(labelFor).join(', ')}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="max-h-64 w-64 overflow-auto p-1">
        {allRecords.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">No records in target table.</p>
        )}
        {allRecords.map((r) => (
          <label
            key={r.id}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
          >
            <input
              type="checkbox"
              checked={recordIds.includes(r.id)}
              onChange={() => toggle(r.id)}
            />
            <span className="truncate">
              {primaryField
                ? String(r.cells[primaryField.id] ?? r.id.slice(0, 8))
                : r.id.slice(0, 8)}
            </span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
