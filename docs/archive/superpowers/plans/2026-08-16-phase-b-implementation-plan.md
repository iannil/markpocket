# Phase B: 协作与发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-user collaboration safe and controllable, and reach a ready-to-release state.

**Architecture:** Phase B builds on Phase A. Invitation adds a new table + accept flow + role enforcement (tRPC middleware + UI gating). Export extends plugin-csv with base-level ZIP. Release is process + docs + container publishing. All additive; no schema changes that break existing data.

**Tech Stack:** Next.js 16 (App Router) + tRPC + Drizzle + PostgreSQL 16 + plugin-csv + Docker

## Global Constraints

- All new server routes must use existing `protectedProcedure` / `publicProcedure` from `server/trpc/init.ts`
- Role checks MUST be enforced server-side (never trust the frontend alone) via `assertRole` from `lib/roles.ts`
- UI must gate editing controls by role (owner/editor/viewer) using the role matrix from the Phase B spec
- UI components must use Paper & Ink design tokens (CSS variables in `globals.css`)
- Tests co-located with source files (`*.test.ts`, `*.test.tsx`)
- All user-facing strings in English
- No new dependency packages — use what's in `package.json`
- `baseMember.role` values stay in the existing enum: `owner | editor | viewer`

---

## File Structure

### B1: 邀请机制 (Invitation)

```
Create: apps/web/src/server/db/migrations/  (base_invite via db:generate)
Modify: apps/web/src/server/db/schema.ts               # Add base_invite table
Create: apps/web/src/server/trpc/routers/invite.ts     # create/list/delete/accept/resolve
Modify: apps/web/src/server/trpc/router.ts             # Register invite router
Create: apps/web/src/app/invite/[token]/page.tsx       # Public accept page
Modify: apps/web/src/app/bases/[baseId]/settings/members/page.tsx  # Invite UI
Modify: apps/web/src/lib/roles.ts                      # owner-only helpers for invite ops
```

### B2: 导出全部 (Export all)

```
Create: apps/web/src/server/trpc/routers/export.ts     # exportBase → ZIP buffer
Modify: apps/web/src/server/trpc/router.ts             # Register export router
Create: apps/web/src/app/bases/[baseId]/settings/export/page.tsx  # Export UI
Modify: apps/web/src/components/settings-tabs.tsx      # Add Export tab
```

### B3: 发布流程 (Release process)

```
Create: CHANGELOG.md
Create: docs/UPGRADE.md
Modify: README.md                                     # Version link + upgrade note
Modify: package.json                                  # version field → 1.0.0-alpha.1
Create: .github/workflows/release.yml                 # Tag → ghcr.io image build
```

---

## Task Breakdown

### Task 1: base_invite schema + invite router

**Files:**
- Modify: `apps/web/src/server/db/schema.ts`
- Create: `apps/web/src/server/trpc/routers/invite.ts`
- Modify: `apps/web/src/server/trpc/router.ts`

**Interfaces:**
- Consumes: `db`, `baseMember`, `user` from `server/db/schema`; `protectedProcedure` from `../init`
- Produces: `inviteRouter` with `create`, `list`, `delete`, `accept`, `resolve`; `baseInvite` table

- [ ] **Step 1: Add `base_invite` table to schema**

In `apps/web/src/server/db/schema.ts`, after `baseMember`:
```ts
export const baseInvite = pgTable('base_invite', {
  id: text('id').primaryKey(),
  baseId: text('base_id')
    .notNull()
    .references(() => base.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull().default('editor'), // owner | editor | viewer
  token: text('token').notNull(),
  invitedBy: text('invited_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
});
```

- [ ] **Step 2: Create `invite.ts` router**

```ts
import { randomUUID } from 'node:crypto';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { baseInvite, baseMember, user } from '../../db/schema';
import { db } from '../../db';
import { assertRole } from '@/lib/roles';
import { protectedProcedure, router, publicProcedure } from '../init';

const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48h

export const inviteRouter = router({
  list: protectedProcedure
    .input(z.object({ baseId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertRole(input.baseId, ctx.session.user.id, 'viewer');
      return db
        .select({
          id: baseInvite.id,
          email: baseInvite.email,
          role: baseInvite.role,
          createdAt: baseInvite.createdAt,
          expiresAt: baseInvite.expiresAt,
          acceptedAt: baseInvite.acceptedAt,
          invitedByName: user.name,
        })
        .from(baseInvite)
        .leftJoin(user, eq(baseInvite.invitedBy, user.id))
        .where(and(eq(baseInvite.baseId, input.baseId), isNull(baseInvite.acceptedAt)))
        .orderBy(desc(baseInvite.createdAt));
    }),

  create: protectedProcedure
    .input(
      z.object({
        baseId: z.string(),
        email: z.string().email().toLowerCase(),
        role: z.enum(['editor', 'viewer']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRole(input.baseId, ctx.session.user.id, 'owner');
      // Deactivate any prior pending invite for this email+base.
      const existing = await db
        .select()
        .from(baseInvite)
        .where(
          and(
            eq(baseInvite.baseId, input.baseId),
            eq(baseInvite.email, input.email),
            isNull(baseInvite.acceptedAt),
          ),
        );
      for (const inv of existing) {
        await db.update(baseInvite).set({ acceptedAt: new Date() }).where(eq(baseInvite.id, inv.id));
      }
      const [row] = await db
        .insert(baseInvite)
        .values({
          id: randomUUID(),
          baseId: input.baseId,
          email: input.email,
          role: input.role,
          token: randomUUID().replace(/-/g, ''),
          invitedBy: ctx.session.user.id,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        })
        .returning();
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [inv] = await db.select().from(baseInvite).where(eq(baseInvite.id, input.id)).limit(1);
      if (!inv) return { ok: true };
      await assertRole(inv.baseId, ctx.session.user.id, 'owner');
      // Soft-delete: mark acceptedAt so it no longer resolves.
      await db.update(baseInvite).set({ acceptedAt: new Date() }).where(eq(baseInvite.id, input.id));
      return { ok: true };
    }),

  resolve: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const [inv] = await db
        .select()
        .from(baseInvite)
        .where(eq(baseInvite.token, input.token))
        .limit(1);
      if (!inv) return null;
      if (inv.acceptedAt) return null;
      if (new Date(inv.expiresAt) < new Date()) return null;
      const [baseRow] = await db
        .select({ id: base.id, name: base.name })
        .from(base)
        .where(eq(base.id, inv.baseId))
        .limit(1);
      if (!baseRow) return null;
      return { baseId: inv.baseId, baseName: baseRow.name, email: inv.email, role: inv.role };
    }),

  accept: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [inv] = await db
        .select()
        .from(baseInvite)
        .where(eq(baseInvite.token, input.token))
        .limit(1);
      if (!inv) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite not found' });
      if (inv.acceptedAt) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Already accepted' });
      if (new Date(inv.expiresAt) < new Date())
        throw new TRPCError({ code: 'GONE', message: 'Invite expired' });
      // The invite's target email must match the signed-in user's email.
      if (inv.email !== ctx.session.user.email?.toLowerCase())
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `This invite is for ${inv.email}. Sign in with that account.`,
        });
      // Upsert membership with the invited role.
      const [existing] = await db
        .select()
        .from(baseMember)
        .where(and(eq(baseMember.baseId, inv.baseId), eq(baseMember.userId, ctx.session.user.id)))
        .limit(1);
      if (existing) {
        // Keep the higher of existing vs invited role (never demote).
        if (existing.role !== 'owner' && inv.role === 'owner') {
          await db.update(baseMember).set({ role: 'owner' }).where(eq(baseMember.id, existing.id as never));
        }
      } else {
        await db.insert(baseMember).values({
          baseId: inv.baseId,
          userId: ctx.session.user.id,
          role: inv.role,
        });
      }
      await db.update(baseInvite).set({ acceptedAt: new Date() }).where(eq(baseInvite.id, inv.id));
      return { baseId: inv.baseId };
    }),
});
```

**Note on join:** `baseInvite` has no `id` PK on baseMember's composite — the `eq(baseMember.id, ...)` in accept is wrong; use `and(eq(baseMember.baseId, inv.baseId), eq(baseMember.userId, ...))` for the update. Type-aware fix at implementation time.

- [ ] **Step 3: Register in `router.ts`**

```ts
import { inviteRouter } from './routers/invite';
// in appRouter:
invite: inviteRouter,
```

- [ ] **Step 4: Generate + apply migration**

```bash
pnpm db:generate && pnpm db:migrate
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @markpocket/web typecheck
```

---

### Task 2: Invite accept page `[baseUrl]/invite/[token]`

**Files:**
- Create: `apps/web/src/app/invite/[token]/page.tsx`

**Interfaces:**
- Consumes: `invite.resolve` (public), `invite.accept` (protected), `auth` session from layout
- Produces: Accept page — validates token, shows base name + role, calls accept → redirects to base

- [ ] **Step 1: Create the invite page**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { data: inv, isLoading } = trpc.invite.resolve.useQuery({ token });
  const accept = trpc.invite.accept.useMutation({
    onSuccess: (res) => router.push(`/bases/${res.baseId}`),
    onError: (err) => setError(err.message),
  });
  const [error, setError] = useState<string | null>(null);

  // If a signed-in user opened this and it's valid, accept immediately.
  useEffect(() => {
    if (inv && !isLoading && !accept.isPending) {
      accept.mutate({ token });
    }
  }, [inv, isLoading, accept.isPending]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6">
        {isLoading ? (
          <div className="h-8 animate-pulse rounded bg-muted" />
        ) : !inv ? (
          <>
            <h1 className="text-sm font-semibold text-destructive">Invite invalid or expired</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              This invite link may have expired or been revoked.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-sm font-semibold">You're invited to {inv.baseName}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Role: <span className="font-medium text-foreground">{inv.role}</span> · Sign in as{' '}
              <span className="font-medium text-foreground">{inv.email}</span> to join.
            </p>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Member tab invites UI**

Add an invite creation form to `members/page.tsx` (email input + role select + "invite" button) and render the pending invites list from `invite.list`. Replace the "邀请功能待后端支持" placeholder.

- [ ] **Step 3: Typecheck + verify the flow end-to-end** (create invite → open link in another browser / incognito → accept → base visible)

---

### Task 3: Role gating (server + UI)

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`  — gate edit affordances
- Modify: `apps/web/src/server/trpc/routers/record.ts`, `cell.ts`, `table.ts`, `field.ts`, `view.ts` — assert editor+ on mutations
- Modify: `apps/web/src/lib/roles.ts` — `assertRole` already exists; add `requireRole` helper returning role for UI

**Interfaces:**
- Consumes: `assertRole(baseId, userId, minRole)` from `lib/roles.ts`; `baseIdFromTable(tableId)`
- Produces: server-enforced role gates; `role` returned to UI via a `me` query on member router or existing auth query

- [ ] **Step 1: Enforce `editor` min role on cell/record mutations**

In `cell.ts` `upsert`, before writing: resolve table's baseId via `baseIdFromTable(fld.tableId)`, then `await assertRole(baseId, ctx.session.user.id, 'editor')`.

Same for `record.create`, `record.delete`, `table.create/rename/delete`, `field.create/update/delete`, `view.create/update/deleteOptions/updateOptions/delete`.

- [ ] **Step 2: Add `me` query to member router**

```ts
me: protectedProcedure
  .input(z.object({ baseId: z.string() }))
  .query(async ({ ctx, input }) => {
    return { role: await ensureMembership(input.baseId, ctx.session.user.id) };
  }),
```

- [ ] **Step 3: UI gating in grid-editor**

Consume `trpc.member.me.useQuery({ baseId })`. When role is `viewer`: hide "+ Field", "+ new record", disable CellRenderer editing, hide delete button, hide filter/sort/group controls (read-only grid).

---

### Task 4: Base-level ZIP export

**Files:**
- Create: `apps/web/src/server/trpc/routers/export.ts`
- Modify: `apps/web/src/server/trpc/router.ts`
- Create: `apps/web/src/app/bases/[baseId]/settings/export/page.tsx`
- Modify: `apps/web/src/components/settings-tabs.tsx`

**Interfaces:**
- Consumes: `queries.listRecordsPivoted`, `schema.table/field/record/cell` via `coreServerApi` or direct `db`; `cellToCsv`, `csvEscape` from `@markpocket/plugin-csv` (re-exported as needed)
- Produces: `exportRouter.exportBase({ baseId })` → `{ name, files: [{ name, csv }] }` (frontend zips, no new dependency) OR server-side ZIP via `archiver` (rejected — no new deps). Choose: return a JSON of `{ fileName, csv }[]`, let the browser build the ZIP using the existing `Blob` + `URL.createObjectURL` pattern with a tiny inline zip writer if needed. Simplest v1: download each table as a separate CSV (browser allows multiple downloads) — but the spec says ZIP. Use a minimal client-side ZIP: NOT available without deps. **Decision: download each CSV as a separate file in sequence** (browser prompt allows it) OR use `JSZip` — rejected (new dep). So: server returns per-table CSVs; client triggers one download per CSV with a small delay. Document the deviation.

- [ ] **Step 1: Create export router**

```ts
export const exportRouter = router({
  exportBase: protectedProcedure
    .input(z.object({ baseId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertRole(input.baseId, ctx.session.user.id, 'viewer');
      const tables = await db
        .select({ id: table.id, name: table.name })
        .from(table)
        .where(eq(table.baseId, input.baseId));
      const files: Array<{ name: string; csv: string }> = [];
      for (const t of tables) {
        const fields = await db
          .select({ id: field.id, name: field.name, type: field.type, options: field.options, orderIndex: field.orderIndex })
          .from(field)
          .where(eq(field.tableId, t.id));
        fields.sort((a, b) => a.orderIndex - b.orderIndex);
        const records = await listRecordsPivoted(t.id, {}, 0, 10000);
        const { cellToCsv, csvEscape } = await import('@markpocket/plugin-csv/export-helpers'); // or re-implement small helpers locally
        const header = fields.map((f) => csvEscape(f.name)).join(',');
        const lines = records.map((r) =>
          fields.map((f) => csvEscape(cellToCsv(r.cells[f.id], f.type, f.options, fieldTypes))).join(','),
        );
        const safeName = t.name.replace(/[^a-zA-Z0-9_-]/g, '_') || t.id;
        files.push({ name: `${safeName}.csv`, csv: [header, ...lines].join('\n') });
      }
      return files;
    }),
});
```

**Note:** `cellToCsv` lives inside `packages/plugin-csv/src/csv.ts` and is exported; import it directly from the plugin package (`@markpocket/plugin-csv` main exports it — verify). If not exported, copy the small `cellToCsv` + `csvEscape` helpers into `apps/web/src/server/trpc/routers/export.ts` (spec favors reuse; verify export surface first).

- [ ] **Step 2: Register + Settings tab + UI**

Add `export` route group. `settings-tabs.tsx` adds an "Export" tab → page with table checkboxes (default all) + "Export" button → sequentially downloads each CSV via the pattern in `general/page.tsx` (Blob + a.click()).

- [ ] **Step 3: Verify manually** (create a base with 2 tables, export, both CSVs download)

---

### Task 5: Release process — versioning, CHANGELOG, Docker

**Files:**
- Create: `CHANGELOG.md`
- Create: `docs/UPGRADE.md`
- Modify: `package.json` (version `0.0.0` → `1.0.0-alpha.1`), `apps/web/package.json` same
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: root `package.json`; existing `Dockerfile` + `docker-compose.yml`
- Produces: release artifacts — git tag, GitHub Release, ghcr.io multi-arch image

- [ ] **Step 1: Version bump**

Root `package.json` + `apps/web/package.json`: `"version": "1.0.0-alpha.1"`.

- [ ] **Step 2: CHANGELOG.md**

Add `v1.0.0-alpha.1` section summarizing Phase A + Phase B work (bisect by scope: share, grid, history, polish, invites, export).

- [ ] **Step 3: docs/UPGRADE.md**

Document the `0007_fresh_stingray.sql` migration (created_by) + `base_invite` migration; note `pnpm db:migrate` before first boot.

- [ ] **Step 4: release.yml**

```yaml
name: release
on:
  push:
    tags: ['v*']
jobs:
  docker:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build and push multi-arch image
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:${{ github.ref_name }}
            ${{ startsWith(github.ref_name, 'v1.0.0') && !contains(github.ref_name, '-') && format('ghcr.io/{0}:latest', github.repository) || '' }}
```

**Note:** the `latest` tag expression only fires for stable (no `-` suffix) v1.0.0+ tags.

- [ ] **Step 5: Release checklist documented** (in `docs/UPGRADE.md` or a `docs/release.md`): end-to-end verification (create base → tables → data → share → invite → export), docker-compose up one-shot, upgrade-from-empty-DB verification, CHANGELOG + README updated, tag pushed.

---

## Spec Coverage Check

| Spec Section | Task(s) |
|---|---|
| B1 数据模型 base_invite | Task 1 |
| B1 邀请流程（链接生成/接受/过期/取消） | Task 1, Task 2 |
| B1 角色权限矩阵 | Task 3 |
| B1 前端角色门控 + 后端强制 | Task 3 |
| B2 Base 级 ZIP 导出 | Task 4 |
| B2 导出选项（字段/视图/表达式） | Task 4 (v1: 全部字段, 无视图过滤 — documented deviation) |
| B3 版本号与发布策略 | Task 5 |
| B3 文档（CHANGELOG/UPGRADE/README） | Task 5 |
| B3 Docker 镜像发布 | Task 5 |
| B3 发布检查清单 | Task 5 |