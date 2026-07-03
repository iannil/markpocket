'use client';

import {
  Fragment,
  useEffect,
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

export function GridEditor({ tableId }: { tableId: string }) {
  const utils = trpc.useUtils();
  const { data: fieldsData } = trpc.field.list.useQuery({ tableId });
  const { data: viewsData } = trpc.view.list.useQuery({ tableId });
  const { data: usersData } = trpc.auth.listUsers.useQuery();
  const fields = (fieldsData ?? []) as FieldLike[];
  const views = (viewsData ?? []) as ViewLike[];

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

  const { data: recordsData } = trpc.record.list.useQuery({
    tableId,
    viewId: activeViewId ?? undefined,
  });
  const groups = (recordsData?.groups ?? []) as GroupLike[];

  const upsertCell = trpc.cell.upsert.useMutation({
    onSuccess: () => utils.record.list.invalidate({ tableId }),
  });
  const createRecord = trpc.record.create.useMutation({
    onSuccess: () => utils.record.list.invalidate({ tableId }),
  });
  const deleteRecord = trpc.record.delete.useMutation({
    onSuccess: () => utils.record.list.invalidate({ tableId }),
  });
  const updateOptionsMut = trpc.view.updateOptions.useMutation({
    onSuccess: () => {
      utils.view.list.invalidate({ tableId });
      // record.list reads view options (filter/sort/group) server-side, so it must
      // refetch whenever options change.
      utils.record.list.invalidate();
    },
  });

  function patchOptions(patch: Partial<ViewOptions>) {
    if (!activeView) return;
    const next = { ...(activeView.options as ViewOptions), ...patch } as Record<string, unknown>;
    updateOptionsMut.mutate({ id: activeView.id, options: next });
  }

  const [editing, setEditing] = useState<{ recordId: string; fieldId: string } | null>(null);
  const editingRef = useRef<{ recordId: string; fieldId: string } | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ recordId: string; fieldId: string } | null>(
    null,
  );
  const gridRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<FieldEditorTarget | undefined>(undefined);
  const [showFilter, setShowFilter] = useState(false);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const widthsRef = useRef<Record<string, number>>({});
  const resizeRef = useRef<{ fieldId: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const w = (viewOptions.columnWidth as Record<string, number> | undefined) ?? {};
    setWidths(w);
    widthsRef.current = w;
  }, [activeViewId]);

  function selectCell(recordId: string, fieldId: string) {
    setSelectedCell({ recordId, fieldId });
    gridRef.current?.focus();
  }

  function moveTo(r: number, c: number) {
    const flat = groups.flatMap((g) => g.records);
    const rec = flat[r];
    const f = displayedFields[c];
    if (rec && f) selectCell(rec.id, f.id);
  }

  function onGridKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!selectedCell) return;
    const flat = groups.flatMap((g) => g.records);
    const r = flat.findIndex((x) => x.id === selectedCell.recordId);
    const c = displayedFields.findIndex((f) => f.id === selectedCell.fieldId);
    if (r < 0 || c < 0) return;
    const field = displayedFields[c]!;
    const rec = flat[r]!;
    const inline =
      field.type === FieldType.Text ||
      field.type === FieldType.Number ||
      field.type === FieldType.Date;
    const editingNow =
      editing?.recordId === selectedCell.recordId && editing?.fieldId === selectedCell.fieldId;
    const lastR = flat.length - 1;
    const lastC = displayedFields.length - 1;

    if (editingNow) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit(field.type, selectedCell.recordId, selectedCell.fieldId);
        moveTo(Math.min(r + 1, lastR), c);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitEdit(field.type, selectedCell.recordId, selectedCell.fieldId);
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
        if (inline) {
          startEdit(selectedCell.recordId, selectedCell.fieldId, rec.cells[selectedCell.fieldId]);
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
        break;
    }
  }
  function startEdit(recordId: string, fieldId: string, current: unknown) {
    setSelectedCell({ recordId, fieldId });
    setEditing({ recordId, fieldId });
    editingRef.current = { recordId, fieldId };
    setDraft(current == null ? '' : String(current));
  }
  function commitEdit(type: FieldType, recordId: string, fieldId: string) {
    if (!editingRef.current) return;
    editingRef.current = null;
    let value: unknown = draft;
    if (type === FieldType.Number) value = draft === '' ? '' : Number(draft);
    upsertCell.mutate({ recordId, fieldId, value });
    setEditing(null);
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
      />

      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">{activeView?.name ?? 'Grid'}</h1>
        <Button onClick={openCreateField} size="sm" className="h-7 rounded-md">
          + Field
        </Button>
      </div>

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

      {showFilter && (
        <FilterPanel
          fields={fields}
          filter={viewOptions.filter}
          onChange={(f) => patchOptions({ filter: f })}
        />
      )}

      <div ref={gridRef} tabIndex={0} onKeyDown={onGridKeyDown} className="relative outline-none">
        <div className="overflow-auto rounded-md border border-border">
          <table className="markpocket-grid border-collapse text-sm">
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
                    className="relative border-b border-l border-border p-0"
                    onDoubleClick={() => openEditField(f)}
                  >
                    <button
                      className="block w-full px-2.5 pt-1 text-left"
                      onClick={() => openEditField(f)}
                      title={`${f.name} (${f.type})`}
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
                      <div className="pb-1 font-mono text-[10px] text-muted-foreground">
                        {f.type}
                      </div>
                    </button>
                    <div
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/20"
                      onMouseDown={(e) => startResize(e, f.id)}
                    />
                  </th>
                ))}
                <th className="border-b border-l border-border bg-muted/20 p-0">
                  <button
                    className="flex h-full w-full items-center justify-center text-muted-foreground hover:text-foreground"
                    onClick={openCreateField}
                    title="Add field"
                  >
                    +
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.key ?? '__null'}>
                  {hasGroup && (
                    <tr className="border-b border-border bg-muted/30">
                      <th
                        colSpan={displayedFields.length + 2}
                        className="border-b border-border p-1 text-left text-xs font-medium"
                      >
                        {groupLabel(g.key)}{' '}
                        <span className="text-muted-foreground">({g.records.length})</span>
                      </th>
                    </tr>
                  )}
                  {g.records.map((rec, i) => (
                    <tr key={rec.id} className="group">
                      <td className="border-b border-border px-2 text-center text-xs text-muted-foreground">
                        <span className="group-hover:hidden">{i + 1}</span>
                        <button
                          className="hidden text-muted-foreground hover:text-destructive group-hover:inline"
                          onClick={() => deleteRecord.mutate({ id: rec.id, tableId })}
                          title="Delete record"
                        >
                          ×
                        </button>
                      </td>
                      {displayedFields.map((f) => (
                        <td
                          key={f.id}
                          onClick={() => selectCell(rec.id, f.id)}
                          className={cn(
                            'group relative border-b border-l border-border p-0',
                            selectedCell?.recordId === rec.id &&
                              selectedCell?.fieldId === f.id &&
                              'ring-2 ring-inset ring-foreground',
                          )}
                        >
                          <CellRenderer
                            field={f}
                            record={rec}
                            users={usersData ?? []}
                            isEditing={editing?.recordId === rec.id && editing?.fieldId === f.id}
                            draft={draft}
                            onDraftChange={setDraft}
                            onStartEdit={(v) => startEdit(rec.id, f.id, v)}
                            onCommitEdit={() => commitEdit(f.type, rec.id, f.id)}
                            onUpsert={(v) =>
                              upsertCell.mutate({ recordId: rec.id, fieldId: f.id, value: v })
                            }
                          />
                        </td>
                      ))}
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
                  <button
                    className="flex w-full items-center justify-center gap-1 border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:border-solid hover:text-foreground disabled:opacity-50"
                    onClick={() => createRecord.mutate({ tableId })}
                    disabled={createRecord.isPending}
                  >
                    + new record
                  </button>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {selectedCell &&
          (() => {
            const flat = groups.flatMap((g) => g.records);
            const rowNumber = flat.findIndex((r) => r.id === selectedCell.recordId) + 1;
            const field = displayedFields.find((f) => f.id === selectedCell.fieldId);
            const record = flat.find((r) => r.id === selectedCell.recordId);
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
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tableId={tableId}
        field={editTarget}
      />
    </div>
  );
}
