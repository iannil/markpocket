'use client';

import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

import {
  FieldEditorDialog,
  type FieldEditorTarget,
} from '@/components/field-config/field-editor-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { formatNumberToString } from '@/lib/format-number';
import { FieldType, type SelectOption } from '@/lib/field-types';
import { trpc } from '@/lib/trpc/client';

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

const DEFAULT_COL_WIDTH = 160;

export function GridEditor({ tableId }: { tableId: string }) {
  const utils = trpc.useUtils();
  const { data: fieldsData } = trpc.field.list.useQuery({ tableId });
  const { data: recordsData } = trpc.record.list.useQuery({ tableId });
  const fields = (fieldsData ?? []) as FieldLike[];
  const records = (recordsData?.records ?? []) as RecordLike[];

  const upsertCell = trpc.cell.upsert.useMutation({
    onSuccess: () => utils.record.list.invalidate({ tableId }),
  });
  const createRecord = trpc.record.create.useMutation({
    onSuccess: () => utils.record.list.invalidate({ tableId }),
  });
  const deleteRecord = trpc.record.delete.useMutation({
    onSuccess: () => utils.record.list.invalidate({ tableId }),
  });

  const [editing, setEditing] = useState<{ recordId: string; fieldId: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<FieldEditorTarget | undefined>(undefined);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const resizeRef = useRef<{ fieldId: string; startX: number; startW: number } | null>(null);

  function startEdit(recordId: string, fieldId: string, current: unknown) {
    setEditing({ recordId, fieldId });
    setDraft(current == null ? '' : String(current));
  }

  function commitEdit(type: FieldType, recordId: string, fieldId: string) {
    if (!editing) return;
    let value: unknown = draft;
    if (type === FieldType.Number) {
      value = draft === '' ? '' : Number(draft);
    }
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
      setWidths((w) => ({ ...w, [r.fieldId]: Math.max(60, r.startW + dx) }));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function renderCell(rec: RecordLike, field: FieldLike) {
    const value = rec.cells[field.id];
    const isEditing = editing?.recordId === rec.id && editing?.fieldId === field.id;

    switch (field.type) {
      case FieldType.Boolean:
        return (
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) =>
              upsertCell.mutate({ recordId: rec.id, fieldId: field.id, value: e.target.checked })
            }
          />
        );
      case FieldType.SingleSelect: {
        const choices = (field.options.choices as SelectOption[] | undefined) ?? [];
        const selected = choices.find((c) => c.id === (value as string | undefined));
        return (
          <Select
            value={(value as string | undefined) ?? ''}
            onValueChange={(v) =>
              upsertCell.mutate({ recordId: rec.id, fieldId: field.id, value: v })
            }
          >
            <SelectTrigger className="h-7 w-full">
              {selected ? selected.name : <span className="text-muted-foreground">—</span>}
            </SelectTrigger>
            <SelectContent>
              {choices.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      case FieldType.Number:
        return isEditing ? (
          <Input
            className="h-7"
            type="number"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitEdit(FieldType.Number, rec.id, field.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        ) : (
          <button
            className="flex h-7 w-full items-center px-2 text-left"
            onClick={() => startEdit(rec.id, field.id, value)}
          >
            {value == null
              ? ''
              : formatNumberToString(value as number, field.options as { precision?: number })}
          </button>
        );
      case FieldType.Date: {
        const includeTime = (field.options.includeTime as boolean | undefined) ?? false;
        return isEditing ? (
          <Input
            className="h-7"
            type={includeTime ? 'datetime-local' : 'date'}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitEdit(FieldType.Date, rec.id, field.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        ) : (
          <button
            className="flex h-7 w-full items-center px-2 text-left"
            onClick={() => startEdit(rec.id, field.id, value)}
          >
            {value == null ? '' : String(value)}
          </button>
        );
      }
      case FieldType.Text:
      default:
        return isEditing ? (
          <Input
            className="h-7"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitEdit(FieldType.Text, rec.id, field.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        ) : (
          <button
            className="flex h-7 w-full items-center px-2 text-left"
            onClick={() => startEdit(rec.id, field.id, value)}
          >
            {value == null ? '' : String(value)}
          </button>
        );
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Grid</h1>
        <Button onClick={openCreateField} size="sm">
          + Field
        </Button>
      </div>

      <div className="overflow-auto rounded border">
        <table className="border-collapse text-sm">
          <colgroup>
            <col style={{ width: 40 }} />
            {fields.map((f) => (
              <col key={f.id} style={{ width: widths[f.id] ?? DEFAULT_COL_WIDTH }} />
            ))}
            <col style={{ width: 120 }} />
          </colgroup>
          <thead>
            <tr className="bg-muted/40">
              <th className="border-b p-1" />
              {fields.map((f) => (
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
            {records.map((rec) => (
              <tr key={rec.id} className="group">
                <td className="border-b p-1 text-center">
                  <button
                    className="text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                    onClick={() => deleteRecord.mutate({ id: rec.id })}
                    title="Delete record"
                  >
                    ×
                  </button>
                </td>
                {fields.map((f) => (
                  <td key={f.id} className="border-b border-l p-0">
                    {renderCell(rec, f)}
                  </td>
                ))}
                <td className="border-b border-l" />
              </tr>
            ))}
            {records.length === 0 && (
              <tr>
                <td colSpan={fields.length + 2} className="p-4 text-sm text-muted-foreground">
                  No records yet.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="p-1" />
              <td colSpan={fields.length + 1} className="p-1">
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
