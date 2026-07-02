'use client';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { formatNumberToString } from '@/lib/format-number';
import { FieldType, type SelectOption } from '@/lib/field-types';
import { LinkCell } from './link-cell';

export interface CellRendererProps {
  field: { id: string; name: string; type: FieldType; options: Record<string, unknown> };
  record: { id: string; cells: Record<string, unknown> };
  users: Array<{ id: string; name: string | null; email: string | null }>;
  isEditing: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onStartEdit: (current: unknown) => void;
  onCommitEdit: () => void;
  onUpsert: (value: unknown) => void;
}

export function CellRenderer({
  field,
  record,
  users,
  isEditing,
  draft,
  onDraftChange,
  onStartEdit,
  onCommitEdit,
  onUpsert,
}: CellRendererProps) {
  const value = record.cells[field.id];

  switch (field.type) {
    case FieldType.Boolean:
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onUpsert(e.target.checked)}
        />
      );
    case FieldType.SingleSelect: {
      const choices = (field.options.choices as SelectOption[] | undefined) ?? [];
      const selected = choices.find((c) => c.id === (value as string | undefined));
      return (
        <Select value={(value as string | undefined) ?? ''} onValueChange={(v) => onUpsert(v)}>
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
    case FieldType.Expression: {
      // Read-only: computed value (write-time materialized, Q2) or error sentinel.
      const v = value as number | { __error?: string } | null | undefined;
      if (v == null) return <div className="flex h-7 w-full items-center px-2" />;
      if (typeof v === 'object' && v !== null && '__error' in v) {
        return (
          <div className="flex h-7 w-full items-center px-2 text-xs text-destructive">
            {v.__error}
          </div>
        );
      }
      return (
        <div className="flex h-7 w-full items-center px-2 text-left">
          {formatNumberToString(v as number, field.options as { precision?: number })}
        </div>
      );
    }
    case FieldType.MultiSelect: {
      const choices = (field.options.choices as SelectOption[] | undefined) ?? [];
      const selectedIds = (value as string[] | undefined) ?? [];
      const selectedNames = choices
        .filter((c) => selectedIds.includes(c.id))
        .map((c) => c.name)
        .join(', ');
      function toggle(id: string) {
        const next = selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id];
        onUpsert(next);
      }
      return (
        <Popover>
          <PopoverTrigger className="flex h-7 w-full items-center px-2 text-left text-sm">
            {selectedNames || <span className="text-muted-foreground">—</span>}
          </PopoverTrigger>
          <PopoverContent className="w-56">
            {choices.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(c.id)}
                  onChange={() => toggle(c.id)}
                />
                {c.name}
              </label>
            ))}
          </PopoverContent>
        </Popover>
      );
    }
    case FieldType.User: {
      const selected = users.find((u) => u.id === (value as string | undefined));
      return (
        <Select
          value={(value as string | undefined) ?? ''}
          onValueChange={(v) => {
            if (!v) return;
            onUpsert(v);
          }}
        >
          <SelectTrigger className="h-7 w-full">
            {selected ? (
              (selected.name ?? selected.email)
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name ?? u.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case FieldType.Link: {
      const targetTableId = field.options.targetTableId as string | undefined;
      const linkedIds = (value as string[] | undefined) ?? [];
      // Resolve linked record primary field values via a query hook
      return (
        <LinkCell
          recordIds={linkedIds}
          targetTableId={targetTableId}
          onChange={(ids) => onUpsert(ids)}
        />
      );
    }
    case FieldType.Attachment: {
      const attIds = (value as string[] | undefined) ?? [];
      return (
        <div className="flex h-7 items-center gap-1 px-2">
          {attIds.map((id) => (
            <a
              key={id}
              href={`/api/files/${id}`}
              target="_blank"
              className="rounded bg-secondary px-1.5 py-0.5 text-xs hover:bg-accent"
            >
              📎
            </a>
          ))}
          <label className="cursor-pointer rounded px-1 text-xs text-muted-foreground hover:text-foreground">
            +upload
            <input
              type="file"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const fd = new FormData();
                fd.append('file', file);
                const res = await fetch('/api/upload', { method: 'POST', body: fd });
                const json = await res.json();
                if (json.id) {
                  onUpsert([...attIds, json.id]);
                }
              }}
            />
          </label>
        </div>
      );
    }
    case FieldType.Number:
      return isEditing ? (
        <Input
          className="h-7"
          type="number"
          autoFocus
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={() => onCommitEdit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      ) : (
        <button
          className="flex h-7 w-full items-center px-2 text-left"
          onClick={() => onStartEdit(value)}
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
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={() => onCommitEdit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      ) : (
        <button
          className="flex h-7 w-full items-center px-2 text-left"
          onClick={() => onStartEdit(value)}
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
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={() => onCommitEdit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      ) : (
        <button
          className="flex h-7 w-full items-center px-2 text-left"
          onClick={() => onStartEdit(value)}
        >
          {value == null ? '' : String(value)}
        </button>
      );
  }
}
