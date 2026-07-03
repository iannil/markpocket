# Phase 7 — Paper & Ink 收尾 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 404/500/loading 页、全局 Toast 提示、⌘K 命令面板入口，全部 Paper & Ink。

**Architecture:** 三块独立：Next App Router 约定错误/加载页；自造模块级 pub-sub Toast（`lib/toast.ts` + `<Toaster>`）；cmdk 命令面板（复用 `ui/command.tsx`）挂 AppShell。不改后端。

**Tech Stack:** Next 16 App Router、tRPC（`@/lib/trpc/client`）、Tailwind + Paper & Ink、cmdk（已装）。

**Spec:** `docs/superpowers/specs/2026-07-03-phase7-polish-design.md`

## Global Constraints

- **无测试框架**：无测试代码。循环为 **实现 → typecheck → lint → 浏览器肉眼 → commit**。
- **验证命令**：`pnpm --filter @markpocket/web typecheck && pnpm lint`。浏览器 `http://localhost:7420`（`./dev.sh`）。
- **不改后端**：无 schema/endpoint 改动。
- **Paper & Ink**：hairline `border-border`；无 shadow；`text-muted-foreground` 辅助字；错误 `text-destructive`；主按钮 `bg-primary text-primary-foreground hover:opacity-90`；`cn` 来自 `@/lib/utils`。
- **复用**：`EmptyState`（`@/components/empty-state`，`{title, description?, action?, className?}`）；`ui/command.tsx` 导出 `CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem`（`CommandDialog` 收 `open`/`onOpenChange`）。
- 交互组件 `'use client'`。

---

### Task 1: 404 / 500 / loading 页

**Files:**
- Create: `apps/web/src/app/not-found.tsx`
- Create: `apps/web/src/app/error.tsx`
- Create: `apps/web/src/app/loading.tsx`

- [ ] **Step 1: `not-found.tsx`（server）**

```tsx
import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <EmptyState
        title="Page not found"
        description="The page you’re looking for doesn’t exist."
        action={
          <Link
            href="/bases"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:opacity-90"
          >
            ← Back to bases
          </Link>
        }
      />
    </main>
  );
}
```

- [ ] **Step 2: `error.tsx`（'use client' 错误边界）**

```tsx
'use client';

import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <EmptyState
        title="Something went wrong"
        description={error.message || 'An unexpected error occurred.'}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={reset}
              className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Try again
            </button>
            <Link
              href="/bases"
              className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm hover:bg-muted"
            >
              ← Back to bases
            </Link>
          </div>
        }
      />
    </main>
  );
}
```

- [ ] **Step 3: `loading.tsx`**

```tsx
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
    </div>
  );
}
```

- [ ] **Step 4: typecheck + lint**

Run: `pnpm --filter @markpocket/web typecheck && pnpm lint`
Expected: 通过。

- [ ] **Step 5: 浏览器验证**

- 访问不存在路由（如 `/bases/nope-not-a-route/xyz` 或 `/zzz`）→ Paper & Ink 404，`← Back to bases` 可回。
- loading：路由切换/慢加载时短暂出现 pulse 骨架（若难触发，确认 `/loading.tsx` 存在即可，error.tsx/not-found 为主）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/not-found.tsx apps/web/src/app/error.tsx apps/web/src/app/loading.tsx
git commit -m "feat(polish): 404 / 500 / loading 页（Paper & Ink）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Toast 系统

自造模块级 pub-sub Toast + `<Toaster>`，挂根布局，接 2–3 处 mutation 演示。

**Files:**
- Create: `apps/web/src/lib/toast.ts`
- Create: `apps/web/src/components/toaster.tsx`
- Modify: `apps/web/src/app/layout.tsx`（挂 `<Toaster />`）
- Modify: `apps/web/src/app/bases/[baseId]/settings/general/page.tsx`（改名/删除成功 toast）
- Modify: `apps/web/src/app/bases/new/page.tsx`（create 失败 toast）

**Interfaces:**
- Produces：`lib/toast.ts` 导出 `toast.success/error/info(message: string)`、`subscribeToasts(cb)`、`getToasts()`、`dismissToast(id)`、类型 `ToastItem { id:number; kind:'success'|'error'|'info'; message:string }`；`components/toaster.tsx` 导出 `<Toaster />`。

- [ ] **Step 1: `lib/toast.ts`**

```ts
export type ToastKind = 'success' | 'error' | 'info';
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  for (const cb of listeners) cb(items);
}

export function subscribeToasts(cb: (items: ToastItem[]) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
export function getToasts(): ToastItem[] {
  return items;
}
export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}
function push(kind: ToastKind, message: string) {
  const id = nextId++;
  items = [...items, { id, kind, message }];
  emit();
  setTimeout(() => dismissToast(id), 3000);
}
export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
  info: (message: string) => push('info', message),
};
```
> `getToasts` 返回当前 `items` 引用，仅在变更时替换为新数组 → `useSyncExternalStore` 快照稳定，无循环。

- [ ] **Step 2: `components/toaster.tsx`**

```tsx
'use client';

import { useSyncExternalStore } from 'react';

import { subscribeToasts, getToasts, dismissToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (items.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            'flex items-start gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-none',
            t.kind === 'error' ? 'border-destructive/40 text-destructive' : 'border-border',
          )}
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          <button
            onClick={() => dismissToast(t.id)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 挂 `<Toaster />` 到 `app/layout.tsx`**

在 `<body>` 内、providers 之后加 `<Toaster />`：
```tsx
import '@/app/globals.css';
import type { Metadata } from 'next';
import { TRPCProvider } from '@/lib/trpc/client';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { Toaster } from '@/components/toaster';

export const metadata: Metadata = {
  title: 'markpocket',
  description: 'the airtable you own',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <TRPCProvider>
          <RealtimeProvider>{children}</RealtimeProvider>
        </TRPCProvider>
        <Toaster />
      </body>
    </html>
  );
}
```

- [ ] **Step 4: 接 Settings 改名/删除成功 toast**

`settings/general/page.tsx`：顶部 `import { toast } from '@/lib/toast';`。在 `rename` 的 `onSuccess` 里加 `toast.success('Base renamed')`；在 `del` 的 `onSuccess` 里（`router.push('/bases')` 前）加 `toast.success('Base deleted')`。示例（保持其余不变）：
```tsx
const rename = trpc.base.rename.useMutation({
  onSuccess: () => {
    void utils.base.get.invalidate({ id: baseId });
    void utils.base.list.invalidate();
    toast.success('Base renamed');
  },
});
const del = trpc.base.delete.useMutation({
  onSuccess: () => {
    void utils.base.list.invalidate();
    toast.success('Base deleted');
    router.push('/bases');
  },
});
```

- [ ] **Step 5: 接 base 创建失败 toast**

`bases/new/page.tsx`：顶部 `import { toast } from '@/lib/toast';`。给 `base.create` 的 `useMutation` 加 `onError`：
```tsx
const create = trpc.base.create.useMutation({
  onSuccess: (row) => {
    void utils.base.list.invalidate();
    router.push(`/bases/${row.id}`);
  },
  onError: (err) => toast.error(err.message),
});
```
（保留现有 `onSuccess` 逻辑，仅新增 `onError`。若现有结构不同，只把 `onError: (err) => toast.error(err.message)` 加进去。）

- [ ] **Step 6: typecheck + lint**

Run: `pnpm --filter @markpocket/web typecheck && pnpm lint`
Expected: 通过。

- [ ] **Step 7: 浏览器验证**

- 打开一个 base 的 Settings tab（`/bases/<id>/settings/general`），改名点 Save → 右下角出现 `Base renamed` toast，~3s 消失，可点 × 关。
- 删除一个临时 base → 跳转前/后出现 `Base deleted` toast。
- error 样式：可临时在控制台 `import('/...').then(...)` 不便；改为验证成功 toast 即可（error toast 路径由代码审查覆盖）。

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/toast.ts apps/web/src/components/toaster.tsx apps/web/src/app/layout.tsx "apps/web/src/app/bases/[baseId]/settings/general/page.tsx" apps/web/src/app/bases/new/page.tsx
git commit -m "feat(polish): 自造最小 Toast 系统 + 演示接线

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: ⌘K 命令面板占位

**Files:**
- Create: `apps/web/src/components/command-palette.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`（挂 palette）
- Modify: `apps/web/src/components/topbar.tsx`（`<kbd>` → 可点击）

**Interfaces:**
- Produces：`<CommandPalette bases={Array<{ id: string; name: string }>} />`。
- Consumes：`ui/command.tsx` 的 `CommandDialog/CommandInput/CommandList/CommandEmpty/CommandGroup/CommandItem`；`AppShell` 的 `bases`（`SidebarBase[]`，含 `{id, name}`）。

- [ ] **Step 1: `command-palette.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

export function CommandPalette({ bases }: { bases: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem value="Go to Bases" onSelect={() => go('/bases')}>
            Go to Bases
          </CommandItem>
          <CommandItem value="New base" onSelect={() => go('/bases/new')}>
            New base
          </CommandItem>
        </CommandGroup>
        {bases.length > 0 && (
          <CommandGroup heading="Bases">
            {bases.map((b) => (
              <CommandItem key={b.id} value={b.name} onSelect={() => go(`/bases/${b.id}`)}>
                {b.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
```

- [ ] **Step 2: 挂 palette 到 `app-shell.tsx`**

`import { CommandPalette } from './command-palette';`，在 AppShell 的最外层 `<div className="h-screen flex flex-col bg-background">` 内（Statusbar 之后）加 `<CommandPalette bases={bases} />`：
```tsx
        {statusbarVariant !== 'none' && <Statusbar variant={statusbarVariant} />}
        <CommandPalette bases={bases} />
      </div>
```
（`bases` 是 `SidebarBase[]`，含 `id`/`name`，与 palette props 兼容。）

- [ ] **Step 3: Topbar `<kbd>` 改为可点击按钮**

`topbar.tsx` 里把 `<kbd className="…"><Command …/>K</kbd>` 改为 `<button>`，onClick 派发合成 ⌘K：
```tsx
<button
  type="button"
  onClick={() =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
    )
  }
  className="hidden h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground md:inline-flex"
  title="Command palette (⌘K)"
>
  <Command className="size-2.5" />K
</button>
```
（保留 `Command` icon import。）

- [ ] **Step 4: typecheck + lint**

Run: `pnpm --filter @markpocket/web typecheck && pnpm lint`
Expected: 通过。

- [ ] **Step 5: 浏览器验证**

登录后任意 base 页：按 ⌘K（Mac）/ Ctrl+K → 命令面板打开；输入过滤；选 `Go to Bases` / `New base` / 某个 base → 跳转且面板关闭；Esc 关闭；点 Topbar 的 ⌘K 徽章也能打开。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/command-palette.tsx apps/web/src/components/app-shell.tsx apps/web/src/components/topbar.tsx
git commit -m "feat(polish): ⌘K 命令面板占位（cmdk 导航命令）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 收尾（全部 task 后）

- [ ] 浏览器整体回归：404/loading、toast（成功）、⌘K 面板打开/过滤/跳转。
- [ ] 更新 `docs/redesign/status.md` + `docs/STATUS.md`：Phase 7 完成 → **Paper & Ink 重设计整体收官（Phase 6 分享页除外，已延后为独立功能）**。commit。

## 明确不做（见 spec §1/§9）

命令面板真实搜索、全量 mutation 接 toast、global-error、公开分享页。
