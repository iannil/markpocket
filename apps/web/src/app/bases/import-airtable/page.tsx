'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { useBreadcrumbSetter } from '@/lib/breadcrumb-context';
import { trpc } from '@/lib/trpc/client';
import type { ImportReport, Preflight } from '@/server/imports/airtable/types';

const storageKey = 'airtable-import-request-id';
const inputClass =
  'mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const buttonClass =
  'inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50';

export default function AirtableImportPage() {
  useBreadcrumbSetter([{ label: 'Import from Airtable' }]);
  const [sourceBaseId, setSourceBaseId] = useState('');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<Preflight | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState('');
  const utils = trpc.useUtils();
  const [checking, setChecking] = useState(false);
  const cancel = trpc.airtableImport.cancel.useMutation();
  const status = trpc.airtableImport.status.useQuery(
    { requestId: requestId ?? '' },
    { enabled: !!requestId && !report, refetchInterval: running || requestId ? 1000 : false },
  );

  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (saved && /^[0-9a-f-]{36}$/i.test(saved)) setRequestId(saved);
  }, []);
  useEffect(() => {
    if (status.data?.status === 'complete') {
      setReport(status.data.report);
      setRunning(false);
      setToken('');
      sessionStorage.removeItem(storageKey);
    }
  }, [status.data]);

  function invalidatePreview() {
    setPreview(null);
    setAccepted(false);
    setError('');
  }
  async function onPreview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setPreview(null);
    setAccepted(false);
    setChecking(true);
    try {
      const result = await utils.client.airtableImport.preflight.mutate({ sourceBaseId, token });
      setPreview(result);
    } catch (err) {
      setToken('');
      setError(err instanceof Error ? err.message : 'Preflight failed');
    } finally {
      setChecking(false);
    }
  }
  async function onStart() {
    if (!preview || (preview.issues.length > 0 && !accepted) || !token || !name.trim() || running)
      return;
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    sessionStorage.setItem(storageKey, id);
    setError('');
    setCancelled(false);
    setReport(null);
    setRunning(true);
    try {
      const result = await utils.client.airtableImport.start.mutate({
        requestId: id,
        sourceBaseId,
        token,
        name: name.trim(),
        schemaHash: preview.schemaHash,
        acceptLosses: accepted,
      });
      setReport(result);
      sessionStorage.removeItem(storageKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setRunning(false);
      setToken('');
    }
  }
  async function onCancel() {
    if (!requestId || cancelPending) return;
    setCancelPending(true);
    setError('');
    try {
      const result = await cancel.mutateAsync({ requestId });
      if (result.cancelled) {
        setCancelled(true);
        setToken('');
      } else {
        await status.refetch();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm cancellation');
    } finally {
      setCancelPending(false);
    }
  }
  function downloadReport() {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `airtable-import-${report.requestId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-lg font-semibold">Import from Airtable</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a new Base from one Airtable Base. Existing Bases are never overwritten.
          </p>
        </header>
        <div className="rounded-md border border-border p-4 text-xs leading-5 text-muted-foreground">
          <p>
            Give the personal access token only <strong>schema.bases:read</strong> and{' '}
            <strong>data.records:read</strong>, authorized for this source Base. No write scope is
            needed.
          </p>
          <p className="mt-2">
            Pause edits in Airtable while importing. Airtable pages do not provide a consistent
            snapshot across requests. Automations, Interfaces, views, permissions, comments, and
            history are not imported.
          </p>
          <p className="mt-2">
            Limits: 20 tables, 100 fields per table, 10,000 records, 100,000 nonempty cells, 16 MiB
            record data, 200 attachments, 10 MiB each and 64 MiB total. Imports have a 120 second
            deadline and require local storage.
          </p>
        </div>
        <form method="post" onSubmit={(e) => void onPreview(e)} className="space-y-3">
          <label className="block text-xs">
            Airtable Base ID
            <input
              required
              maxLength={64}
              pattern="app[A-Za-z0-9]{8,61}"
              value={sourceBaseId}
              onChange={(e) => {
                setSourceBaseId(e.target.value);
                invalidatePreview();
              }}
              className={inputClass}
              placeholder="app…"
            />
          </label>
          <label className="block text-xs">
            Read-only personal access token
            <input
              required
              type="password"
              autoComplete="off"
              maxLength={1024}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs">
            New Base name
            <input
              required
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </label>
          <button
            className={buttonClass}
            type="submit"
            disabled={checking || running || !sourceBaseId || !token || !name.trim()}
          >
            {checking ? 'Checking…' : 'Preview import'}
          </button>
        </form>
        {preview && (
          <section
            className="space-y-3 rounded-md border border-border p-4"
            aria-label="Import preview"
          >
            <h2 className="text-sm font-semibold">Preview</h2>
            {preview.tables.map((table) => (
              <div key={table.sourceId} className="text-xs">
                <p className="font-medium">
                  {table.name} · {table.fields.length} mapped fields
                </p>
                <ul className="ml-4 list-disc text-muted-foreground">
                  {table.fields.map((field) => (
                    <li key={field.sourceId}>
                      {field.name} → {field.type}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {preview.issues.length > 0 && (
              <div>
                <p className="text-xs font-medium">Static values and skipped fields</p>
                <ul className="ml-4 list-disc text-xs text-muted-foreground">
                  {preview.issues.map((issue) => (
                    <li key={`${issue.tableId}-${issue.fieldId}`}>
                      {issue.kind === 'snapshot' ? 'Static snapshot' : 'Skipped'}: {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.issues.length > 0 && (
              <label className="flex gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                I understand these static values and skipped fields
              </label>
            )}
            <button
              type="button"
              className={buttonClass}
              disabled={
                running || !token || !name.trim() || (preview.issues.length > 0 && !accepted)
              }
              onClick={() => void onStart()}
            >
              Create new Base
            </button>
          </section>
        )}
        {running && (
          <section
            className="space-y-2 rounded-md border border-border p-4 text-sm"
            aria-live="polite"
          >
            <p>
              Import running
              {status.data?.status === 'running'
                ? ` · ${status.data.progress.phase} · ${status.data.progress.records} records · ${status.data.progress.attachments} attachments`
                : ''}
            </p>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-xs"
              disabled={cancelPending}
              onClick={() => void onCancel()}
            >
              {cancelPending ? 'Cancelling…' : 'Cancel import'}
            </button>
            {cancelled && <p>Cancellation requested. Checking whether the import completed.</p>}
          </section>
        )}
        {status.isError && requestId && !report && (
          <p role="alert" className="text-sm text-destructive">
            Could not check import status.{' '}
            <button type="button" className="underline" onClick={() => void status.refetch()}>
              Retry status
            </button>
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!running && cancelled && !report && (
          <p className="text-sm">
            Import cancelled. To retry, enter the token again and use the same request ID.
          </p>
        )}
        {!running && requestId && !report && !preview && (
          <p className="text-xs text-muted-foreground">
            Request {requestId}:{' '}
            {status.data?.status === 'not-running'
              ? 'No running import found. Enter the token and preview again to retry.'
              : 'Checking import status…'}
          </p>
        )}
        {report && (
          <section
            className="space-y-2 rounded-md border border-border p-4 text-sm"
            aria-label="Import result"
          >
            <h2 className="font-semibold">Import complete</h2>
            <p>
              {report.tables.length} tables · {report.records} records · {report.cells} cells ·{' '}
              {report.attachments} attachments
            </p>
            {report.issues.length > 0 && (
              <ul className="ml-4 list-disc text-xs">
                {report.issues.map((issue) => (
                  <li key={`${issue.tableId}-${issue.fieldId}`}>{issue.message}</li>
                ))}
              </ul>
            )}
            <div className="flex gap-3">
              <Link href={`/bases/${report.baseId}`} className="underline">
                Open new Base
              </Link>
              <button type="button" className="underline" onClick={downloadReport}>
                Download JSON report
              </button>
            </div>
          </section>
        )}
        <Link href="/bases" className="text-xs text-muted-foreground underline">
          Back to Workspace
        </Link>
      </div>
    </div>
  );
}
