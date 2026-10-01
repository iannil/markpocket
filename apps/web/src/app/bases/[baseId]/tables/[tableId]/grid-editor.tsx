'use client';

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import {
  FieldEditorDialog,
  type FieldEditorTarget,
} from '@/components/field-config/field-editor-dialog';
import { FilterPanel } from '@/components/view-config/filter-panel';
import { SortMenu } from '@/components/view-config/sort-menu';
import { ViewFieldsMenu } from '@/components/view-config/view-fields-menu';
import { ViewTabs } from '@/components/view-config/view-tabs';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { FieldType, type SelectOption } from '@/lib/field-types';
import { cn } from '@/lib/utils';
import { CellRenderer } from './cell-renderers';
import { CellHistoryDock } from './cell-history-dock';
import { toast } from '@/lib/toast';
import { trpc } from '@/lib/trpc/client';
import type { ViewOptions } from '@/lib/view-ast';

interface FieldLike {
  id: string;
  name: string;
  type: FieldType;
  options: Record<string, unknown>;
}
interface RecordLike {
  id: string;
  cells: Record<string, unknown>;
}
interface GroupLike {
  key: string | null;
  records: RecordLike[];
}
interface ViewLike {
  id: string;
  name: string;
  type: string;
  options: Record<string, unknown>;
}

const DEFAULT_COL_WIDTH = 160;
const PAGE_SIZE = 200;
const PAGE_STEP = 500;

// memo'd cell wrapper: draft is only passed through for the ONE editing cell, so
// a keystroke re-renders that cell instead of every cell in the table.
const MemoCell = memo(function MemoCell({
  field,
  rec,
  users,
  editing,
  draft,
  readOnly,
  baseId,
  startEdit,
  commitEdit,
  upsert,
  onDraftChange,
}: {
  field: FieldLike;
  rec: RecordLike;
  users: Array<{ id: string; name: string | null; email: string | null }>;
  editing: boolean;
  draft: string;
  readOnly: boolean;
  baseId: string;
  startEdit: (recordId: string, fieldId: string, current: unknown) => void;
  commitEdit: (type: FieldType, recordId: string, fieldId: string) => void;
  upsert: (recordId: string, fieldId: string, value: unknown) => void;
  onDraftChange: (v: string) => void;
}) {
  return (
    <CellRenderer
      field={field}
      record={rec}
      users={users}
      isEditing={editing}
      draft={editing ? draft : ''}
      onDraftChange={onDraftChange}
      onStartEdit={(current) => startEdit(rec.id, field.id, current)}
      onCommitEdit={() => commitEdit(field.type, rec.id, field.id)}
      onUpsert={(v) => upsert(rec.id, field.id, v)}
      readOnly={readOnly}
      baseId={baseId}
    />
  );
});

export function GridEditor({ baseId, tableId }: { baseId: string; tableId: string }) {
  const utils = trpc.useUtils();
  const {
    data: fieldsData,
    isLoading: fieldsLoading,
    isError: fieldsError,
  } = trpc.field.list.useQuery({ tableId });
  const {
    data: viewsData,
    isLoading: viewsLoading,
    isError: viewsError,
  } = trpc.view.list.useQuery({ tableId });
  const { data: usersData } = trpc.auth.listUsers.useQuery();
  const { data: myMembership } = trpc.member.me.useQuery({ baseId });
  const isViewer = myMembership?.role === 'viewer';

  const fields = useMemo(() => (fieldsData ?? []) as FieldLike[], [fieldsData]);
  const views = useMemo(() => (viewsData ?? []) as ViewLike[], [viewsData]);
  const users = useMemo(() => usersData ?? [], [usersData]);

  // --- All hooks above the loading/error early-returns (Rules of Hooks). ---
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeViewId && views.length > 0) setActiveViewId(views[0]!.id);
    else if (activeViewId && !views.some((v) => v.id === activeViewId)) {
      setActiveViewId(views[0]?.id ?? null);
    }
  }, [views, activeViewId]);

  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const viewOptions = (activeView?.options ?? {}) as ViewOptions;
  const hiddenFields = viewOptions.hiddenFields ?? [];
  const displayedFields = fields.filter((f) => !hiddenFields.includes(f.id));
  const hasGroup = Boolean(viewOptions.group?.length);

  const [recordLimit, setRecordLimit] = useState(PAGE_SIZE);
  useEffect(() => setRecordLimit(PAGE_SIZE), [tableId]);

  const { data: recordsData } = trpc.record.list.useQuery({
    tableId,
    viewId: activeViewId ?? undefined,
    limit: recordLimit,
  });
  const groups = useMemo(() => (recordsData?.groups ?? []) as GroupLike[], [recordsData]);
  const total = recordsData?.total ?? 0;
  const flatRows = useMemo(() => groups.flatMap((g) => g.records), [groups]);
  const loadedCount = flatRows.length;
  // Global (not per-group) row numbers.
  const rowNumberById = useMemo(() => {
    const m = new Map<string, number>();
    flatRows.forEach((r, i) => m.set(r.id, i + 1));
    return m;
  }, [flatRows]);

  const [editing, setEditing] = useState<{ recordId: string; fieldId: string } | null>(null);
  const editingRef = useRef<{ recordId: string; fieldId: string } | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ recordId: string; fieldId: string } | null>(
    null,
  );
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const gridRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<FieldEditorTarget | undefined>(undefined);
  const [showFilter, setShowFilter] = useState(false);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const widthsRef = useRef<Record<string, number>>({});
  const resizeRef = useRef<{ fieldId: string; startX: number; startW: number } | null>(null);

  const upsertCell = trpc.cell.upsert.useMutation({
    onSuccess: () => {
      utils.record.list.invalidate({ tableId });
    },
    onError: (err) => toast.error(err.message),
  });
  const createRecord = trpc.record.create.useMutation({
    onSuccess: () => {
      utils.record.list.invalidate({ tableId });
      toast.success('Record added');
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteRecord = trpc.record.delete.useMutation({
    onSuccess: () => {
      utils.record.list.invalidate({ tableId });
      toast.success('Record deleted');
    },
    onError: (err) => toast.error(err.message),
  });
  const updateOptionsMut = trpc.view.updateOptions.useMutation({
    onSuccess: () => {
      utils.view.list.invalidate({ tableId });
      // record.list reads view options (filter/sort/group) server-side, so it must
      // refetch whenever options change — scoped to this table.
      utils.record.list.invalidate({ tableId });
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    const w = (viewOptions.columnWidth as Record<string, number> | undefined) ?? {};
    setWidths(w);
    widthsRef.current = w;
  }, [activeViewId, viewOptions.columnWidth]);

  // react-query's `mutate` is referentially stable — depend on it, not on the
  // mutation object, so the cell callbacks stay stable and memoization holds.
  const upsertMutate = upsertCell.mutate;
  const handleDraftChange = useCallback((v: string) => {
    draftRef.current = v;
    setDraft(v);
  }, []);
  const handleStartEdit = useCallback((recordId: string, fieldId: string, current: unknown) => {
    setSelectedCell({ recordId, fieldId });
    setEditing({ recordId, fieldId });
    editingRef.current = { recordId, fieldId };
    const d = current == null ? '' : String(current);
    draftRef.current = d;
    setDraft(d);
  }, []);
  const handleCommitEdit = useCallback(
    (type: FieldType, recordId: string, fieldId: string) => {
      if (!editingRef.current) return;
      editingRef.current = null;
      let value: unknown = draftRef.current;
      if (type === FieldType.Number)
        value = draftRef.current === '' ? '' : Number(draftRef.current);
      upsertMutate({ recordId, fieldId, value });
      setEditing(null);
    },
    [upsertMutate],
  );
  const handleUpsert = useCallback(
    (recordId: string, fieldId: string, value: unknown) => {
      upsertMutate({ recordId, fieldId, value });
    },
    [upsertMutate],
  );

  if (fieldsLoading || viewsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-3">
          <div className="h-8 w-96 animate-pulse rounded bg-muted" />
          <div className="h-64 w-96 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (fieldsError || viewsError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        Failed to load fields. Please try again.
      </div>
    );
  }

  function patchOptions(patch: Partial<ViewOptions>) {
    if (!activeView) return;
    const next = { ...(activeView.options as ViewOptions), ...patch } as Record<string, unknown>;
    updateOptionsMut.mutate({ id: activeView.id, options: next });
  }

  function selectCell(recordId: string, fieldId: string) {
    setSelectedCell({ recordId, fieldId });
    gridRef.current?.focus();
  }

  function moveTo(r: number, c: number) {
    const rec = flatRows[r];
    const f = displayedFields[c];
    if (rec && f) selectCell(rec.id, f.id);
  }

  function onGridKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!selectedCell) return;
    const r = flatRows.findIndex((x) => x.id === selectedCell.recordId);
    const c = displayedFields.findIndex((f) => f.id === selectedCell.fieldId);
    if (r < 0 || c < 0) return;
    const field = displayedFields[c]!;
    const rec = flatRows[r]!;
    const inline =
      field.type === FieldType.Text ||
      field.type === FieldType.Number ||
      field.type === FieldType.Date;
    const editingNow =
      editing?.recordId === selectedCell.recordId && editing?.fieldId === selectedCell.fieldId;
    const lastR = flatRows.length - 1;
    const lastC = displayedFields.length - 1;

    if (editingNow) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCommitEdit(field.type, selectedCell.recordId, selectedCell.fieldId);
        moveTo(Math.min(r + 1, lastR), c);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        handleCommitEdit(field.type, selectedCell.recordId, selectedCell.fieldId);
        moveTo(r, Math.min(c + 1, lastC));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        editingRef.current = null;
        setEditing(null);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        moveTo(Math.max(r - 1, 0), c);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveTo(Math.min(r + 1, lastR), c);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        moveTo(r, Math.max(c - 1, 0));
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveTo(r, Math.min(c + 1, lastC));
        break;
      case 'Enter':
        e.preventDefault();
        if (isViewer) break;
        if (inline) {
          handleStartEdit(
            selectedCell.recordId,
            selectedCell.fieldId,
            rec.cells[selectedCell.fieldId],
          );
        } else if (field.type === FieldType.Boolean) {
          upsertCell.mutate({
            recordId: selectedCell.recordId,
            fieldId: selectedCell.fieldId,
            value: !rec.cells[selectedCell.fieldId],
          });
        }
        break;
      case 'Tab': {
        e.preventDefault();
        const nc = c + (e.shiftKey ? -1 : 1);
        if (nc < 0) moveTo(Math.max(r - 1, 0), lastC);
        else if (nc > lastC) moveTo(Math.min(r + 1, lastR), 0);
        else moveTo(r, nc);
        break;
      }
      case 'Escape':
        e.preventDefault();
        setSelectedCell(null);
        setSelectedRows(new Set());
        break;
      case 'Delete':
      case 'Backspace':
        if (!isViewer) {
          e.preventDefault();
          upsertCell.mutate({
            recordId: selectedCell.recordId,
            fieldId: selectedCell.fieldId,
            value: '',
          });
        }
        break;
      case 'c':
        if ((e.metaKey || e.ctrlKey) && selectedCell) {
          e.preventDefault();
          const si = flatRows.findIndex((row) => row.id === selectedCell.recordId);
          const sj = displayedFields.findIndex((f) => f.id === selectedCell.fieldId);
          // Single cell copy
          const val = flatRows[si]?.cells[displayedFields[sj]?.id ?? ''];
          navigator.clipboard.writeText(val == null ? '' : String(val));
          return;
        }
        break;
      case 'v':
        if ((e.metaKey || e.ctrlKey) && selectedCell && !isViewer) {
          e.preventDefault();
          navigator.clipboard
            .readText()
            .then((text) => {
              const trimmed = text.trim();
              if (!trimmed) return;
              upsertCell.mutate({
                recordId: selectedCell.recordId,
                fieldId: selectedCell.fieldId,
                value: trimmed,
              });
            })
            .catch(() => {
              // Clipboard permission denied / unavailable — nothing to paste.
            });
          return;
        }
        break;
    }
  }

  function openCreateField() {
    setEditTarget(undefined);
    setDialogOpen(true);
  }
  function openEditField(f: FieldLike) {
    setEditTarget({ id: f.id, name: f.name, type: f.type, options: f.options });
    setDialogOpen(true);
  }

  function startResize(e: ReactMouseEvent, fieldId: string) {
    e.preventDefault();
    e.stopPropagation();
    const startW = widths[fieldId] ?? DEFAULT_COL_WIDTH;
    resizeRef.current = { fieldId, startX: e.clientX, startW };
    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dx = ev.clientX - r.startX;
      const nextW = Math.max(60, r.startW + dx);
      setWidths((w) => {
        const next = { ...w, [r.fieldId]: nextW };
        widthsRef.current = next;
        return next;
      });
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      patchOptions({ columnWidth: widthsRef.current });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const groupField = viewOptions.group?.[0]
    ? (fields.find((f) => f.id === viewOptions.group![0]!.fieldId) ?? null)
    : null;
  function groupLabel(key: string | null): string {
    if (key === null) return '(empty)';
    if (groupField?.type === FieldType.SingleSelect) {
      const choices = (groupField.options.choices as SelectOption[]) ?? [];
      return choices.find((c) => c.id === key)?.name ?? key;
    }
    return key;
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-4">
      <ViewTabs
        tableId={tableId}
        views={views}
        activeViewId={activeViewId}
        onSelect={setActiveViewId}
        readOnly={isViewer}
      />

      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">{activeView?.name ?? 'Grid'}</h1>
        {!isViewer && (
          <Button onClick={openCreateField} size="sm" className="h-7 rounded-md">
            + Field
          </Button>
        )}
      </div>

      {!isViewer && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={showFilter ? 'default' : 'outline'}
            size="sm"
            className="h-7 rounded-md"
            onClick={() => setShowFilter((s) => !s)}
          >
            Filter
            {(viewOptions.filter?.conditions?.length ?? 0) > 0
              ? ` (${viewOptions.filter!.conditions.length})`
              : ''}
          </Button>
          <SortMenu
            fields={fields}
            sort={viewOptions.sort}
            onChange={(s) => patchOptions({ sort: s })}
          />
          <ViewFieldsMenu
            fields={fields}
            hiddenFields={hiddenFields}
            onChange={(ids) => patchOptions({ hiddenFields: ids })}
          />
          <Select
            value={viewOptions.group?.[0]?.fieldId ?? '__none'}
            onValueChange={(v) => {
              if (!v) return;
              patchOptions({ group: v === '__none' ? undefined : [{ fieldId: v }] });
            }}
          >
            <SelectTrigger className="h-7 w-40 rounded-md border-border text-sm">
              {viewOptions.group?.[0]
                ? (fields.find((f) => f.id === viewOptions.group?.[0]?.fieldId)?.name ?? 'Group')
                : 'No grouping'}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">No grouping</SelectItem>
              {fields.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {showFilter && (
        <FilterPanel
          fields={fields}
          filter={viewOptions.filter}
          onChange={(f) => patchOptions({ filter: f })}
        />
      )}

      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        className="relative outline-none"
        onClick={(e) => {
          if (selectedCell && e.target === e.currentTarget) {
            setSelectedCell(null);
          }
        }}
      >
        <div className="overflow-auto rounded-md border border-border">
          <table
            className="markpocket-grid border-collapse text-sm"
            role="grid"
            aria-rowcount={total || undefined}
          >
            <colgroup>
              <col style={{ width: 40 }} />
              {displayedFields.map((f) => (
                <col key={f.id} style={{ width: widths[f.id] ?? DEFAULT_COL_WIDTH }} />
              ))}
              <col style={{ width: 120 }} />
            </colgroup>
            <thead>
              <tr className="bg-muted/40">
                <th className="border-b border-border p-1" />
                {displayedFields.map((f) => (
                  <th
                    key={f.id}
                    scope="col"
                    className="relative border-b border-l border-border p-0"
                    onDoubleClick={() => !isViewer && openEditField(f)}
                  >
                    <button
                      className="block w-full px-2.5 pt-1 text-left"
                      onClick={() => !isViewer && openEditField(f)}
                      title={`${f.name} (${f.type === 'expression' ? ((f.options as { expression?: string })?.expression ?? 'expr') : f.type})`}
                    >
                      <div className="text-xs font-medium text-foreground">
                        {f.name}
                        {viewOptions.sort?.find((s) => s.fieldId === f.id) && (
                          <span className="ml-1 text-muted-foreground">
                            {viewOptions.sort.find((s) => s.fieldId === f.id)?.direction === 'desc'
                              ? 'Z↓'
                              : 'A↓'}
                          </span>
                        )}
                      </div>
                      {f.type === 'expression' ? (
                        <div className="flex items-center gap-1 pb-1">
                          <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                            {(f.options as { expression?: string })?.expression ?? 'expr'}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            expression
                          </span>
                        </div>
                      ) : (
                        <div className="pb-1 font-mono text-[10px] text-muted-foreground">
                          {f.type}
                        </div>
                      )}
                    </button>
                    <div
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/20"
                      onMouseDown={(e) => startResize(e, f.id)}
                    />
                  </th>
                ))}
                {!isViewer && (
                  <th scope="col" className="border-b border-l border-border bg-muted/20 p-0">
                    <button
                      className="flex h-full w-full items-center justify-center text-muted-foreground hover:text-foreground"
                      onClick={openCreateField}
                      title="Add field"
                    >
                      +
                    </button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.key ?? '__null'}>
                  {hasGroup && (
                    <tr className="border-b border-border bg-muted/30">
                      <th
                        colSpan={displayedFields.length + 2}
                        scope="rowgroup"
                        className="border-b border-border p-1 text-left text-xs font-medium"
                      >
                        {groupLabel(g.key)}{' '}
                        <span className="text-muted-foreground">({g.records.length})</span>
                      </th>
                    </tr>
                  )}
                  {g.records.map((rec) => (
                    <tr
                      key={rec.id}
                      className={`group ${selectedRows.has(rec.id) ? 'bg-primary/5' : ''}`}
                    >
                      <td className="relative border-b border-border px-2 text-center text-xs text-muted-foreground">
                        <button
                          className={`w-full ${
                            selectedRows.has(rec.id)
                              ? 'bg-primary/10 font-semibold text-primary'
                              : ''
                          }`}
                          onClick={(e) => {
                            const next = new Set(selectedRows);
                            if (e.shiftKey && selectedCell) {
                              // Range select: from last selected to this one
                              const start = flatRows.findIndex(
                                (r) => r.id === selectedCell.recordId,
                              );
                              const end = flatRows.findIndex((r) => r.id === rec.id);
                              const [lo, hi] = start < end ? [start, end] : [end, start];
                              for (let j = lo; j <= hi; j++) next.add(flatRows[j]!.id);
                            } else if (e.metaKey || e.ctrlKey) {
                              if (next.has(rec.id)) next.delete(rec.id);
                              else next.add(rec.id);
                            } else {
                              next.clear();
                              next.add(rec.id);
                            }
                            setSelectedRows(next);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          {rowNumberById.get(rec.id) ?? ''}
                        </button>
                        {!isViewer && (
                          <button
                            className="absolute right-1 top-1/2 -translate-y-1/2 hidden leading-none text-muted-foreground hover:text-destructive group-hover:block"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteRecord.mutate({ id: rec.id, tableId });
                            }}
                            title="Delete record"
                          >
                            ×
                          </button>
                        )}
                      </td>
                      {displayedFields.map((f) => {
                        const editingThis =
                          editing?.recordId === rec.id && editing?.fieldId === f.id;
                        const selectedThis =
                          selectedCell?.recordId === rec.id && selectedCell?.fieldId === f.id;
                        return (
                          <td
                            key={f.id}
                            role="gridcell"
                            aria-selected={selectedThis || undefined}
                            onClick={() => selectCell(rec.id, f.id)}
                            className={cn(
                              'group relative border-b border-l border-border p-0',
                              selectedThis && 'ring-2 ring-inset ring-foreground',
                            )}
                          >
                            <MemoCell
                              field={f}
                              rec={rec}
                              users={users}
                              editing={editingThis}
                              draft={editingThis ? draft : ''}
                              readOnly={isViewer}
                              baseId={baseId}
                              startEdit={handleStartEdit}
                              commitEdit={handleCommitEdit}
                              upsert={handleUpsert}
                              onDraftChange={handleDraftChange}
                            />
                          </td>
                        );
                      })}
                      <td className="border-b border-l border-border" />
                    </tr>
                  ))}
                </Fragment>
              ))}
              {groups.every((g) => g.records.length === 0) && (
                <tr>
                  <td
                    colSpan={displayedFields.length + 2}
                    className="p-4 text-sm text-muted-foreground"
                  >
                    No records.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={displayedFields.length + 2} className="p-0">
                  <div className="flex w-full items-stretch">
                    {!isViewer && (
                      <button
                        className="flex flex-1 items-center justify-center gap-1 border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:border-solid hover:text-foreground disabled:opacity-50"
                        onClick={() => createRecord.mutate({ tableId })}
                        disabled={createRecord.isPending}
                      >
                        + new record
                      </button>
                    )}
                    {loadedCount < total && (
                      <button
                        className="border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-solid hover:text-foreground"
                        onClick={() => setRecordLimit((l) => l + PAGE_STEP)}
                      >
                        Show more — {loadedCount} of {total}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {loadedCount >= total && total > PAGE_SIZE && (
          <div className="pt-1 text-xs text-muted-foreground">Showing all {total} records.</div>
        )}
        {selectedCell &&
          (() => {
            const rowNumber = rowNumberById.get(selectedCell.recordId) ?? 0;
            const field = displayedFields.find((f) => f.id === selectedCell.fieldId);
            const record = flatRows.find((r) => r.id === selectedCell.recordId);
            if (!field || !record) return null;
            return (
              <CellHistoryDock
                cell={selectedCell}
                fieldName={field.name}
                rowNumber={rowNumber}
                currentValue={record.cells[selectedCell.fieldId]}
                onRestore={(value) =>
                  upsertCell.mutate({
                    recordId: selectedCell.recordId,
                    fieldId: selectedCell.fieldId,
                    value,
                  })
                }
                onClose={() => setSelectedCell(null)}
              />
            );
          })()}
      </div>

      <FieldEditorDialog
        open={dialogOpen && !isViewer}
        onOpenChange={setDialogOpen}
        tableId={tableId}
        field={editTarget}
      />
    </div>
  );
}
