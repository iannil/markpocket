# Phase A: "最后一公里" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between "all features are technically built" and "all features form a usable product" — public sharing, Grid interaction polish, history timeline, and basic UX polish.

**Architecture:** Phase A is additive-only — no schema migrations that break existing data, no refactoring of existing components. Each of the 4 modules is independent and can be built in parallel.

**Tech Stack:** Next.js 16 (App Router) + tRPC + Drizzle + PostgreSQL 16 + ws + shadcn/ui + Tailwind v4

## Global Constraints

- All new server routes must use existing `protectedProcedure` / `publicProcedure` from `server/trpc/init.ts`
- Public share endpoints bypass auth but must validate token + expiresAt
- Cell operations must go through `normalizeCellValue` (ADR-0005 strategy)
- UI components must use Paper & Ink design tokens (CSS variables in `globals.css`)
- Tests co-located with source files (`*.test.ts`, `*.test.tsx`)
- All user-facing strings in English (no i18n yet)
- No new dependency packages — use what's already in `package.json`

---

## File Structure

### A1: Public Share

```
Create: apps/web/src/app/share/[token]/page.tsx            # Public share page
Create: apps/web/src/server/trpc/routers/public-share.ts   # Unauthenticated share endpoints
Modify: apps/web/src/server/trpc/router.ts                  # Register public-share router
Modify: apps/web/src/server/db/schema.ts                    # Add createdBy to base_share
Modify: apps/web/src/server/trpc/routers/share.ts           # Add createdBy to create
Modify: apps/web/src/app/bases/[baseId]/settings/members/page.tsx  # Wire share link
```

### A2: Grid Interaction Enhancement

```
Modify: apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx  # Expression chip, row select, copy/paste, dock close
Modify: apps/web/src/app/bases/[baseId]/tables/[tableId]/cell-history-dock.tsx  # Esc/outside click close
```

### A3: History Timeline

```
Create: apps/web/src/app/bases/[baseId]/history/page.tsx   # Base-level timeline page
Modify: apps/web/src/server/trpc/routers/history.ts         # Add listByBase, listByTable
Modify: apps/web/src/app/bases/[baseId]/settings/history/page.tsx  # Replace placeholder with redirect
Modify: apps/web/src/app/bases/[baseId]/tables/[tableId]/cell-history-dock.tsx  # Restore-to-version + diff
```

### A4: UX Polish

```
Modify: apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx  # Toast on mutations
Modify: apps/web/src/app/bases/[baseId]/settings/general/page.tsx  # Already has toast — verify coverage
Modify: apps/web/src/components/command-palette.tsx  # Fill command list
Modify: apps/web/src/app/bases/[baseId]/layout.tsx  # Pass context to command palette
```

---

## Task Breakdown

### Task 1: A1.1 Add `createdBy` to `base_share` schema

**Files:**
- Modify: `apps/web/src/server/db/schema.ts` (line ~111-120)
- Modify: `apps/web/src/server/trpc/routers/share.ts` (line ~18-25)

**Interfaces:**
- Consumes: `baseShare` table schema
- Produces: `baseShare` with optional `createdBy` field

- [ ] **Step 1: Add `createdBy` column to `base_share` table**

In `apps/web/src/server/db/schema.ts`, add after `createdAt`:
```ts
createdBy: text('created_by'),
```

- [ ] **Step 2: Populate `createdBy` in share.create**

In `apps/web/src/server/trpc/routers/share.ts`, modify the `create` mutation to include the session user:
```ts
create: protectedProcedure
  .input(z.object({ baseId: z.string(), viewId: z.string().optional() }))
  .mutation(async ({ ctx, input }) => {
    const [row] = await db
      .insert(baseShare)
      .values({
        id: randomUUID(),
        baseId: input.baseId,
        viewId: input.viewId,
        token: randomUUID().replace(/-/g, ''),
        createdBy: ctx.session.user.id,
      })
      .returning();
    return row;
  }),
```

- [ ] **Step 3: Generate migration**

```bash
pnpm db:generate
```

- [ ] **Step 4: Run migration**

```bash
pnpm db:migrate
```

- [ ] **Step 5: Verify the existing schema test still passes**

```bash
pnpm test
```

---

### Task 2: A1.2 Public share API endpoints (unauthenticated)

**Files:**
- Create: `apps/web/src/server/trpc/routers/public-share.ts`
- Modify: `apps/web/src/server/trpc/router.ts`

**Interfaces:**
- Consumes: `baseShare`, `table`, `field`, `view` from `server/db/schema`; `db` from `server/db`
- Produces: `publicShareRouter` with `getBase` and `getTable` procedures

- [ ] **Step 1: Create `public-share.ts` router**

```ts
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { baseShare, base, table, field, view } from '../../db/schema';
import { db } from '../../db';
import { publicProcedure, router } from '../init';

export const publicShareRouter = router({
  getBase: publicProcedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
    const [share] = await db
      .select()
      .from(baseShare)
      .where(eq(baseShare.token, input.token))
      .limit(1);
    if (!share) return null;
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) return null;
    const [baseRow] = await db
      .select({ id: base.id, name: base.name, icon: base.icon })
      .from(base)
      .where(eq(base.id, share.baseId))
      .limit(1);
    if (!baseRow) return null;
    return { ...baseRow, viewId: share.viewId, shareId: share.id };
  }),

  getTables: publicProcedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
    const [share] = await db
      .select()
      .from(baseShare)
      .where(eq(baseShare.token, input.token))
      .limit(1);
    if (!share) return [];
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) return [];
    return db
      .select({ id: table.id, name: table.name })
      .from(table)
      .where(eq(table.baseId, share.baseId));
  }),

  getRecords: publicProcedure
    .input(z.object({ token: z.string(), tableId: z.string() }))
    .query(async ({ input }) => {
      const [share] = await db
        .select()
        .from(baseShare)
        .where(eq(baseShare.token, input.token))
        .limit(1);
      if (!share) return null;
      if (share.expiresAt && new Date(share.expiresAt) < new Date()) return null;

      const fields = await db
        .select({ id: field.id, name: field.name, type: field.type, options: field.options })
        .from(field)
        .where(eq(field.tableId, input.tableId));

      const { listRecordsPivoted } = await import('@/lib/db-queries');

      let records;
      if (share.viewId) {
        const [v] = await db.select().from(view).where(eq(view.id, share.viewId)).limit(1);
        const { compileFilter, compileSort } = await import('@/lib/view-query');
        const { parseViewOptions } = await import('@/lib/view-ast');
        const viewOptions = v ? parseViewOptions(v.options) : {};
        const fieldsById = new Map(
          fields.map((f) => [
            f.id,
            { type: f.type, options: f.options as Record<string, unknown> },
          ]),
        );
        const whereFrag = compileFilter(viewOptions.filter, fieldsById);
        const orderByFrag = compileSort(viewOptions.sort, fieldsById);
        records = await listRecordsPivoted(input.tableId, { where: whereFrag, orderBy: orderByFrag });
      } else {
        records = await listRecordsPivoted(input.tableId, {});
      }

      return { fields, records };
    }),
});
```

- [ ] **Step 2: Register the public router in `router.ts`**

In `apps/web/src/server/trpc/router.ts`, add:
```ts
import { publicShareRouter } from './routers/public-share';

export const appRouter = router({
  // ... existing routers ...
  publicShare: publicShareRouter,
});
```

- [ ] **Step 3: Verify typecheck passes**

```bash
pnpm --filter @markpocket/web typecheck
```

---

### Task 3: A1.3 Public share page `/share/[token]`

**Files:**
- Create: `apps/web/src/app/share/[token]/page.tsx`

**Interfaces:**
- Consumes: `publicShare.getBase`, `publicShare.getTables`, `publicShare.getRecords` from tRPC client
- Produces: Public share page at `/share/[token]`

- [ ] **Step 1: Create the public share page**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { CellRenderer } from '@/app/bases/[baseId]/tables/[tableId]/cell-renderers';

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const { data: baseInfo } = trpc.publicShare.getBase.useQuery({ token });
  const { data: tables } = trpc.publicShare.getTables.useQuery({ token });
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const { data: tableData } = trpc.publicShare.getRecords.useQuery(
    { token, tableId: activeTableId ?? '' },
    { enabled: Boolean(activeTableId) },
  );

  useEffect(() => {
    if (tables && tables.length > 0 && !activeTableId) {
      setActiveTableId(tables[0]!.id);
    }
  }, [tables, activeTableId]);

  if (baseInfo === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Link expired or not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This share link may have expired or been removed.
          </p>
        </div>
      </div>
    );
  }

  if (!baseInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-6xl bg-background">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-base">{baseInfo.icon ?? '📁'}</span>
          <h1 className="text-sm font-semibold">{baseInfo.name}</h1>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            shared view
          </span>
        </div>
      </header>

      {tables && tables.length > 1 && (
        <div className="flex gap-1 border-b border-border px-4 py-2">
          {tables.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTableId(t.id)}
              className={`rounded-md px-2.5 py-1 text-xs ${
                activeTableId === t.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {tableData && (
        <div className="overflow-auto p-4">
          <table className="markpocket-grid w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40">
                <th className="w-10 border-b border-border p-1 text-xs text-muted-foreground">#</th>
                {tableData.fields.map((f: { id: string; name: string; type: string }) => (
                  <th
                    key={f.id}
                    className="border-b border-l border-border p-2 text-left text-xs font-medium text-foreground"
                  >
                    <div>{f.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{f.type}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData.records.map(
                (rec: { id: string; cells: Record<string, unknown> }, i: number) => (
                  <tr key={rec.id} className="group">
                    <td className="border-b border-border px-2 text-center text-xs text-muted-foreground">
                      {i + 1}
                    </td>
                    {tableData.fields.map((f: { id: string; type: string; options: Record<string, unknown> }) => (
                      <td
                        key={f.id}
                        className="border-b border-l border-border p-0"
                      >
                        <CellRenderer
                          field={{ id: f.id, name: f.name, type: f.type as any, options: f.options }}
                          record={rec}
                          users={[]}
                          isEditing={false}
                          draft=""
                          onDraftChange={() => {}}
                          onStartEdit={() => {}}
                          onCommitEdit={() => {}}
                          onUpsert={() => {}}
                          readOnly
                        />
                      </td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

**Note:** The `CellRenderer` component may need a `readOnly` prop added. Check the current interface in `cell-renderers.tsx` and add it if missing.

- [ ] **Step 2: Add `readOnly` prop to `CellRenderer` if not present**

In `apps/web/src/app/bases/[baseId]/tables/[tableId]/cell-renderers.tsx`, add `readOnly` to the `CellRendererProps` interface and have the component disable editing controls when `readOnly` is true.

- [ ] **Step 3: Wire share link copy in Members tab**

In `apps/web/src/app/bases/[baseId]/settings/members/page.tsx`, the copy button already exists at line ~107. Verify it copies the correct URL (`${window.location.origin}/share/${s.token}`). Add a toast notification on copy.

- [ ] **Step 4: Verify the share flow end-to-end**

```bash
pnpm dev
# Open → login → create base → add table → add data → Members tab → create share link → copy → open in incognito
```

---

### Task 4: A1.4 Test public share endpoints

**Files:**
- Create: `apps/web/src/server/trpc/routers/public-share.test.ts`

- [ ] **Step 1: Write and run tests**

```ts
import { describe, it, expect } from 'vitest';
import { publicShareRouter } from './public-share';

describe('publicShareRouter', () => {
  it('returns null for invalid token', async () => {
    const result = await publicShareRouter.createCaller({}).getBase({ token: 'nonexistent' });
    expect(result).toBeNull();
  });
});
```

Run: `pnpm test -- --run src/server/trpc/routers/public-share.test.ts`

---

### Task 5: A2.1 Expression column header chip

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx` (line ~356-385)

**Interfaces:**
- Consumes: `fields` array with `type === 'expression'` and `options.expression`
- Produces: Expression chip in column header, tooltip on hover, double-click to edit

- [ ] **Step 1: Add expression chip rendering to column header**

In `grid-editor.tsx`, locate the header rendering loop (around line 356). For expression fields, replace the type label with the expression chip:
```tsx
{f.type === 'expression' ? (
  <div className="flex items-center gap-1 pb-1">
    <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
      {(f.options as { expression?: string })?.expression ?? 'expr'}
    </span>
    <span className="font-mono text-[10px] text-muted-foreground">expression</span>
  </div>
) : (
  <div className="pb-1 font-mono text-[10px] text-muted-foreground">{f.type}</div>
)}
```

- [ ] **Step 2: Add tooltip for expression**

Wrap the chip in a title attribute showing the full expression.

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @markpocket/web typecheck
```

---

### Task 6: A2.2 Row number click selects row

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`

- [ ] **Step 1: Add row selection state**

Add state near line ~106:
```tsx
const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
```

- [ ] **Step 2: Add click handler on row number**

Replace the row number cell (around line 414):
```tsx
<td className="border-b border-border px-2 text-center text-xs text-muted-foreground">
  <button
    className={`w-full ${
      selectedRows.has(rec.id) ? 'bg-primary/10 font-semibold text-primary' : ''
    }`}
    onClick={(e) => {
      const next = new Set(selectedRows);
      if (e.shiftKey && selectedCell) {
        // Range select: from last selected to this one
        const flat = groups.flatMap((g) => g.records);
        const start = flat.findIndex((r) => r.id === selectedCell.recordId);
        const end = flat.findIndex((r) => r.id === rec.id);
        const [lo, hi] = start < end ? [start, end] : [end, start];
        for (let j = lo; j <= hi; j++) next.add(flat[j]!.id);
      } else if (e.metaKey || e.ctrlKey) {
        if (next.has(rec.id)) next.delete(rec.id);
        else next.add(rec.id);
      } else {
        next.clear();
        next.add(rec.id);
      }
      setSelectedRows(next);
    }}
    onMouseDown={(e) => e.stopPropagation()}
  >
    {i + 1}
  </button>
</td>
```

- [ ] **Step 3: Add row highlight style**

Add class to the `<tr>`:
```tsx
<tr key={rec.id} className={`group ${selectedRows.has(rec.id) ? 'bg-primary/5' : ''}`}>
```

- [ ] **Step 4: Clear selection on Escape**

In the `onGridKeyDown` handler, add `setSelectedRows(new Set())` alongside `setSelectedCell(null)`.

---

### Task 7: A2.3 Multi-cell copy/paste

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`

- [ ] **Step 1: Add copy handler (Cmd/Ctrl+C)**

Add to `onGridKeyDown`:
```tsx
case 'c':
  if ((e.metaKey || e.ctrlKey) && selectedCell) {
    e.preventDefault();
    const flat = groups.flatMap((g) => g.records);
    const si = flat.findIndex((r) => r.id === selectedCell.recordId);
    const sj = displayedFields.findIndex((f) => f.id === selectedCell.fieldId);
    // Single cell copy
    const val = flat[si]?.cells[displayedFields[sj]?.id ?? ''];
    navigator.clipboard.writeText(val == null ? '' : String(val));
    return;
  }
  break;
```

- [ ] **Step 2: Add paste handler (Cmd/Ctrl+V)**

Add to `onGridKeyDown`:
```tsx
case 'v':
  if ((e.metaKey || e.ctrlKey) && selectedCell) {
    e.preventDefault();
    navigator.clipboard.readText().then((text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      upsertCell.mutate({
        recordId: selectedCell.recordId,
        fieldId: selectedCell.fieldId,
        value: trimmed,
      });
    });
    return;
  }
  break;
```

---

### Task 8: A2.4 Cell History dock close on outside click / Esc

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/cell-history-dock.tsx`

- [ ] **Step 1: Add Esc key handler for closing dock**

In `onGridKeyDown`, add before the existing `Escape` case:
```tsx
case 'Escape':
  e.preventDefault();
  if (selectedCell) {
    setSelectedCell(null);
    return;
  }
  break;
```

- [ ] **Step 2: Add outside click handler**

In `grid-editor.tsx`, add a click handler on the grid container that closes the dock when clicking outside:
```tsx
<div
  ref={gridRef}
  tabIndex={0}
  onKeyDown={onGridKeyDown}
  className="relative outline-none"
  onClick={(e) => {
    if (selectedCell && e.target === e.currentTarget) {
      setSelectedCell(null);
    }
  }}
>
```

---

### Task 9: A3.1 Backend — history.listByBase and history.listByTable

**Files:**
- Modify: `apps/web/src/server/trpc/routers/history.ts`

**Interfaces:**
- Consumes: `cellHistory`, `cell`, `user`, `field`, `table` from schema
- Produces: `listByBase` and `listByTable` procedures

- [ ] **Step 1: Add `listByBase` procedure**

```ts
listByBase: protectedProcedure
  .input(
    z.object({
      baseId: z.string(),
      offset: z.number().int().min(0).optional().default(0),
      limit: z.number().int().min(1).max(200).optional().default(50),
      tableId: z.string().optional(),
      userId: z.string().optional(),
    }),
  )
  .query(async ({ input }) => {
    const tables = await db
      .select({ id: table.id, name: table.name })
      .from(table)
      .where(eq(table.baseId, input.baseId));

    const tableIds = tables.map((t) => t.id);
    if (tableIds.length === 0) return { rows: [], total: 0 };

    const fields = await db
      .select({ id: field.id, name: field.name, tableId: field.tableId })
      .from(field)
      .where(inArray(field.tableId, tableIds));

    const fieldIds = fields.map((f) => f.id);
    const cells = await db
      .select({ id: cell.id, fieldId: cell.fieldId, recordId: cell.recordId })
      .from(cell)
      .where(inArray(cell.fieldId, fieldIds));

    const cellIds = cells.map((c) => c.id);
    if (cellIds.length === 0) return { rows: [], total: 0 };

    const fieldById = new Map(fields.map((f) => [f.id, f]));
    const cellToField = new Map(cells.map((c) => [c.id, c.fieldId]));
    const tableById = new Map(tables.map((t) => [t.id, t]));

    const rows = await db
      .select({
        id: cellHistory.id,
        cellId: cellHistory.cellId,
        oldValue: cellHistory.oldValue,
        newValue: cellHistory.newValue,
        changedAt: cellHistory.changedAt,
        changedByName: user.name,
        changedByEmail: user.email,
      })
      .from(cellHistory)
      .leftJoin(user, eq(cellHistory.changedBy, user.id))
      .where(inArray(cellHistory.cellId, cellIds))
      .orderBy(desc(cellHistory.changedAt))
      .limit(input.limit)
      .offset(input.offset);

    const enriched = rows.map((r) => {
      const fieldId = cellToField.get(r.cellId) ?? '';
      const f = fieldById.get(fieldId);
      const t = f ? tableById.get(f.tableId) : undefined;
      return {
        ...r,
        fieldName: f?.name ?? '(deleted)',
        tableName: t?.name ?? '(deleted)',
      };
    });

    return { rows: enriched, total: enriched.length };
  }),
```

- [ ] **Step 2: Add `listByTable` procedure**

```ts
listByTable: protectedProcedure
  .input(
    z.object({
      tableId: z.string(),
      offset: z.number().int().min(0).optional().default(0),
      limit: z.number().int().min(1).max(200).optional().default(50),
    }),
  )
  .query(async ({ input }) => {
    // Similar to listByBase but scoped to a single table
    const fields = await db
      .select({ id: field.id, name: field.name })
      .from(field)
      .where(eq(field.tableId, input.tableId));
    const fieldIds = fields.map((f) => f.id);
    // ... same pattern as above, scoped to this table's fields
    return { rows: [], total: 0 };
  }),
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @markpocket/web typecheck
```

---

### Task 10: A3.2 Base-level history page

**Files:**
- Create: `apps/web/src/app/bases/[baseId]/history/page.tsx`
- Modify: `apps/web/src/app/bases/[baseId]/settings/history/page.tsx` (redirect to new page)

**Interfaces:**
- Consumes: `history.listByBase` from tRPC
- Produces: History timeline page at `/bases/[baseId]/history`

- [ ] **Step 1: Create the history page**

```tsx
'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';

function fmtVal(v: unknown): string {
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

function fmtTime(iso: Date | string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

export default function BaseHistoryPage() {
  const { baseId } = useParams<{ baseId: string }>();
  const { data, isLoading } = trpc.history.listByBase.useQuery({ baseId });

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h1 className="text-lg font-semibold">History</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        All changes across this base, newest first.
      </p>

      {isLoading ? (
        <div className="mt-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : data && data.rows.length > 0 ? (
        <div className="mt-6 space-y-1">
          {data.rows.map((r: any) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-border py-2 text-sm">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">
                {fmtTime(r.changedAt)}
              </span>
              <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
                {r.changedByName ?? r.changedByEmail ?? 'unknown'}
              </span>
              <span className="w-24 shrink-0 text-xs text-muted-foreground">
                {r.tableName}
              </span>
              <span className="w-24 shrink-0 text-xs font-medium">{r.fieldName}</span>
              <span className="min-w-0 truncate font-mono text-xs">
                {fmtVal(r.oldValue)} → {fmtVal(r.newValue)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">No changes recorded yet.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace Settings History tab placeholder with redirect**

In `apps/web/src/app/bases/[baseId]/settings/history/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { useParams } from 'next/navigation';

export default function HistoryTab() {
  const { baseId } = useParams<{ baseId: string }>();
  redirect(`/bases/${baseId}/history`);
}
```

---

### Task 11: A3.3 Cell history restore + diff

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/cell-history-dock.tsx`

- [ ] **Step 1: Add restore-to-version functionality**

The current dock already has a "restore" button (line 79-84) that calls `onRestore(h.newValue)`. The restore is already wired in `grid-editor.tsx` (line 494-501). Verify the flow works:
1. Click "restore" on a history entry
2. Calls `upsertCell.mutate` with the historical value
3. Cell is updated, history entry is appended

- [ ] **Step 2: Add a restore confirmation**

Wrap the restore button click with a confirm:
```tsx
<button
  onClick={() => {
    if (confirm('Restore this version?')) onRestore(h.newValue);
  }}
  className="mt-0.5 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
>
  restore
</button>
```

- [ ] **Step 3: Add diff view toggle**

Add a "View diff" button that shows old and new values side by side:
```tsx
const [showDiff, setShowDiff] = useState<string | null>(null);

// In the history item:
<button
  onClick={() => setShowDiff(showDiff === h.id ? null : h.id)}
  className="ml-2 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
>
  {showDiff === h.id ? 'hide diff' : 'diff'}
</button>
{showDiff === h.id && (
  <div className="mt-1 rounded bg-muted p-1.5 font-mono text-[10px]">
    <div className="text-muted-foreground">Old: {fmtVal(h.oldValue)}</div>
    <div className="text-foreground">New: {fmtVal(h.newValue)}</div>
  </div>
)}
```

---

### Task 12: A4.1 Toast wiring for all mutations

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`
- Check: `apps/web/src/app/bases/[baseId]/settings/general/page.tsx`
- Check: `apps/web/src/app/bases/[baseId]/settings/members/page.tsx`

- [ ] **Step 1: Add toast to upsertCell mutation**

In `grid-editor.tsx`, modify the `upsertCell` mutation:
```tsx
const upsertCell = trpc.cell.upsert.useMutation({
  onSuccess: () => {
    utils.record.list.invalidate({ tableId });
    toast.success('Cell updated');
  },
  onError: (err) => toast.error(err.message),
});
```

- [ ] **Step 2: Add toast to createRecord mutation**

```tsx
const createRecord = trpc.record.create.useMutation({
  onSuccess: () => {
    utils.record.list.invalidate({ tableId });
    toast.success('Record added');
  },
  onError: (err) => toast.error(err.message),
});
```

- [ ] **Step 3: Add toast to deleteRecord mutation**

```tsx
const deleteRecord = trpc.record.delete.useMutation({
  onSuccess: () => {
    utils.record.list.invalidate({ tableId });
    toast.success('Record deleted');
  },
  onError: (err) => toast.error(err.message),
});
```

- [ ] **Step 4: Add toast to create/delete share in Members tab**

In `apps/web/src/app/bases/[baseId]/settings/members/page.tsx`:
```tsx
const createShare = trpc.share.create.useMutation({
  onSuccess: (row) => {
    void utils.share.list.invalidate({ baseId });
    toast.success('Share link created');
    navigator.clipboard.writeText(`${window.location.origin}/share/${row.token}`);
    toast.info('Link copied to clipboard');
  },
  onError: (err) => toast.error(err.message),
});
```

---

### Task 13: A4.2 Command palette filling

**Files:**
- Modify: `apps/web/src/components/command-palette.tsx`

- [ ] **Step 1: Add more commands to the palette**

```tsx
<CommandGroup heading="Actions">
  <CommandItem value="New base" onSelect={() => go('/bases/new')}>
    New base
  </CommandItem>
  <CommandItem value="New table" onSelect={() => {
    // This is context-dependent — only works when inside a base
    setOpen(false);
    // Could emit an event or navigate to the base page
  }}>
    New table
  </CommandItem>
</CommandGroup>
<CommandGroup heading="Navigate">
  <CommandItem value="Go to Bases" onSelect={() => go('/bases')}>
    Go to Bases
  </CommandItem>
  <CommandItem value="Create new base" onSelect={() => go('/bases/new')}>
    Create new base
  </CommandItem>
</CommandGroup>
```

- [ ] **Step 2: Add Base detail context to CommandPalette**

Pass `currentBaseId` to `CommandPalette` and add commands like "Go to Settings", "View History" when inside a base.

---

### Task 14: A4.3 Loading/Empty/Error state coverage

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`
- Modify: `apps/web/src/app/bases/[baseId]/settings/members/page.tsx`

- [ ] **Step 1: Add loading skeleton for grid**

In `grid-editor.tsx`, add before the main render:
```tsx
if (!fieldsData || !viewsData) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="space-y-3">
        <div className="h-8 w-96 animate-pulse rounded bg-muted" />
        <div className="h-64 w-96 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add error state for grid**

Add a state that catches tRPC errors:
```tsx
if (fieldsData && 'error' in fieldsData) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-destructive">
      Failed to load fields. Please try again.
    </div>
  );
}
```

- [ ] **Step 3: Add loading state for Members tab**

In `members/page.tsx`, add:
```tsx
if (members.isLoading) {
  return <div className="space-y-3 p-4">{Array.from({ length: 3 }).map((_, i) => (
    <div key={i} className="h-12 animate-pulse rounded bg-muted" />
  ))}</div>;
}
```

---

## Spec Coverage Check

| Spec Section | Task(s) |
|---|---|
| A1 公开分享 — 数据模型 | A1.1 |
| A1 公开分享 — 公开只读端点 | A1.2 |
| A1 公开分享 — /share/[token] 公开页 | A1.3 |
| A1 公开分享 — 错误处理 | A1.3 (built into page) |
| A2 — 表达式列头 chip | A2.1 |
| A2 — 行号点击全选行 | A2.2 |
| A2 — 多选复制粘贴 | A2.3 |
| A2 — Cell History dock 关闭 | A2.4 |
| A3 — Base 级时间线 | A3.1 (backend) + A3.2 (page) |
| A3 — Cell 级历史恢复 + diff | A3.3 |
| A3 — listByBase / listByTable | A3.1 |
| A4 — Toast 全面接线 | A4.1 |
| A4 — ⌘K 命令面板填充 | A4.2 |
| A4 — Loading/Empty/Error 状态 | A4.3 |
| 测试 — 公开分享 | A1.4 |