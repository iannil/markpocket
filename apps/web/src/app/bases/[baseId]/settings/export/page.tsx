'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';

import { useBreadcrumbSetter } from '@/lib/breadcrumb-context';
import { trpc } from '@/lib/trpc/client';

export default function ExportTab() {
  const { baseId } = useParams<{ baseId: string }>();
  const utils = trpc.useUtils();
  const { data: tables, isLoading: tablesLoading } = trpc.table.list.useQuery({ baseId });
  useBreadcrumbSetter([{ label: 'Export' }]);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Truncation notices are informational, not failures — rendering them in
  // the error channel showed successful exports in destructive red.
  const [note, setNote] = useState<string | null>(null);

  // Init selected to all tables once data loads
  const selectedSet = selected ?? new Set(tables?.map((t) => t.id) ?? []);

  function toggle(id: string) {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    setNote(null);
    try {
      const files = await utils.client.export.exportBase.query({
        baseId,
        tableIds: [...selectedSet],
      });
      const truncated = files.filter((f) => f.truncated);

      let downloaded = 0;
      for (const file of files) {
        const url = URL.createObjectURL(new Blob([file.csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        downloaded += 1;
        // Small delay between downloads to avoid browser blocking
        await new Promise((r) => setTimeout(r, 200));
      }
      if (truncated.length > 0) {
        setNote(
          truncated.map((f) => `${f.name} truncated at 10,000 of ${f.total} records`).join('; '),
        );
      } else if (downloaded > 1) {
        // Browsers gate automatic multi-file downloads behind a permission
        // prompt; a.click() cannot detect the block, so surface the hint
        // instead of failing silently.
        setNote(
          `${downloaded} downloads started. If your browser asked to allow multiple downloads, choose “Allow” or retry.`,
        );
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  if (tablesLoading) {
    return <div className="h-8 animate-pulse rounded bg-muted" />;
  }

  if (!tables || tables.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">No tables to export.</div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Select tables to export as CSV files. Each table downloads as a separate file.
      </p>

      <ul className="border-t border-border">
        {tables.map((t) => (
          <li key={t.id} className="flex items-center gap-3 border-b border-border px-2 py-2.5">
            <input
              type="checkbox"
              id={`t-${t.id}`}
              checked={selectedSet.has(t.id)}
              onChange={() => toggle(t.id)}
              className="h-4 w-4 rounded border-input"
            />
            <label htmlFor={`t-${t.id}`} className="text-sm">
              {t.name}
            </label>
          </li>
        ))}
      </ul>

      <button
        onClick={handleExport}
        disabled={exporting || selectedSet.size === 0}
        className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {exporting ? 'Exporting…' : `Export ${selectedSet.size} table(s)`}
      </button>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
