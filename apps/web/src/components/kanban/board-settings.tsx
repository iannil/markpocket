'use client';

import { useEffect, useRef, useState } from 'react';
import type { FieldLike } from '@/app/bases/[baseId]/tables/[tableId]/cell-renderers';
import { Button } from '@/components/ui/button';
import { KANBAN_TITLE_TYPES, validateKanbanFields, type KanbanConfig } from '@/lib/kanban-config';
import { parseViewOptionsStrict } from '@/lib/view-ast';
import { toast } from '@/lib/toast';
import { trpc } from '@/lib/trpc/client';

export function BoardSettings({
  tableId,
  viewId,
  fields,
  options,
  onSaved,
  onEditing,
}: {
  tableId: string;
  viewId: string;
  fields: FieldLike[];
  options: Record<string, unknown>;
  onSaved: () => void;
  onEditing: () => void;
}) {
  const saved = parseViewOptionsStrict(options)?.kanban;
  const snapshot = JSON.stringify(options);
  const [draft, setDraft] = useState<{ config: KanbanConfig; baseline: string } | null>(null);
  const config = draft?.config ?? saved ?? { groupFieldId: '' };
  const conflict = draft !== null && draft.baseline !== snapshot;
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const utils = trpc.useUtils();
  const save = trpc.view.updateOptions.useMutation();
  const mounted = useRef(false);
  const submitting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function update(next: KanbanConfig) {
    if (submitting.current) return;
    onEditing();
    setError('');
    setDraft({ config: next, baseline: draft?.baseline ?? snapshot });
  }
  async function submit() {
    if (conflict || save.isPending || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      validateKanbanFields(config, fields);
      await save.mutateAsync({ id: viewId, options: { ...options, kanban: config } });
      // Refresh committed metadata even if the user has switched views.
      await utils.view.list.invalidate({ tableId });
      if (!mounted.current) return;
      setDraft(null);
      onSaved();
    } catch (cause) {
      if (!mounted.current) return;
      const message = cause instanceof Error ? cause.message : 'Unable to save board';
      setError(message);
      toast.error(message);
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label>
        Status field
        <select
          aria-label="Status field"
          disabled={saving || save.isPending}
          className="ml-2 rounded border bg-background p-2"
          value={config.groupFieldId}
          onChange={(event) => update({ ...config, groupFieldId: event.target.value })}
        >
          <option value="">Choose a status field</option>
          {fields
            .filter((field) => field.type === 'single-select')
            .map((field) => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        Title field
        <select
          aria-label="Title field"
          disabled={saving || save.isPending}
          className="ml-2 rounded border bg-background p-2"
          value={config.titleFieldId ?? ''}
          onChange={(event) =>
            update({
              groupFieldId: config.groupFieldId,
              ...(event.target.value ? { titleFieldId: event.target.value } : {}),
            })
          }
        >
          <option value="">Record ID</option>
          {fields
            .filter((field) => KANBAN_TITLE_TYPES.has(field.type))
            .map((field) => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
        </select>
      </label>
      <Button
        type="submit"
        size="sm"
        disabled={saving || save.isPending || conflict || !config.groupFieldId}
      >
        Save board
      </Button>
      {draft && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={saving || save.isPending}
          onClick={() => {
            if (submitting.current) return;
            setDraft(null);
            setError('');
          }}
        >
          Discard changes
        </Button>
      )}
      {conflict && (
        <p role="alert">
          Board settings changed remotely. Discard changes to use the latest settings.
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
