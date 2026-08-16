'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';

import { trpc } from '@/lib/trpc/client';

export default function ExportTab() {
  const { baseId } = useParams<{ baseId: string }>();
  const utils = trpc.useUtils();
  const { data: tables, isLoading: tablesLoading } = trpc.table.list.useQuery({ baseId });
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const files = await utils.client.export.exportBase.query({ baseId });
      // Server returns files for ALL tables; filter down to the selected ones by
      // matching each file name against the selected table's safe name.
      const filtered = files.filter((f) => {
        const tableName = f.name.replace(/\.csv$/, '');
        return [...selectedSet].some((id) => {
          const t = tables?.find((t2) => t2.id === id);
          const safeName = t?.name.replace(/[^a-zA-Z0-9_-]/g, '_') || t?.id;
          return safeName === tableName;
        });
      });

      for (const file of filtered) {
        const url = URL.createObjectURL(new Blob([file.csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        // Small delay between downloads to avoid browser blocking
        await new Promise((r) => setTimeout(r, 200));
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
        {exporting ? 'Exporting...' : `Export ${selectedSet.size} table(s)`}
      </button>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
