'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  CellRenderer,
  EditingCell,
  type FieldLike,
  type RecordLike,
  type UserLike,
} from '@/app/bases/[baseId]/tables/[tableId]/cell-renderers';
import { FieldType } from '@/lib/field-types';
import { Button } from '@/components/ui/button';

/** A single editing session, shared with the Grid's existing typed cell editors. */
export function RecordFieldEditor({
  field,
  record,
  users,
  baseId,
  readOnly,
  onSave,
}: {
  field: FieldLike;
  record: RecordLike;
  users: UserLike[];
  baseId?: string;
  readOnly: boolean;
  onSave: (fieldId: string, value: unknown) => Promise<void>;
}) {
  const labelId = useId();
  const [draftRecord, setDraftRecord] = useState<RecordLike | null>(null);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const queued = useRef<{ value: unknown; close: boolean } | null>(null);
  const mounted = useRef(false);
  const retry = useRef<{ value: unknown; close: boolean } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const locked = readOnly || field.type === FieldType.Expression;
  const inline = new Set<FieldType>([
    FieldType.Text,
    FieldType.Number,
    FieldType.Date,
    FieldType.SingleSelect,
    FieldType.User,
    FieldType.MultiSelect,
    FieldType.Link,
  ]).has(field.type);

  async function save(value: unknown, close: boolean) {
    if (locked) return;
    if (inFlight.current) {
      // Popover controls live outside the disabled fieldset. Keep their latest
      // selection and serialize it after the current write instead of dropping it.
      if (!close) queued.current = { value, close };
      return;
    }
    inFlight.current = true;
    retry.current = { value, close };
    if (mounted.current) {
      setSaving(true);
      setError('');
    }
    let succeeded = false;
    try {
      await onSave(field.id, value);
      succeeded = true;
      if (!mounted.current) return;
      retry.current = null;
      if (close) setDraftRecord(null);
      else if (inline)
        setDraftRecord((previous) =>
          previous
            ? {
                ...record,
                ...previous,
                cells: { ...previous.cells, [field.id]: value },
              }
            : null,
        );
    } catch (cause) {
      if (!mounted.current) return;
      const failed = queued.current ?? { value, close };
      queued.current = null;
      retry.current = failed;
      setError(cause instanceof Error ? cause.message : 'Unable to save field');
      if (inline) {
        // Existing inline editors seal the session on commit. A failed save
        // starts a retry session with the exact typed value, restoring focus.
        setDraftRecord((previous) => ({
          ...record,
          ...previous,
          cells: { ...(previous ?? record).cells, [field.id]: failed.value },
        }));
        setRevision((previous) => previous + 1);
      }
    } finally {
      inFlight.current = false;
      const next = queued.current;
      queued.current = null;
      if (succeeded && next) void save(next.value, next.close);
      else if (mounted.current) setSaving(false);
    }
  }
  return (
    <div className="space-y-2">
      <div id={labelId} className="text-sm font-medium">
        {field.name}
      </div>
      <fieldset
        disabled={saving}
        aria-labelledby={labelId}
        className="min-h-9 min-w-0 rounded border border-border py-2"
      >
        {!locked && draftRecord ? (
          <EditingCell
            commitOnBlur={false}
            key={revision}
            field={field}
            record={draftRecord}
            users={users}
            baseId={baseId}
            onCommit={(value) => void save(value, true)}
            onWrite={(value) => void save(value, false)}
            onCancel={() => {
              setDraftRecord(null);
              setError('');
            }}
          />
        ) : (
          <CellRenderer
            field={field}
            record={record}
            users={users}
            baseId={baseId}
            readOnly={locked}
            onUpsertCell={(_id, _field, value) => save(value, false)}
          />
        )}
      </fieldset>
      {!locked && inline && !draftRecord && (
        <Button
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={() => setDraftRecord(record)}
        >
          Edit {field.name}
        </Button>
      )}
      {saving && (
        <p role="status" className="text-xs text-muted-foreground">
          Saving…
        </p>
      )}
      {error && (
        <div role="alert" className="text-sm text-destructive">
          {error}{' '}
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => {
              const last = retry.current;
              if (last) void save(last.value, last.close);
            }}
          >
            Retry save
          </Button>
        </div>
      )}
    </div>
  );
}
