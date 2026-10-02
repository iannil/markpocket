'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { trpc } from '@/lib/trpc/client';

interface GroupLike {
  key: string | null;
  records: Array<{ id: string; cells: Record<string, unknown> }>;
}
interface FieldRow {
  id: string;
  type: string;
}

export interface LinkTableData {
  /** Browsable records with their primary-field label, for the editor popover. */
  records: Array<{ id: string; label: string }>;
  labelById: Map<string, string>;
}

const EMPTY_TABLES: ReadonlyMap<string, LinkTableData> = new Map();
const Ctx = createContext<ReadonlyMap<string, LinkTableData>>(EMPTY_TABLES);
// Test seam: the editor reads its browsable records from this context, so
// tests can supply a canned map without standing up the tRPC-backed provider.
export const LinkTablesContext = Ctx;

// One subscription per target table for the whole grid — link cells used to
// mount a field.list + record.list useQuery EACH (thousands of subscribers).
export function LinkTablesProvider({
  tableIds,
  children,
}: {
  tableIds: string[];
  children: ReactNode;
}) {
  // Two homogeneous useQueries arrays — mixing procedures in one call breaks
  // tRPC's descriptor typing.
  const fieldsResults = trpc.useQueries((qc) =>
    tableIds.map((id) => qc.field.list({ tableId: id })),
  );
  const recordsResults = trpc.useQueries((qc) =>
    tableIds.map((id) => qc.record.list({ tableId: id, limit: 1000 })),
  );

  const value = useMemo(() => {
    const map = new Map<string, LinkTableData>();
    tableIds.forEach((id, i) => {
      const fields = (fieldsResults[i]?.data ?? []) as FieldRow[];
      const recordData = recordsResults[i]?.data;
      const primary = fields.find((f) => f.type === 'text') ?? fields[0];
      const records = ((recordData?.groups ?? []) as GroupLike[])
        .flatMap((g) => g.records)
        .map((r) => ({
          id: r.id,
          label: primary ? String(r.cells[primary.id] ?? r.id.slice(0, 8)) : r.id.slice(0, 8),
        }));
      map.set(id, { records, labelById: new Map(records.map((r) => [r.id, r.label])) });
    });
    return map;
    // The result arrays are rebuilt per render by useQueries; mapping 1k rows
    // is cheap enough that stabilizing further isn't worth the complexity.
  }, [fieldsResults, recordsResults, tableIds]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLinkTable(targetTableId: string | undefined): LinkTableData | null {
  const tables = useContext(Ctx);
  return targetTableId ? (tables.get(targetTableId) ?? null) : null;
}

function labelFor(table: LinkTableData | null, id: string): string {
  return table?.labelById.get(id) ?? id.slice(0, 8);
}

// Pure display: chips for the linked records' labels.
export function LinkCellDisplay({
  recordIds,
  targetTableId,
}: {
  recordIds: string[];
  targetTableId?: string;
}) {
  const table = useLinkTable(targetTableId);
  if (recordIds.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-1">
      {recordIds.slice(0, 2).map((id) => (
        <span key={id} className="max-w-32 truncate rounded bg-muted px-1.5 py-0.5 text-xs">
          {labelFor(table, id)}
        </span>
      ))}
      {recordIds.length > 2 ? (
        <span className="text-xs text-muted-foreground">+{recordIds.length - 2}</span>
      ) : null}
    </span>
  );
}

// Editor: mounted only while the cell is being edited. Every toggle writes
// through immediately; closing the popover ends the edit session.
export function LinkCellEditor({
  recordIds,
  targetTableId,
  onWrite,
  onClose,
}: {
  recordIds: string[];
  targetTableId?: string;
  onWrite: (ids: string[]) => void;
  onClose: () => void;
}) {
  const table = useLinkTable(targetTableId);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(true);
  // Selection lives in LOCAL state, seeded once when the editor mounts
  // (unmounting on close destroys it). Reading the rendered `recordIds`
  // prop raced the optimistic patch: onWrite → onMutate only lands the new
  // value in the record.list cache after cancelQueries resolves, so a
  // second quick toggle still computed from the pre-first-toggle array and
  // silently dropped the first pick. Local state is the source of truth for
  // both the checkboxes and every write.
  const [selected, setSelected] = useState<string[]>(recordIds);

  const allRecords = useMemo(() => table?.records ?? [], [table]);
  const visibleRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRecords;
    return allRecords.filter((r) => r.label.toLowerCase().includes(q));
  }, [allRecords, search]);

  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    onWrite(next);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) onClose();
      }}
    >
      <PopoverTrigger className="flex h-full w-full items-center px-2.5 text-left text-sm">
        {selected.length > 0 ? (
          <span className="truncate">{selected.map((id) => labelFor(table, id)).join(', ')}</span>
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
            {!table
              ? 'Loading…'
              : allRecords.length === 0
                ? 'No records in target table.'
                : 'No matches.'}
          </p>
        )}
        {visibleRecords.map((r) => (
          <label
            key={r.id}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted"
          >
            <input
              type="checkbox"
              checked={selected.includes(r.id)}
              onChange={() => toggle(r.id)}
            />
            <span className="truncate">{r.label}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
