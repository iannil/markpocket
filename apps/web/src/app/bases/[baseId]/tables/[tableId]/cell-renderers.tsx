'use client';

import { memo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { toast } from '@/lib/toast';
import { formatNumberToString } from '@/lib/format-number';
import { FieldType, type SelectOption } from '@/lib/field-types';
import { LinkCellDisplay, LinkCellEditor } from './link-cell';
import { initials } from '@/lib/initials';

export interface FieldLike {
  id: string;
  name: string;
  type: FieldType;
  options: Record<string, unknown>;
}
export interface RecordLike {
  id: string;
  cells: Record<string, unknown>;
}
export interface UserLike {
  id: string;
  name: string | null;
  email: string | null;
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

const CELL_BASE = 'flex h-full w-full items-center gap-1 px-2.5 text-sm';

function Avatar({ label }: { label: string }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px]">
      {initials(label)}
    </span>
  );
}

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
  field: FieldLike;
  record: RecordLike;
  users: UserLike[];
  readOnly?: boolean;
  /** Owning base — sent with attachment uploads so the server can scope the ACL. */
  baseId?: string;
  /** Direct-write paths (boolean toggle, attachment upload). */
  onUpsertCell: (recordId: string, fieldId: string, value: unknown) => void;
}

// Display-only. Real editors (Select/Popover/input) mount exclusively through
// <EditingCell> while a cell is being edited — a 1000×10 grid never holds more
// than one editor instance. memo'd: stable props keep untouched cells from
// re-rendering when siblings or the selection change.
export const CellRenderer = memo(function CellRenderer({
  field,
  record,
  users,
  readOnly = false,
  baseId,
  onUpsertCell,
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
      onUpsertCell(record.id, field.id, [...((value as string[] | undefined) ?? []), json.id]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  switch (field.type) {
    case FieldType.Boolean:
      // Checkbox is direct-manipulation: a single click both selects (via the
      // cell wrapper) and toggles.
      return (
        <button
          className={`${CELL_BASE} justify-start`}
          onClick={() => (readOnly ? undefined : onUpsertCell(record.id, field.id, !value))}
          disabled={readOnly}
          aria-label={field.name}
          aria-pressed={value === true}
        >
          {value ? <span className="text-foreground">✓</span> : null}
        </button>
      );

    case FieldType.SingleSelect: {
      const choices = (field.options.choices as SelectOption[] | undefined) ?? [];
      const selected = choices.find((c) => c.id === (value as string | undefined));
      return (
        <div className={CELL_BASE}>
          {selected ? (
            <span className="flex min-w-0 items-center">
              <span
                className="mr-1.5 inline-block size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: selected.color }}
              />
              <span className="truncate">{selected.name}</span>
            </span>
          ) : (
            EMPTY
          )}
        </div>
      );
    }

    case FieldType.Expression: {
      // Read-only: computed value (write-time materialized, Q2) or error sentinel.
      const v = value as number | { __error?: string } | null | undefined;
      const base = `${CELL_BASE} border-l-2 border-foreground font-mono tabular-nums`;
      if (v == null) return <div className={base} />;
      if (typeof v === 'object' && v !== null && '__error' in v) {
        return <div className={`${base} text-destructive`}>{v.__error}</div>;
      }
      const num = v as number;
      return (
        <div className={`${base}${num < 0 ? ' text-destructive' : ''}`}>
          {formatNumberToString(num, field.options as { precision?: number })}
        </div>
      );
    }

    case FieldType.MultiSelect: {
      const choices = (field.options.choices as SelectOption[] | undefined) ?? [];
      const selectedIds = (value as string[] | undefined) ?? [];
      // Chips come from choices (ids are unique) — never key by display name.
      const selectedChips = choices.filter((c) => selectedIds.includes(c.id));
      return (
        <div className={CELL_BASE}>
          {selectedChips.length === 0 ? (
            EMPTY
          ) : (
            <span className="flex min-w-0 items-center">
              {selectedChips.slice(0, 2).map((c) => (
                <span key={c.id} className="mr-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {c.name}
                </span>
              ))}
              {selectedChips.length > 2 ? (
                <span className="text-xs text-muted-foreground">+{selectedChips.length - 2}</span>
              ) : null}
            </span>
          )}
        </div>
      );
    }

    case FieldType.User: {
      const selected = users.find((u) => u.id === (value as string | undefined));
      const label = selected ? (selected.name ?? selected.email ?? selected.id) : '';
      return (
        <div className={CELL_BASE}>
          {selected ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar label={label} />
              <span className="truncate">{label}</span>
            </span>
          ) : (
            EMPTY
          )}
        </div>
      );
    }

    case FieldType.Link:
      return (
        <div className={CELL_BASE}>
          <LinkCellDisplay
            recordIds={(value as string[] | undefined) ?? []}
            targetTableId={field.options.targetTableId as string | undefined}
          />
        </div>
      );

    case FieldType.Attachment: {
      const attIds = (value as string[] | undefined) ?? [];
      return (
        <div className="flex h-full w-full items-center gap-1 px-2.5">
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
      return (
        <div
          className={`${CELL_BASE} justify-end font-mono tabular-nums${num != null && num < 0 ? ' text-destructive' : ''}`}
        >
          {num == null ? EMPTY : formatNumberToString(num, field.options as { precision?: number })}
        </div>
      );
    }

    case FieldType.Date: {
      const includeTime = (field.options.includeTime as boolean | undefined) ?? false;
      const rel = value == null ? null : relativeDate(String(value));
      return (
        <div className={`${CELL_BASE} justify-start font-mono`}>
          {value == null ? (
            EMPTY
          ) : rel ? (
            <span className="text-muted-foreground">{rel}</span>
          ) : (
            <span className="truncate">
              {includeTime ? String(value) : String(value).slice(0, 10)}
            </span>
          )}
        </div>
      );
    }

    case FieldType.Text:
    default:
      return (
        <div className={`${CELL_BASE} justify-start`}>
          {value == null || value === '' ? (
            EMPTY
          ) : (
            <span className="truncate">{String(value)}</span>
          )}
        </div>
      );
  }
});

export interface EditingCellProps {
  field: FieldLike;
  record: RecordLike;
  users: UserLike[];
  /** Typed-character seed when editing started by typing over the cell. */
  seed?: string;
  baseId?: string;
  onCommit: (value: unknown, move: 'down' | 'right' | null) => void;
  onCancel: () => void;
  /** Write-through for popover editors (applies immediately, keeps editing). */
  onWrite: (value: unknown) => void;
}

// The editing session owns its draft locally — a keystroke re-renders only this
// component, never the grid. The grid just tracks WHICH cell is editing.
export function EditingCell({
  field,
  record,
  users,
  seed,
  onCommit,
  onCancel,
  onWrite,
}: EditingCellProps) {
  const value = record.cells[field.id];
  const [draft, setDraft] = useState(() => {
    if (seed != null) return seed;
    if (value == null) return '';
    if (field.type === FieldType.Date) {
      const includeTime = (field.options.includeTime as boolean | undefined) ?? false;
      // input[type=date] renders any value with a time part as EMPTY — a
      // stored "2026-10-02T10:30:00.000Z" must seed as its date-only prefix
      // or editing the cell looks like clearing it.
      if (!includeTime) return String(value).slice(0, 10);
    }
    return String(value);
  });
  // MultiSelect selection lives in local state seeded once per editing
  // session (unmount destroys it) — same race as the Link editor: the
  // optimistic patch only reaches the record.list cache after onMutate's
  // cancelQueries resolves, so computing a second quick toggle from `value`
  // dropped the first pick. Both the checkboxes and every write read this.
  const [multiSelected, setMultiSelected] = useState<string[]>(() =>
    field.type === FieldType.MultiSelect ? ((value as string[] | undefined) ?? []) : [],
  );
  // After an explicit commit/cancel the input unmounts and fires blur — that
  // trailing blur must not commit a second time.
  const closedRef = useRef(false);

  function commitInline(move: 'down' | 'right' | null) {
    if (closedRef.current) return;
    if (field.type === FieldType.Number) {
      const t = draft.trim();
      if (t !== '' && !Number.isFinite(Number(t))) {
        toast.error('Invalid number');
        return;
      }
      closedRef.current = true;
      onCommit(t === '' ? '' : Number(t), move);
      return;
    }
    closedRef.current = true;
    onCommit(draft, move);
  }

  function inlineKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    // The editor owns all keys while open — nothing may reach the grid handler.
    e.stopPropagation();
    // IME composition: Enter/Tab/Escape while an input method is composing
    // (e.g. 中文输入法选词) belong to the IME, not to the edit session — the
    // candidate-confirming Enter must not commit the cell.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitInline('down');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitInline('right');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closedRef.current = true;
      onCancel();
    }
  }

  const inlineInput = (type: string) => (
    <Input
      className="h-full rounded-none border-0 bg-muted px-2.5 focus-visible:border-0 focus-visible:ring-0"
      type={type}
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={inlineKeyDown}
      onBlur={() => commitInline(null)}
    />
  );

  switch (field.type) {
    case FieldType.Text:
      return inlineInput('text');
    case FieldType.Number:
      return inlineInput('number');
    case FieldType.Date: {
      const includeTime = (field.options.includeTime as boolean | undefined) ?? false;
      return inlineInput(includeTime ? 'datetime-local' : 'date');
    }

    case FieldType.SingleSelect: {
      const choices = (field.options.choices as SelectOption[] | undefined) ?? [];
      const selected = choices.find((c) => c.id === (value as string | undefined));
      return (
        <Select
          value={(value as string | undefined) ?? ''}
          open
          onOpenChange={(o) => {
            if (!o && !closedRef.current) {
              closedRef.current = true;
              onCancel();
            }
          }}
          onValueChange={(v) => {
            if (typeof v !== 'string') return;
            closedRef.current = true;
            onCommit(v, null);
          }}
        >
          <SelectTrigger className="h-full w-full rounded-none border-0 bg-muted px-2.5 focus-visible:ring-0">
            {selected ? (
              <span className="flex min-w-0 items-center">
                <span
                  className="mr-1.5 inline-block size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: selected.color }}
                />
                <span className="truncate">{selected.name}</span>
              </span>
            ) : (
              EMPTY
            )}
          </SelectTrigger>
          <SelectContent>
            {choices.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block size-1.5 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  {c.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case FieldType.User: {
      const selected = users.find((u) => u.id === (value as string | undefined));
      const label = selected ? (selected.name ?? selected.email ?? selected.id) : '';
      return (
        <Select
          value={(value as string | undefined) ?? ''}
          open
          onOpenChange={(o) => {
            if (!o && !closedRef.current) {
              closedRef.current = true;
              onCancel();
            }
          }}
          onValueChange={(v) => {
            if (typeof v !== 'string' || !v) return;
            closedRef.current = true;
            onCommit(v, null);
          }}
        >
          <SelectTrigger className="h-full w-full rounded-none border-0 bg-muted px-2.5 focus-visible:ring-0">
            {selected ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <Avatar label={label} />
                <span className="truncate">{label}</span>
              </span>
            ) : (
              EMPTY
            )}
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                <span className="flex items-center gap-1.5">
                  <Avatar label={u.name ?? u.email ?? u.id} />
                  {u.name ?? u.email}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case FieldType.MultiSelect: {
      const choices = (field.options.choices as SelectOption[] | undefined) ?? [];
      const selectedChips = choices.filter((c) => multiSelected.includes(c.id));
      return (
        <Popover
          open
          onOpenChange={(o) => {
            if (!o && !closedRef.current) {
              closedRef.current = true;
              onCancel();
            }
          }}
        >
          <PopoverTrigger className="flex h-full w-full items-center px-2.5 text-left text-sm">
            {selectedChips.length === 0 ? (
              EMPTY
            ) : (
              <span className="flex min-w-0 items-center">
                {selectedChips.slice(0, 2).map((c) => (
                  <span key={c.id} className="mr-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                    {c.name}
                  </span>
                ))}
                {selectedChips.length > 2 ? (
                  <span className="text-xs text-muted-foreground">+{selectedChips.length - 2}</span>
                ) : null}
              </span>
            )}
          </PopoverTrigger>
          <PopoverContent className="w-56">
            {choices.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                <input
                  type="checkbox"
                  checked={multiSelected.includes(c.id)}
                  onChange={() => {
                    const next = multiSelected.includes(c.id)
                      ? multiSelected.filter((x) => x !== c.id)
                      : [...multiSelected, c.id];
                    setMultiSelected(next);
                    onWrite(next);
                  }}
                />
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block size-1.5 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  {c.name}
                </span>
              </label>
            ))}
          </PopoverContent>
        </Popover>
      );
    }

    case FieldType.Link:
      return (
        <LinkCellEditor
          recordIds={(value as string[] | undefined) ?? []}
          targetTableId={field.options.targetTableId as string | undefined}
          onWrite={onWrite}
          onClose={() => {
            if (closedRef.current) return;
            closedRef.current = true;
            onCancel();
          }}
        />
      );

    default:
      // Boolean/Expression/Attachment never enter edit mode.
      return null;
  }
}
