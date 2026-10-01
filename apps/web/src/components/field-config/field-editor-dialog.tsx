'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
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
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const basesQ = trpc.base.list.useQuery();
  const firstBaseId = basesQ.data?.[0]?.id ?? '';
  const { data: tables } = trpc.table.list.useQuery(
    { baseId: firstBaseId },
    { enabled: !!firstBaseId },
  );
  // v1: link targets come from the first base the user is a member of.
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
  field,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tableId: string;
  field?: FieldEditorTarget;
}) {
  const utils = trpc.useUtils();
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

  useEffect(() => {
    if (open) {
      setName(field?.name ?? '');
      setType(field?.type ?? FieldType.Text);
      setChoices((field?.options?.choices as SelectOption[] | undefined) ?? []);
      setExpression((field?.options?.expression as string | undefined) ?? '');
      setTargetTableId((field?.options?.targetTableId as string | undefined) ?? '');
    }
  }, [open, field]);

  function onSave() {
    if (!name.trim()) return;
    if (editing && field) {
      rename.mutate({ id: field.id, name });
      if (field.type === FieldType.SingleSelect || field.type === FieldType.MultiSelect) {
        updateOptions.mutate({ id: field.id, options: { choices } });
      } else if (field.type === FieldType.Expression) {
        updateOptions.mutate({
          id: field.id,
          options: { expression, dependsOn: extractDependsOn(expression) },
        });
      } else if (field.type === FieldType.Link) {
        updateOptions.mutate({ id: field.id, options: { targetTableId } });
      }
      onOpenChange(false);
    } else {
      const options =
        type === FieldType.SingleSelect || type === FieldType.MultiSelect
          ? { choices }
          : type === FieldType.Expression
            ? { expression, dependsOn: extractDependsOn(expression) }
            : type === FieldType.Link
              ? { targetTableId }
              : {};
      create.mutate({ tableId, name, type, options });
    }
  }

  return (
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
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                placeholder={'{fieldId} * {fieldId}'}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Use {'{fieldId}'} tokens. Arithmetic on number fields only.
              </p>
            </div>
          )}
          {type === FieldType.Link && (
            <div className="space-y-1">
              <Label>Link to table</Label>
              <FieldEditorDialogTablePicker value={targetTableId} onChange={setTargetTableId} />
            </div>
          )}
        </div>
        <DialogFooter className="flex-row justify-between gap-2">
          {editing ? (
            <Button
              variant="destructive"
              onClick={() => field && remove.mutate({ id: field.id })}
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
            <Button onClick={onSave} disabled={!name.trim() || create.isPending}>
              {editing ? 'Save' : 'Create'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
