import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { trpc } from '@/lib/trpc/client';
import type { BatchInput } from '@/server/records/write-batch';
import { EDITABLE_TYPES } from './grid-row';
import { parseClipboardValue } from './clipboard';
import type { FieldLike, RecordLike } from './cell-renderers';
import { parseTsv, planPaste } from './paste';

type Anchor = { recordId: string; fieldId: string };
type Preparation = { scopeKey: string; anchor: Anchor; matrix: string[][] };
type Pending = {
  scopeKey: string;
  request: BatchInput;
  firstAttemptAt: number | null;
  failed: boolean;
};
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function useGridPaste({
  tableId,
  scopeKey,
  rows: loadedRows,
  fields,
  users,
  selectedCell,
  readOnly,
  editing,
  total,
  fetching,
  pageError,
  allowAppend,
  showMore,
}: {
  tableId: string;
  scopeKey: string;
  rows: RecordLike[];
  fields: FieldLike[];
  users: Parameters<typeof parseClipboardValue>[1];
  selectedCell: Anchor | null;
  readOnly: boolean;
  editing: boolean;
  total: number;
  fetching: boolean;
  pageError: boolean;
  allowAppend: boolean;
  showMore: () => void;
}) {
  const utils = trpc.useUtils();
  const mutation = trpc.record.writeBatch.useMutation();
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const loading = useRef<{
    preparation: Preparation | null;
    requestedAt: number | null;
    observedFetching: boolean;
    pages: number;
  }>({ preparation: null, requestedAt: null, observedFetching: false, pages: 0 });
  const invalid = readOnly || editing;
  // Visiting the same scope again never restores ownership of canceled work.
  // Update during render so a late promise cannot beat cancellation effects.
  const ownership = useRef({ scopeKey, invalid, generation: 0 });
  if (ownership.current.scopeKey !== scopeKey || ownership.current.invalid !== invalid) {
    ownership.current = { scopeKey, invalid, generation: ownership.current.generation + 1 };
  }
  // Scope is stored on every operation; stale requests can never be confirmed.
  const ready = pending?.scopeKey === scopeKey && !invalid ? pending : null;
  const preparing = preparation?.scopeKey === scopeKey && !invalid ? preparation : null;
  useEffect(() => {
    if (invalid || preparation?.scopeKey !== scopeKey) setPreparation(null);
    if (invalid || pending?.scopeKey !== scopeKey) setPending(null);
  }, [invalid, scopeKey, preparation?.scopeKey, pending?.scopeKey]);
  useEffect(() => {
    if (!preparing) return;
    if (loading.current.preparation !== preparing)
      loading.current = {
        preparation: preparing,
        requestedAt: null,
        observedFetching: false,
        pages: 0,
      };
    if (fetching) {
      loading.current.observedFetching = true;
      return;
    }
    try {
      const row = loadedRows.findIndex((r) => r.id === preparing.anchor.recordId);
      const column = fields.findIndex((f) => f.id === preparing.anchor.fieldId);
      if (row < 0 || column < 0) throw Error('The selected cell is no longer available');
      const required = Math.min(row + preparing.matrix.length, total);
      if (required > loadedRows.length) {
        if (pageError) return;
        const load = loading.current;
        if (load.requestedAt === loadedRows.length) {
          if (load.observedFetching)
            throw Error('No additional rows loaded. Cancel and try again.');
          return;
        }
        if (load.pages >= 2)
          throw Error('Rows changed while preparing paste. Cancel and try again.');
        load.pages++;
        load.requestedAt = loadedRows.length;
        load.observedFetching = false;
        showMore();
        return;
      }
      const planned = planPaste(
        preparing.matrix,
        loadedRows.map((r) => r.id),
        fields.map((f) => f.id),
        { row, column },
        allowAppend,
      );
      const rows = planned.map((r) => ({
        recordId: r.recordId,
        cells: Object.fromEntries(
          r.values.map((v) => {
            const field = fields.find((f) => f.id === v.fieldId)!;
            if (!EDITABLE_TYPES.has(field.type))
              throw Error(`Field ${field.name} cannot be pasted into`);
            const parsed = parseClipboardValue(field, users, v.text);
            if (!parsed.ok) throw Error(parsed.reason);
            return [v.fieldId, parsed.value];
          }),
        ),
      }));
      setPending({
        scopeKey: scopeKey,
        request: { tableId: tableId, requestId: crypto.randomUUID(), rows },
        firstAttemptAt: null,
        failed: false,
      });
      setPreparation(null);
    } catch (err) {
      toast.error(`Paste rejected: ${err instanceof Error ? err.message : 'Invalid clipboard'}`);
      setPreparation(null);
    }
  }, [
    preparing,
    loadedRows,
    fields,
    total,
    fetching,
    pageError,
    allowAppend,
    showMore,
    scopeKey,
    tableId,
    users,
  ]);
  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    const target = e.target;
    if (
      invalid ||
      busy ||
      ready ||
      preparing ||
      (target instanceof HTMLElement &&
        target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'))
    )
      return;
    e.preventDefault();
    if (!selectedCell) {
      toast.error('Select a cell before pasting');
      return;
    }
    try {
      setPreparation({
        scopeKey: scopeKey,
        anchor: { ...selectedCell },
        matrix: parseTsv(e.clipboardData.getData('text/plain')),
      });
    } catch (err) {
      toast.error(`Paste rejected: ${err instanceof Error ? err.message : 'Invalid clipboard'}`);
    }
  }
  async function confirm() {
    if (!ready || inFlight.current || invalid) return;
    if (ready.firstAttemptAt !== null && Date.now() - ready.firstAttemptAt >= RETENTION_MS) {
      toast.error(
        'This paste is more than 7 days old and cannot be safely retried. Check the records before preparing a new paste.',
      );
      setPending(null);
      return;
    }
    const generation = ownership.current.generation;
    const operation = { ...ready, firstAttemptAt: ready.firstAttemptAt ?? Date.now() };
    setPending(operation);
    inFlight.current = true;
    setBusy(true);
    try {
      await mutation.mutateAsync(operation.request);
      if (ownership.current.generation === generation) setPending(null);
      await utils.record.list.invalidate({ tableId: operation.request.tableId }).catch(() => {
        if (ownership.current.generation === generation)
          toast.error('Paste saved, but records could not be refreshed. Reload the view.');
      });
    } catch (err) {
      if (ownership.current.generation !== generation) return;
      const code = (err as { data?: { code?: string } })?.data?.code;
      if (code && code !== 'TIMEOUT' && code !== 'INTERNAL_SERVER_ERROR') setPending(null);
      else setPending({ ...operation, failed: true });
      toast.error(err instanceof Error ? err.message : 'Paste failed');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const created = ready?.request.rows.filter((r) => !r.recordId).length ?? 0;
  const count = ready?.request.rows.length ?? 0;
  return {
    onPaste,
    cancel: () => {
      if (!inFlight.current) {
        setPreparation(null);
        setPending(null);
      }
    },
    dialog: (
      <>
        {preparing && (
          <div role="status" className="flex items-center gap-2 text-sm">
            Loading rows for paste…
            <Button variant="outline" onClick={() => setPreparation(null)}>
              Cancel paste
            </Button>
          </div>
        )}
        <ConfirmDialog
          open={Boolean(ready)}
          onOpenChange={(open) => {
            if (!open && !inFlight.current) setPending(null);
          }}
          title="Confirm paste"
          description={`${count - created} records updated, ${created} records created, ${ready?.request.rows.reduce((n, r) => n + Object.keys(r.cells).length, 0) ?? 0} cells written.`}
          confirmLabel={ready?.failed ? 'Retry paste' : 'Paste'}
          pending={busy}
          onConfirm={() => void confirm()}
        />
      </>
    ),
  };
}
