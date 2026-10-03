'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { displayToExpression, expressionToDisplay } from '@/lib/expression-display';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/toast';
import { trpc } from '@/lib/trpc/client';
import { extractDependsOn } from '@/lib/expression-eval';
import { FieldType, type SelectOption } from '@/lib/field-types';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { FieldTypePicker } from './field-type-picker';
import { SelectOptionsEditor } from './select-options-editor';

export interface FieldEditorTarget {
  id: string;
  name: string;
  type: FieldType;
  options: Record<string, unknown>;
}

function FieldEditorDialogTablePicker({
  baseId,
  value,
  onChange,
}: {
  baseId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  // Link targets must come from the CURRENT base — listing another base's
  // tables creates cross-base links the server rejects (or worse, accepts).
  const { data: tables } = trpc.table.list.useQuery({ baseId }, { enabled: !!baseId });
  const allTables = tables ?? [];
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger className="w-full">
        {allTables.find((t) => t.id === value)?.name ?? 'Select table'}
      </SelectTrigger>
      <SelectContent>
        {allTables.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FieldEditorDialog({
  open,
  onOpenChange,
  tableId,
  baseId,
  field,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tableId: string;
  /** Base owning `tableId` — link targets are picked from its tables. Falls
   *  back to the route param when omitted (the dialog always renders under
   *  /bases/[baseId]/...). */
  baseId?: string;
  field?: FieldEditorTarget;
}) {
  const routeBaseId = useParams<{ baseId: string }>().baseId;
  const effectiveBaseId = baseId ?? routeBaseId;
  const utils = trpc.useUtils();
  // Field roster for the expression editor: `{uuid}` tokens are stored
  // server-side, but the user reads and types `{Field Name}` — the roster
  // drives both directions of the conversion plus the insert chips.
  const { data: tableFields } = trpc.field.list.useQuery({ tableId }, { enabled: open });
  const fieldRefs = (tableFields ?? []).filter((f) => f.id !== field?.id);
  const numberFields = fieldRefs.filter((f) => f.type === FieldType.Number);
  const expressionInputRef = useRef<HTMLInputElement>(null);
  const create = trpc.field.create.useMutation({
    onSuccess: () => {
      utils.field.list.invalidate({ tableId });
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });
  const rename = trpc.field.rename.useMutation({
    onSuccess: () => utils.field.list.invalidate({ tableId }),
    onError: (err) => toast.error(err.message),
  });
  const updateOptions = trpc.field.updateOptions.useMutation({
    onSuccess: () => utils.field.list.invalidate({ tableId }),
    onError: (err) => toast.error(err.message),
  });
  const remove = trpc.field.delete.useMutation({
    onSuccess: () => {
      utils.field.list.invalidate({ tableId });
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const editing = Boolean(field);
  const [name, setName] = useState('');
  const [type, setType] = useState<FieldType>(FieldType.Text);
  const [choices, setChoices] = useState<SelectOption[]>([]);
  const [expression, setExpression] = useState('');
  // Link-field target — kept separate from `expression` (which is the expression DSL).
  const [targetTableId, setTargetTableId] = useState('');
  // Deleting a field destroys its entire column of data — the click used to
  // fire the mutation immediately, with no confirmation at all.
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setName(field?.name ?? '');
      setType(field?.type ?? FieldType.Text);
      setChoices((field?.options?.choices as SelectOption[] | undefined) ?? []);
      // Seed in DISPLAY form ({Name}); the save path converts back to the
      // stored {uuid} form via the current field roster.
      const stored = (field?.options?.expression as string | undefined) ?? '';
      setExpression(stored ? expressionToDisplay(stored, tableFields ?? []) : '');
      setTargetTableId((field?.options?.targetTableId as string | undefined) ?? '');
    }
    // tableFields omitted on purpose: seeding once per open is the intended
    // behavior — a mid-edit roster refresh must not clobber the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, field]);

  // Serial save: rename first, then options. On failure the dialog STAYS OPEN
  // (each mutation already toasts its error) so the user's input is not lost.
  const [saving, setSaving] = useState(false);
  async function onSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // The editor works in {Name} form; the stored expression must carry the
    // {uuid} tokens the evaluator understands.
    const storedExpression = displayToExpression(expression, fieldRefs);
    if (editing && field) {
      setSaving(true);
      try {
        await rename.mutateAsync({ id: field.id, name: trimmed });
        if (field.type === FieldType.SingleSelect || field.type === FieldType.MultiSelect) {
          await updateOptions.mutateAsync({ id: field.id, options: { choices } });
        } else if (field.type === FieldType.Expression) {
          await updateOptions.mutateAsync({
            id: field.id,
            options: {
              expression: storedExpression,
              dependsOn: extractDependsOn(storedExpression),
            },
          });
        } else if (field.type === FieldType.Link) {
          await updateOptions.mutateAsync({ id: field.id, options: { targetTableId } });
        }
        onOpenChange(false);
      } catch {
        // Toast already shown by the mutation's onError; keep the dialog open.
      } finally {
        setSaving(false);
      }
    } else {
      const options =
        type === FieldType.SingleSelect || type === FieldType.MultiSelect
          ? { choices }
          : type === FieldType.Expression
            ? {
                expression: storedExpression,
                dependsOn: extractDependsOn(storedExpression),
              }
            : type === FieldType.Link
              ? { targetTableId }
              : {};
      create.mutate({ tableId, name: trimmed, type, options });
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit field' : 'New field'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="field-name">Name</Label>
              <Input
                id="field-name"
                value={name}
                maxLength={64}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <FieldTypePicker value={type} onChange={setType} disabled={editing} />
            </div>
            {(type === FieldType.SingleSelect || type === FieldType.MultiSelect) && (
              <div className="space-y-1">
                <Label>Options</Label>
                <SelectOptionsEditor choices={choices} onChange={setChoices} />
              </div>
            )}
            {type === FieldType.Expression && (
              <div className="space-y-1">
                <Label>Expression</Label>
                <Input
                  ref={expressionInputRef}
                  value={expression}
                  onChange={(e) => setExpression(e.target.value)}
                  placeholder={'{Price} * {Qty}'}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Click a field to insert it. Arithmetic on number fields only.
                </p>
                {numberFields.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {numberFields.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          const el = expressionInputRef.current;
                          const token = `{${f.name}}`;
                          const start = el?.selectionStart ?? expression.length;
                          const end = el?.selectionEnd ?? expression.length;
                          const next = expression.slice(0, start) + token + expression.slice(end);
                          setExpression(next);
                          // Restore caret just after the inserted token.
                          requestAnimationFrame(() => {
                            el?.focus();
                            el?.setSelectionRange(start + token.length, start + token.length);
                          });
                        }}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                        title={`Insert {${f.name}}`}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {type === FieldType.Link && (
              <div className="space-y-1">
                <Label>Link to table</Label>
                <FieldEditorDialogTablePicker
                  baseId={effectiveBaseId}
                  value={targetTableId}
                  onChange={setTargetTableId}
                />
              </div>
            )}
          </div>
          <DialogFooter className="flex-row justify-between gap-2">
            {editing ? (
              <Button
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={remove.isPending}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => onSave()}
                disabled={
                  !name.trim() ||
                  saving ||
                  create.isPending ||
                  rename.isPending ||
                  updateOptions.isPending
                }
              >
                {editing ? 'Save' : 'Create'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete field “${field?.name ?? ''}”?`}
        description="This permanently deletes the field and every value stored in its column. There is no undo."
        confirmLabel="Delete field"
        pending={remove.isPending}
        onConfirm={() => field && remove.mutate({ id: field.id })}
      />
    </>
  );
}
