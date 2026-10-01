'use client';

import { memo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { toast } from '@/lib/toast';
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

function AttachmentThumb({ id }: { id: string }) {
  const [broken, setBroken] = useState(false);
  const href = `/api/files/${id}`;
  if (broken) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="rounded bg-muted px-1 text-xs hover:bg-accent"
      >
        📎
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="-ml-1 first:ml-0">
      <img
        src={href}
        alt=""
        className="size-6 rounded object-cover"
        onError={() => setBroken(true)}
      />
    </a>
  );
}

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
  readOnly?: boolean;
  /** Owning base — sent with attachment uploads so the server can scope the ACL. */
  baseId?: string;
}

// memo'd: the parent re-renders on every keystroke of an inline edit (draft state
// lives above); stable props keep the untouched cells from re-rendering.
export const CellRenderer = memo(function CellRenderer({
  field,
  record,
  users,
  isEditing,
  draft,
  onDraftChange,
  onStartEdit,
  onCommitEdit,
  onUpsert,
  readOnly = false,
  baseId,
}: CellRendererProps) {
  const value = record.cells[field.id];
  const [uploading, setUploading] = useState(false);

  async function uploadAttachment(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (baseId) fd.append('baseId', baseId);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Upload failed (${res.status})`);
      }
      const json = (await res.json()) as { id: string };
      onUpsert([...((value as string[] | undefined) ?? []), json.id]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  switch (field.type) {
    case FieldType.Boolean:
      return (
        <button
          className="flex min-h-[28px] w-full items-start px-2.5 py-1 text-sm"
          onClick={() => (readOnly ? undefined : onUpsert(!value))}
          disabled={readOnly}
        >
          {value ? <span className="text-foreground">✓</span> : null}
        </button>
      );
    case FieldType.SingleSelect: {
      const choices = (field.options.choices as SelectOption[] | undefined) ?? [];
      const selected = choices.find((c) => c.id === (value as string | undefined));
      if (readOnly) {
        return (
          <div className="flex min-h-[28px] w-full items-center gap-1 px-2.5 text-sm">
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
          </div>
        );
      }
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
      // Chips come from choices (ids are unique) — never key by display name.
      const selectedChips = choices.filter((c) => selectedIds.includes(c.id));
      function toggle(id: string) {
        const next = selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id];
        onUpsert(next);
      }
      const chips = (
        <>
          {selectedChips.slice(0, 2).map((c) => (
            <span key={c.id} className="mr-1 rounded bg-muted px-1.5 py-0.5 text-xs">
              {c.name}
            </span>
          ))}
          {selectedChips.length > 2 ? (
            <span className="text-xs text-muted-foreground">+{selectedChips.length - 2}</span>
          ) : null}
        </>
      );
      if (readOnly) {
        return (
          <div className="flex min-h-[28px] w-full items-center px-2.5 text-sm">
            {selectedChips.length === 0 ? (
              EMPTY
            ) : (
              <span className="flex items-center">{chips}</span>
            )}
          </div>
        );
      }
      return (
        <Popover>
          <PopoverTrigger className="flex min-h-[28px] w-full items-start px-2.5 py-1 text-left text-sm">
            {selectedChips.length === 0 ? (
              EMPTY
            ) : (
              <span className="flex items-center">{chips}</span>
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
      if (readOnly) {
        return (
          <div className="flex min-h-[28px] w-full items-center gap-1.5 px-2.5 text-sm">
            {selected ? (
              <span className="flex items-center gap-1.5">
                <span className="flex size-5 items-center justify-center rounded-full bg-muted font-mono text-[10px]">
                  {initials(label)}
                </span>
                {label}
              </span>
            ) : (
              EMPTY
            )}
          </div>
        );
      }
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
      if (readOnly) {
        return (
          <div className="flex min-h-[28px] w-full items-center px-2.5 text-sm">
            {linkedIds.length > 0 ? (
              <span className="text-muted-foreground">
                {linkedIds.length} linked record{linkedIds.length !== 1 ? 's' : ''}
              </span>
            ) : (
              EMPTY
            )}
          </div>
        );
      }
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
          {attIds.map((id) => (
            <AttachmentThumb key={id} id={id} />
          ))}
          {!readOnly && (
            <label className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              {uploading ? 'uploading…' : '+upload'}
              <input
                type="file"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  e.target.value = '';
                  void uploadAttachment(file);
                }}
              />
            </label>
          )}
        </div>
      );
    }
    case FieldType.Number: {
      const num = value == null ? null : (value as number);
      if (readOnly) {
        return (
          <div
            className={`flex min-h-[28px] w-full items-start justify-end px-2.5 py-1 text-right font-mono tabular-nums text-sm${num != null && num < 0 ? ' text-destructive' : ''}`}
          >
            {num == null
              ? EMPTY
              : formatNumberToString(num, field.options as { precision?: number })}
          </div>
        );
      }
      return isEditing ? (
        <Input
          className="h-7 rounded-none border-0 bg-muted focus-visible:ring-0"
          type="number"
          autoFocus
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={() => onCommitEdit()}
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
      if (readOnly) {
        return (
          <div className="flex min-h-[28px] w-full items-start px-2.5 py-1 text-left font-mono text-sm">
            {value == null ? (
              EMPTY
            ) : rel ? (
              <span className="text-muted-foreground">{rel}</span>
            ) : (
              String(value)
            )}
          </div>
        );
      }
      return isEditing ? (
        <Input
          className="h-7 rounded-none border-0 bg-muted focus-visible:ring-0"
          type={includeTime ? 'datetime-local' : 'date'}
          autoFocus
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={() => onCommitEdit()}
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
      if (readOnly) {
        return (
          <div className="flex min-h-[28px] w-full items-start px-2.5 py-1 text-left text-sm">
            {value == null || value === '' ? EMPTY : String(value)}
          </div>
        );
      }
      return isEditing ? (
        <Input
          className="h-7 rounded-none border-0 bg-muted focus-visible:ring-0"
          autoFocus
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={() => onCommitEdit()}
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
});
