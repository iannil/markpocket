// apps/web/src/lib/format.ts
// Shared display formatters for cell values and timestamps (history views).

/** Compact display for an arbitrary cell value (history lists, read-only views). */
export function fmtVal(v: unknown): string {
  if (v == null) return '(empty)';
  if (typeof v === 'string') return v === '' ? '(empty)' : v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === 'object' && v !== null && '__error' in v) {
    return `error: ${(v as { __error: string }).__error}`;
  }
  return JSON.stringify(v).slice(0, 40);
}

/** Relative time ("just now" / "5m ago" / "3h ago"), falling back to a date. */
export function fmtTime(iso: Date | string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}
