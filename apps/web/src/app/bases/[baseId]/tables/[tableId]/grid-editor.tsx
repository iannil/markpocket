'use client';

import { Fragment, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

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
import { CellRenderer } from './cell-renderers';
import { CellHistory } from '@/components/history/cell-history';
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

  function startEdit(recordId: string, fieldId: string, current: unknown) {
    setEditing({ recordId, fieldId });
    setDraft(current == null ? '' : String(current));
  }
  function commitEdit(type: FieldType, recordId: string, fieldId: string) {
    if (!editing) return;
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
    <div className="h-full space-y-3 overflow-auto p-4">
      <ViewTabs
        tableId={tableId}
        views={views}
        activeViewId={activeViewId}
        onSelect={setActiveViewId}
      />

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{activeView?.name ?? 'Grid'}</h1>
        <Button onClick={openCreateField} size="sm">
          + Field
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={showFilter ? 'default' : 'outline'}
          size="sm"
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
          <SelectTrigger className="h-7 w-40">
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

      <div className="overflow-auto rounded border">
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
              <th className="border-b p-1" />
              {displayedFields.map((f) => (
                <th
                  key={f.id}
                  className="relative border-b border-l p-0"
                  onDoubleClick={() => openEditField(f)}
                >
                  <button
                    className="block w-full px-2 py-1 text-left text-xs font-medium"
                    onClick={() => openEditField(f)}
                    title={`${f.name} (${f.type})`}
                  >
                    {f.name}
                    <span className="ml-1 text-muted-foreground">· {f.type}</span>
                  </button>
                  <div
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/20"
                    onMouseDown={(e) => startResize(e, f.id)}
                  />
                </th>
              ))}
              <th className="border-b border-l p-1">
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={openCreateField}
                >
                  + field
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.key ?? '__null'}>
                {hasGroup && (
                  <tr className="bg-muted/20">
                    <th
                      colSpan={displayedFields.length + 2}
                      className="border-b border-l p-1 text-left text-xs font-medium"
                    >
                      {groupLabel(g.key)}{' '}
                      <span className="text-muted-foreground">({g.records.length})</span>
                    </th>
                  </tr>
                )}
                {g.records.map((rec) => (
                  <tr key={rec.id} className="group">
                    <td className="border-b p-1 text-center">
                      <button
                        className="text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                        onClick={() => deleteRecord.mutate({ id: rec.id, tableId })}
                        title="Delete record"
                      >
                        ×
                      </button>
                    </td>
                    {displayedFields.map((f) => (
                      <td key={f.id} className="group relative border-b border-l p-0">
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
                        <div className="absolute right-0 top-0">
                          <CellHistory recordId={rec.id} fieldId={f.id} />
                        </div>
                      </td>
                    ))}
                    <td className="border-b border-l" />
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
              <td className="p-1" />
              <td colSpan={displayedFields.length + 1} className="p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => createRecord.mutate({ tableId })}
                  disabled={createRecord.isPending}
                >
                  + New record
                </Button>
              </td>
            </tr>
          </tfoot>
        </table>
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
