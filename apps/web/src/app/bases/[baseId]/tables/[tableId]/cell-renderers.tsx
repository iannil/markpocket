'use client';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { formatNumberToString } from '@/lib/format-number';
import { FieldType, type SelectOption } from '@/lib/field-types';
import { LinkCell } from './link-cell';

function initials(s: string): string {
  return s
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function relativeDate(s: string): string | null {
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const t = new Date();
  const y = new Date();
  y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'today';
  if (d.toDateString() === y.toDateString()) return 'yesterday';
  return null;
}

const EMPTY = <span className="text-muted-foreground">—</span>;

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
        <button
          className="flex min-h-[28px] w-full items-start px-2.5 py-1 text-sm"
          onClick={() => onUpsert(!value)}
        >
          {value ? <span className="text-foreground">✓</span> : null}
        </button>
      );
    case FieldType.SingleSelect: {
      const choices = (field.options.choices as SelectOption[] | undefined) ?? [];
      const selected = choices.find((c) => c.id === (value as string | undefined));
      return (
        <Select value={(value as string | undefined) ?? ''} onValueChange={(v) => onUpsert(v)}>
          <SelectTrigger className="h-7 w-full rounded-none border-0 focus:ring-0">
            {selected ? (
              <span className="flex items-center">
                <span
                  className="mr-1.5 inline-block size-1.5 rounded-full"
                  style={{ backgroundColor: selected.color }}
                />
                {selected.name}
              </span>
            ) : (
              EMPTY
            )}
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
      const base = 'flex min-h-[28px] items-start border-l-2 border-foreground px-2.5 py-1 text-sm';
      if (v == null) return <div className={base} />;
      if (typeof v === 'object' && v !== null && '__error' in v) {
        return <div className={`${base} text-destructive`}>{v.__error}</div>;
      }
      const num = v as number;
      return (
        <div className={`${base} font-mono tabular-nums${num < 0 ? ' text-destructive' : ''}`}>
          {formatNumberToString(num, field.options as { precision?: number })}
        </div>
      );
    }
    case FieldType.MultiSelect: {
      const choices = (field.options.choices as SelectOption[] | undefined) ?? [];
      const selectedIds = (value as string[] | undefined) ?? [];
      const selectedNames = choices.filter((c) => selectedIds.includes(c.id)).map((c) => c.name);
      function toggle(id: string) {
        const next = selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id];
        onUpsert(next);
      }
      return (
        <Popover>
          <PopoverTrigger className="flex min-h-[28px] w-full items-start px-2.5 py-1 text-left text-sm">
            {selectedNames.length === 0 ? (
              EMPTY
            ) : (
              <span className="flex items-center">
                {selectedNames.slice(0, 2).map((name) => (
                  <span key={name} className="mr-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                    {name}
                  </span>
                ))}
                {selectedNames.length > 2 ? (
                  <span className="text-xs text-muted-foreground">+{selectedNames.length - 2}</span>
                ) : null}
              </span>
            )}
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
      const label = selected ? (selected.name ?? selected.email ?? selected.id) : '';
      return (
        <Select
          value={(value as string | undefined) ?? ''}
          onValueChange={(v) => {
            if (!v) return;
            onUpsert(v);
          }}
        >
          <SelectTrigger className="h-7 w-full rounded-none border-0 focus:ring-0">
            {selected ? (
              <span className="flex items-center">
                <span className="mr-1.5 flex size-5 items-center justify-center rounded-full bg-muted font-mono text-[10px]">
                  {initials(label)}
                </span>
                {label}
              </span>
            ) : (
              EMPTY
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
        <div className="flex min-h-[28px] items-start gap-1 px-2.5 py-1">
          {attIds.map((id, i) => (
            <a
              key={id}
              href={`/api/files/${id}`}
              target="_blank"
              className={i > 0 ? '-ml-1' : undefined}
            >
              <img
                src={`/api/files/${id}`}
                alt=""
                className="size-6 rounded border border-border object-cover"
              />
            </a>
          ))}
          <label className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
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
    case FieldType.Number: {
      const num = value == null ? null : (value as number);
      return isEditing ? (
        <Input
          className="h-7 rounded-none border-0 bg-muted focus-visible:ring-0"
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
          className={`flex min-h-[28px] w-full items-start justify-end px-2.5 py-1 text-right font-mono tabular-nums text-sm${
            num != null && num < 0 ? ' text-destructive' : ''
          }`}
          onClick={() => onStartEdit(value)}
        >
          {num == null ? EMPTY : formatNumberToString(num, field.options as { precision?: number })}
        </button>
      );
    }
    case FieldType.Date: {
      const includeTime = (field.options.includeTime as boolean | undefined) ?? false;
      const rel = value == null ? null : relativeDate(String(value));
      return isEditing ? (
        <Input
          className="h-7 rounded-none border-0 bg-muted focus-visible:ring-0"
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
          className="flex min-h-[28px] w-full items-start px-2.5 py-1 text-left font-mono text-sm"
          onClick={() => onStartEdit(value)}
        >
          {value == null ? (
            EMPTY
          ) : rel ? (
            <span className="text-muted-foreground">{rel}</span>
          ) : (
            String(value)
          )}
        </button>
      );
    }
    case FieldType.Text:
    default:
      return isEditing ? (
        <Input
          className="h-7 rounded-none border-0 bg-muted focus-visible:ring-0"
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
          className="flex min-h-[28px] w-full items-start px-2.5 py-1 text-left text-sm"
          onClick={() => onStartEdit(value)}
        >
          {value == null || value === '' ? EMPTY : String(value)}
        </button>
      );
  }
}
