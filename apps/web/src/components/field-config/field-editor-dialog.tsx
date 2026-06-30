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
import { trpc } from '@/lib/trpc/client';
import { FieldType, type SelectOption } from '@/lib/field-types';
import { FieldTypePicker } from './field-type-picker';
import { SelectOptionsEditor } from './select-options-editor';

export interface FieldEditorTarget {
  id: string;
  name: string;
  type: FieldType;
  options: Record<string, unknown>;
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
  });
  const rename = trpc.field.rename.useMutation({
    onSuccess: () => utils.field.list.invalidate({ tableId }),
  });
  const updateOptions = trpc.field.updateOptions.useMutation({
    onSuccess: () => utils.field.list.invalidate({ tableId }),
  });
  const remove = trpc.field.delete.useMutation({
    onSuccess: () => {
      utils.field.list.invalidate({ tableId });
      onOpenChange(false);
    },
  });

  const editing = Boolean(field);
  const [name, setName] = useState('');
  const [type, setType] = useState<FieldType>(FieldType.Text);
  const [choices, setChoices] = useState<SelectOption[]>([]);

  useEffect(() => {
    if (open) {
      setName(field?.name ?? '');
      setType(field?.type ?? FieldType.Text);
      setChoices((field?.options?.choices as SelectOption[] | undefined) ?? []);
    }
  }, [open, field]);

  function onSave() {
    if (!name.trim()) return;
    if (editing && field) {
      rename.mutate({ id: field.id, name });
      if (field.type === FieldType.SingleSelect) {
        updateOptions.mutate({ id: field.id, options: { choices } });
      }
      onOpenChange(false);
    } else {
      const options = type === FieldType.SingleSelect ? { choices } : {};
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
          {type === FieldType.SingleSelect && (
            <div className="space-y-1">
              <Label>Options</Label>
              <SelectOptionsEditor choices={choices} onChange={setChoices} />
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
