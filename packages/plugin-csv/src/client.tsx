import { useState, type ComponentType } from 'react';

type Ctx = {
  tables: Array<{ id: string; name: string }>;
  onExport: (tableId: string) => void;
  onImport: (tableId: string, file: File) => void | Promise<void>;
};

const Component: ComponentType<{ ctx?: unknown }> = ({ ctx }) => {
  const c = ctx as Ctx;
  // Per-table import state: imports of a 5MB/50k-row CSV run for tens of
  // seconds — the control must show progress and block a second concurrent
  // import of the same table (duplicated rows).
  const [busyTableId, setBusyTableId] = useState<string | null>(null);
  return (
    <ul className="border-t border-border">
      {c.tables.map((t) => {
        const busy = busyTableId === t.id;
        return (
          <li
            key={t.id}
            className="flex items-center justify-between rounded border-b border-border px-2 py-2.5 hover:bg-muted"
          >
            <span className="text-sm">{t.name}</span>
            <span className="flex items-center gap-3 text-xs text-muted-foreground">
              <button
                type="button"
                className="hover:text-foreground disabled:opacity-50"
                onClick={() => c.onExport(t.id)}
                disabled={busy}
              >
                download →
              </button>
              <label
                className={`hover:text-foreground ${busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
              >
                {busy ? 'importing…' : 'import'}
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Reset the value so picking the SAME file again fires
                    // onChange — the standard retry path after a failed or
                    // partial import, previously silently dead.
                    e.target.value = '';
                    if (!file) return;
                    setBusyTableId(t.id);
                    // onImport reports its own errors (toasts); busy state
                    // releases when its promise settles, success or not.
                    void Promise.resolve(c.onImport(t.id, file)).finally(() =>
                      setBusyTableId(null),
                    );
                  }}
                />
              </label>
            </span>
          </li>
        );
      })}
    </ul>
  );
};

export default { slotId: 'table-tools', Component };
