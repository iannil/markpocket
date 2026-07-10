import type { ComponentType } from 'react';

type Ctx = {
  tables: Array<{ id: string; name: string }>;
  onExport: (tableId: string) => void;
  onImport: (tableId: string, file: File) => void;
};

const Component: ComponentType<{ ctx?: unknown }> = ({ ctx }) => {
  const c = ctx as Ctx;
  return (
    <ul className="border-t border-border">
      {c.tables.map((t) => (
        <li
          key={t.id}
          className="flex items-center justify-between rounded border-b border-border px-2 py-2.5 hover:bg-muted"
        >
          <span className="text-sm">{t.name}</span>
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => c.onExport(t.id)}
            >
              download →
            </button>
            <label className="cursor-pointer hover:text-foreground">
              import
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && c.onImport(t.id, e.target.files[0])}
              />
            </label>
          </span>
        </li>
      ))}
    </ul>
  );
};

export default { slotId: 'table-tools', Component };
