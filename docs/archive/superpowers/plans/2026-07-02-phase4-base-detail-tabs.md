# Phase 4 — Base 详情 + Tabs 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 base 下新增一个 Tabs 管理页（Tables / Members / Settings / History），把现有后端能力接成 Paper & Ink 界面。

**Architecture:** 路由分 tab，`bases/[baseId]/settings/` 下一个 `layout.tsx`（base 头 + tab 导航）+ 每个 tab 一个 `page.tsx`。全部客户端组件走现有 tRPC hooks。嵌在现有 `bases/[baseId]/layout.tsx`（PresenceBar + realtime 订阅）之下。

**Tech Stack:** Next.js 16 App Router、tRPC（`@/lib/trpc/client`）、Tailwind + Paper & Ink token、shadcn 风格 ui 组件（dialog/select/button）。

**Spec:** `docs/superpowers/specs/2026-07-02-phase4-base-detail-tabs-design.md`

## Global Constraints

- **无测试框架**：项目无自动化测试。TDD 循环适配为 **实现 → typecheck → lint → 浏览器肉眼验证 → commit**。每个 task 用此循环。
- **验证命令**：`pnpm --filter @markpocket/web typecheck && pnpm lint`（均需通过）。浏览器：`http://localhost:7420`（dev 由 `./dev.sh` 起）。
- **tRPC**：客户端一律 `import { trpc } from '@/lib/trpc/client'`；查询 `trpc.X.useQuery(...)`，变更 `trpc.X.useMutation(...)`，失效 `const utils = trpc.useUtils(); utils.X.invalidate(...)`。react-query v5：pending 用 `.isPending`。
- **不改后端**：不写 schema 迁移、不加新 tRPC endpoint。只用：`table.list/create`、`member.list/updateRole/remove`、`share.list/create/delete`、`base.get/rename/delete`、`GET /api/export?tableId=`。
- **Paper & Ink**：hairline 用 `border-border`；主按钮 `bg-primary text-primary-foreground hover:opacity-90`；hover 行 `hover:bg-muted`；**无 shadow**；错误 `text-destructive`；等宽 meta 用 `font-mono`。
- **交互页加 `'use client'`**。确认弹窗：删除 base 用 `ui/dialog`；移除成员用原生 `confirm()`（Toast 系统属 Phase 7，不在本 Phase）。
- **cn** 来自 `@/lib/utils`。

---

### Task 1: Settings 外壳 + Tables tab（+ 其余 tab 占位）

建立可导航的 Tabs 外壳：tab 导航组件 + layout + 四个 tab 路由（Tables 真做，Members/Settings 占位，History 最终占位），保证任何 tab 都不 404。

**Files:**
- Create: `apps/web/src/components/settings-tabs.tsx`
- Create: `apps/web/src/app/bases/[baseId]/settings/layout.tsx`
- Create: `apps/web/src/app/bases/[baseId]/settings/page.tsx`（Tables tab，真做）
- Create: `apps/web/src/app/bases/[baseId]/settings/members/page.tsx`（占位，Task 2 替换）
- Create: `apps/web/src/app/bases/[baseId]/settings/general/page.tsx`（占位，Task 3 替换）
- Create: `apps/web/src/app/bases/[baseId]/settings/history/page.tsx`（最终占位）

**Interfaces:**
- Produces: `<SettingsTabs baseId={string} />`（default 无，具名导出）。
- Consumes: `trpc.base.get.useQuery({ id })`、`trpc.table.list.useQuery({ baseId })`、`trpc.table.create.useMutation`、`components/empty-state` 的 `<EmptyState title description action? />`。

- [ ] **Step 1: 写 `settings-tabs.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

export function SettingsTabs({ baseId }: { baseId: string }) {
  const pathname = usePathname();
  const root = `/bases/${baseId}/settings`;
  const tabs = [
    { label: 'Tables', href: root },
    { label: 'Members', href: `${root}/members` },
    { label: 'Settings', href: `${root}/general` },
    { label: 'History', href: `${root}/history` },
  ];
  return (
    <nav className="flex gap-1 border-b border-border px-6">
      {tabs.map((t) => {
        const active = t.href === root ? pathname === root : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              active
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: 写 `settings/layout.tsx`**

```tsx
'use client';

import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { SettingsTabs } from '@/components/settings-tabs';
import { trpc } from '@/lib/trpc/client';

export default function BaseSettingsLayout({ children }: { children: ReactNode }) {
  const { baseId } = useParams<{ baseId: string }>();
  const { data: base } = trpc.base.get.useQuery({ id: baseId });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">{base?.name ?? 'Base'}</h1>
      </div>
      <SettingsTabs baseId={baseId} />
      <div className="mx-auto max-w-3xl px-6 py-6">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: 写 `settings/page.tsx`（Tables tab）**

```tsx
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { EmptyState } from '@/components/empty-state';
import { trpc } from '@/lib/trpc/client';

export default function TablesTab() {
  const { baseId } = useParams<{ baseId: string }>();
  const utils = trpc.useUtils();
  const { data: tables, isLoading } = trpc.table.list.useQuery({ baseId });
  const [name, setName] = useState('');
  const create = trpc.table.create.useMutation({
    onSuccess: () => {
      void utils.table.list.invalidate({ baseId });
      setName('');
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (n) create.mutate({ baseId, name: n });
  }

  if (isLoading) return <div className="h-8 animate-pulse rounded bg-muted" />;

  return (
    <div className="space-y-4">
      {tables && tables.length > 0 ? (
        <ul className="border-t border-border">
          {tables.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between border-b border-border py-2.5"
            >
              <span className="text-sm font-medium">{t.name}</span>
              <Link
                href={`/bases/${baseId}/tables/${t.id}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                open →
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No tables yet" description="Create the first table below." />
      )}
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Table name"
          className="h-8 w-56 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {create.isPending ? '···' : '+ add table'}
        </button>
      </form>
      {create.error && <p className="text-xs text-destructive">{create.error.message}</p>}
    </div>
  );
}
```

- [ ] **Step 4: 写 `settings/members/page.tsx`（Task 1 占位）**

```tsx
import { EmptyState } from '@/components/empty-state';

export default function MembersTab() {
  return <EmptyState title="Members" description="即将实现。" />;
}
```

- [ ] **Step 5: 写 `settings/general/page.tsx`（Task 1 占位）**

```tsx
import { EmptyState } from '@/components/empty-state';

export default function GeneralTab() {
  return <EmptyState title="Settings" description="即将实现。" />;
}
```

- [ ] **Step 6: 写 `settings/history/page.tsx`（最终占位）**

```tsx
import { EmptyState } from '@/components/empty-state';

export default function HistoryTab() {
  return <EmptyState title="Coming soon" description="Base 级变更时间线待后端支持。" />;
}
```

- [ ] **Step 7: typecheck + lint**

Run: `pnpm --filter @markpocket/web typecheck && pnpm lint`
Expected: 均通过，无 error。

- [ ] **Step 8: 浏览器验证**

登录后访问 `http://localhost:7420/bases/<某 baseId>/settings`：
- 顶部显示 base 名 + 四个 tab（Tables/Members/Settings/History），Tables 高亮。
- Tables tab 列出该 base 的表，`+ add table` 能建表并即时出现在列表。
- 点 Members/Settings/History 各 tab 都能进（占位/coming soon），active 高亮切换，刷新保持当前 tab。

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/settings-tabs.tsx "apps/web/src/app/bases/[baseId]/settings"
git commit -m "feat(base-settings): Tabs 外壳 + Tables tab（Paper & Ink）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Members tab（角色矩阵 + 公开分享链接）

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/settings/members/page.tsx`（整体替换占位）

**Interfaces:**
- Consumes: `trpc.member.list.useQuery({ baseId })` → `Array<{ userId: string; role: 'owner'|'editor'|'viewer'; name: string|null; email: string|null }>`；`trpc.member.updateRole.useMutation`（`{baseId, userId, role}`）；`trpc.member.remove.useMutation`（`{baseId, userId}`）；`trpc.share.list.useQuery({ baseId })` → `Array<{ id: string; token: string; ... }>`；`trpc.share.create.useMutation`（`{baseId, viewId?}`）；`trpc.share.delete.useMutation`（`{id}`）。
- ui: `Select, SelectContent, SelectItem, SelectTrigger` from `@/components/ui/select`（用法：`<Select value onValueChange><SelectTrigger>{显示值}</SelectTrigger><SelectContent><SelectItem value>...</SelectItem></SelectContent></Select>`）。

- [ ] **Step 1: 整体替换 `settings/members/page.tsx`**

```tsx
'use client';

import { useParams } from 'next/navigation';

import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { trpc } from '@/lib/trpc/client';

function initials(s: string): string {
  return s
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export default function MembersTab() {
  const { baseId } = useParams<{ baseId: string }>();
  const utils = trpc.useUtils();
  const members = trpc.member.list.useQuery({ baseId });
  const shares = trpc.share.list.useQuery({ baseId });

  const updateRole = trpc.member.updateRole.useMutation({
    onSuccess: () => utils.member.list.invalidate({ baseId }),
  });
  const removeMember = trpc.member.remove.useMutation({
    onSuccess: () => utils.member.list.invalidate({ baseId }),
  });
  const createShare = trpc.share.create.useMutation({
    onSuccess: () => utils.share.list.invalidate({ baseId }),
  });
  const deleteShare = trpc.share.delete.useMutation({
    onSuccess: () => utils.share.list.invalidate({ baseId }),
  });

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 text-sm font-semibold">Members</h2>
        <ul className="border-t border-border">
          {members.data?.map((m) => {
            const label = m.name ?? m.email ?? m.userId;
            return (
              <li key={m.userId} className="flex items-center gap-3 border-b border-border py-2.5">
                <span className="flex size-7 items-center justify-center rounded-full bg-muted font-mono text-xs">
                  {initials(label)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{m.name ?? m.email}</div>
                  <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                </div>
                <Select
                  value={m.role}
                  onValueChange={(v) =>
                    v &&
                    updateRole.mutate({
                      baseId,
                      userId: m.userId,
                      role: v as 'owner' | 'editor' | 'viewer',
                    })
                  }
                >
                  <SelectTrigger className="h-7 w-24 text-xs">{m.role}</SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">owner</SelectItem>
                    <SelectItem value="editor">editor</SelectItem>
                    <SelectItem value="viewer">viewer</SelectItem>
                  </SelectContent>
                </Select>
                <button
                  onClick={() => {
                    if (confirm(`移除 ${label}?`)) removeMember.mutate({ baseId, userId: m.userId });
                  }}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  remove
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Public share links</h2>
          <button
            onClick={() => createShare.mutate({ baseId })}
            disabled={createShare.isPending}
            className="h-7 rounded-md bg-primary px-2.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            + create link
          </button>
        </div>
        {shares.data && shares.data.length > 0 ? (
          <ul className="border-t border-border">
            {shares.data.map((s) => (
              <li key={s.id} className="flex items-center gap-2 border-b border-border py-2.5">
                <code className="flex-1 truncate text-xs text-muted-foreground">
                  /share/{s.token}
                </code>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(`${window.location.origin}/share/${s.token}`)
                  }
                  className="text-xs hover:text-foreground"
                >
                  copy
                </button>
                <button
                  onClick={() => deleteShare.mutate({ id: s.id })}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  delete
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No public links yet.</p>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold text-muted-foreground">Invite</h2>
        <p className="text-xs text-muted-foreground">邀请功能待后端支持。</p>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: typecheck + lint**

Run: `pnpm --filter @markpocket/web typecheck && pnpm lint`
Expected: 通过。（若 `share.list` 返回字段名与 `id/token` 不符，按实际 schema 调整 `s.id`/`s.token`——见 `src/server/db/schema.ts` 的 `base_share` 表。）

- [ ] **Step 3: 浏览器验证**

`/bases/<baseId>/settings/members`：
- 成员行显示首字母头像 + name/email + 角色下拉；改角色后下拉即时反映（刷新仍是新角色）。
- `+ create link` 生成一条 `/share/<token>`；copy 可复制；delete 移除。
- 打开生成的 `/share/<token>` 应能看到只读分享页。
- Invite 区显示占位文案。

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/bases/[baseId]/settings/members/page.tsx"
git commit -m "feat(base-settings): Members tab（角色矩阵 + 公开分享链接）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Settings（general）tab（重命名 + 导出 + 删除 base）

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/settings/general/page.tsx`（整体替换占位）

**Interfaces:**
- Consumes: `trpc.base.get.useQuery({ id })` → `{ id; name; ... } | null`；`trpc.base.rename.useMutation`（`{id, name}`）；`trpc.base.delete.useMutation`（`{id}`）；`trpc.table.list.useQuery({ baseId })`。
- ui: `Button` from `@/components/ui/button`（支持 `variant="outline"`）；`Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle` from `@/components/ui/dialog`（用法：`<Dialog open onOpenChange><DialogContent><DialogHeader><DialogTitle/></DialogHeader>...<DialogFooter/></DialogContent></Dialog>`）。
- 导出：链接到 `/api/export?tableId=<id>`（现有 route handler，按表导出 CSV）。

- [ ] **Step 1: 整体替换 `settings/general/page.tsx`**

```tsx
'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { trpc } from '@/lib/trpc/client';

export default function GeneralTab() {
  const { baseId } = useParams<{ baseId: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const base = trpc.base.get.useQuery({ id: baseId });
  const tables = trpc.table.list.useQuery({ baseId });

  const [name, setName] = useState('');
  useEffect(() => {
    if (base.data?.name) setName(base.data.name);
  }, [base.data?.name]);

  const rename = trpc.base.rename.useMutation({
    onSuccess: () => {
      void utils.base.get.invalidate({ id: baseId });
      void utils.base.list.invalidate();
    },
  });
  const del = trpc.base.delete.useMutation({
    onSuccess: () => {
      void utils.base.list.invalidate();
      router.push('/bases');
    },
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 text-sm font-semibold">Base name</h2>
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 w-64 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={() => name.trim() && rename.mutate({ id: baseId, name: name.trim() })}
            disabled={rename.isPending}
            className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Export (CSV)</h2>
        <ul className="border-t border-border">
          {tables.data?.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between border-b border-border py-2.5"
            >
              <span className="text-sm">{t.name}</span>
              <a
                href={`/api/export?tableId=${t.id}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                download →
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-destructive">Danger zone</h2>
        <button
          onClick={() => setConfirmOpen(true)}
          className="h-8 rounded-md border border-destructive px-3 text-sm text-destructive hover:bg-destructive/10"
        >
          Delete base
        </button>
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete base?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            这会删除该 base 下所有表、字段与记录，且不可撤销。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => del.mutate({ id: baseId })} disabled={del.isPending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: typecheck + lint**

Run: `pnpm --filter @markpocket/web typecheck && pnpm lint`
Expected: 通过。（若 `Button` 无 `variant="outline"`，改用普通样式按钮——参考 `src/components/ui/button.tsx` 的 variant 定义。）

- [ ] **Step 3: 浏览器验证**

`/bases/<baseId>/settings/general`：
- 输入框预填 base 名；改名点 Save，sidebar/topbar 的 base 名同步更新。
- Export 区每个表一个 `download →`，点击下载该表 CSV。
- 点 Delete base → 弹确认 dialog；Cancel 关闭；Delete 后删掉 base 并跳 `/bases`（列表里不再有它）。
- ⚠️ 验证删除时**用一个临时新建的 base**，别删有用数据。

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/bases/[baseId]/settings/general/page.tsx"
git commit -m "feat(base-settings): Settings tab（重命名 + 按表导出 + 删除 base）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: 入口（sidebar 齿轮 + 空 base 页链接）

**Files:**
- Modify: `apps/web/src/components/sidebar.tsx`（base 行加 hover 齿轮）
- Modify: `apps/web/src/app/bases/[baseId]/page.tsx`（空 base 态加 settings 链接）

**Interfaces:**
- Consumes: `Settings` 图标（sidebar.tsx 已 `import { Database, Users, Settings, Plus } from 'lucide-react'`）。

- [ ] **Step 1: 改 sidebar base 行为「Link + hover 齿轮」结构**

`sidebar.tsx` 中 base 列表的 `<li key={base.id}>...</li>` 当前是单个整行 `<Link>`。因 `<Link>` 不能嵌套 `<Link>`，改为容器包裹主 Link + 绝对定位的齿轮 Link。替换整个 `<li key={base.id}>` 块为：

```tsx
<li key={base.id} className="group/row relative">
  <Link
    href={`/bases/${base.id}`}
    className={cn(
      'group relative flex items-center gap-2 rounded px-2 py-1.5 text-sm',
      isCurrent
        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
      collapsed && 'justify-center',
    )}
    title={collapsed ? base.name : undefined}
  >
    {isCurrent && (
      <span className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r bg-foreground" />
    )}
    <Database className="size-3.5 shrink-0 text-muted-foreground" />
    {!collapsed && <span className="truncate">{base.name}</span>}
  </Link>
  {!collapsed && (
    <Link
      href={`/bases/${base.id}/settings`}
      title="Base settings"
      className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 hover:bg-sidebar-accent hover:text-foreground group-hover/row:opacity-100"
    >
      <Settings className="size-3.5" />
    </Link>
  )}
</li>
```

- [ ] **Step 2: 空 base 页加 settings 链接**

`bases/[baseId]/page.tsx` 的空态 `<EmptyState ...>` —— 在其 `description` 后补一个链接。把 `EmptyState` 的 `action` 之外，在页面容器内空态下方加一行（若已有 action 为建表表单，则在其后追加）：

在 `EmptyState` 的 `action` 表单元素后（同一 `action` 内或紧邻），加：

```tsx
<Link
  href={`/bases/${baseId}/settings`}
  className="mt-3 block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
>
  base settings →
</Link>
```

确保文件顶部有 `import Link from 'next/link';`（若无则添加）。

- [ ] **Step 3: typecheck + lint**

Run: `pnpm --filter @markpocket/web typecheck && pnpm lint`
Expected: 通过。

- [ ] **Step 4: 浏览器验证**

- 展开 sidebar，hover 任一 base 行 → 右侧出现齿轮；点齿轮进入 `/bases/<id>/settings`（Tables tab）。
- 折叠 sidebar 时不出现齿轮（不破坏 icon rail）。
- 打开一个**无表**的 base（或新建 base 不建表），空态下方出现 `base settings →` 链接，点击进入 settings。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/sidebar.tsx "apps/web/src/app/bases/[baseId]/page.tsx"
git commit -m "feat(base-settings): sidebar 齿轮 + 空 base 页入口

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 收尾（全部 task 后）

- [ ] 更新 `docs/redesign/status.md` 与 `docs/STATUS.md`：Phase 4 由「⚠️ 部分」→ Tabs 外壳 + Tables/Members/Settings 真做完成；History/邀请/描述/导出全部 仍占位。commit。
- [ ] （可选）浏览器整体回归：Tables 建表、Members 改角色/分享、Settings 改名/导出/删除、四 tab 切换与深链刷新。

## 明确不做（占位，见 spec §9）

邀请成员、base 描述字段、History base 级时间线、导出全部、前端角色门控、Tables 行数/视图数聚合。
