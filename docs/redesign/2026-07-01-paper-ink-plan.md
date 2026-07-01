# Paper & Ink 重设计 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Paper & Ink 设计系统替换 Carbon & Citrus，覆盖 markpocket 全部 6 个用户可见页面。

**Architecture:** 自底向上：先落地 token（Phase 0），再 App Shell（Phase 1），再小页面（Phase 2-4），最重的 Grid 留到最后单独 4 步走（Phase 5），公开分享页复用 grid（Phase 6），收尾（Phase 7）。每 phase 独立可 ship、可回滚。

**Tech Stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 · shadcn · Base UI · lucide-react · cmdk · tRPC · better-auth · Drizzle · Postgres · ws

## Global Constraints

- Node 22+, pnpm 10+
- shadcn + Tailwind v4 保留，不引入新 UI 库
- Light-first；`.dark` 类留 CSS 但默认不挂 `<html>`
- 字段语义见 `CONTEXT.md`：是 "Expression Field" 不是 "Formula"
- 字段引用以 chip token 形式编写（锚定 field id）
- 行高 32px 默认（compact 28px），cell padding 4×10px
- 颜色规则：UI chrome 永远中性，颜色仅在 `--destructive` / `--field-*` / `--online` 三类出现
- **无测试框架**：每个 task 用 `pnpm typecheck` + `pnpm lint` + 浏览器肉眼验证作为质量门
- 每个 task 独立 commit；commit 风格 `<type>: <desc>`，type 用 feat / refactor / style / docs / chore
- 测试账号：本地 dev 起 `./dev.sh`，访问 http://localhost:7420，better-auth 在 `apps/web/src/server/auth.ts`

## File Structure

### 新建

| 文件 | 责任 |
|---|---|
| `apps/web/src/components/app-shell.tsx` | 三层 shell 容器（topbar/sidebar/statusbar/main slot） |
| `apps/web/src/components/topbar.tsx` | 40px 顶条 |
| `apps/web/src/components/sidebar.tsx` | 240/48 折叠侧栏 |
| `apps/web/src/components/statusbar.tsx` | 24px 状态条 |
| `apps/web/src/components/breadcrumb.tsx` | URL → breadcrumb 解析 |
| `apps/web/src/components/online-avatars.tsx` | topbar 头像堆叠 |
| `apps/web/src/components/view-tabs.tsx` | grid 上方 view 切换条 |
| `apps/web/src/components/filter-bar.tsx` | filter/sort chip 条 |
| `apps/web/src/components/chip.tsx` | 四类 chip 组件 |
| `apps/web/src/components/cell-history-dock.tsx` | 右侧 280px 历史 dock |
| `apps/web/src/components/cell-renderers.tsx` | 11 种字段类型 cell renderer（单文件集） |
| `apps/web/src/components/empty-state.tsx` | 空状态 |
| `apps/web/src/components/loading-bar.tsx` | 顶部 1px ink 进度条 |
| `apps/web/src/components/toaster.tsx` | 右下 toast 容器 |
| `apps/web/src/components/command-palette.tsx` | Phase 2 占位 |
| `apps/web/src/lib/use-sidebar-collapsed.ts` | sidebar 折叠状态 hook |
| `apps/web/src/lib/use-keyboard-shortcuts.ts` | 全局快捷键 hook |
| `apps/web/src/app/bases/[baseId]/settings/page.tsx` | Base 详情 tabs 页 |
| `apps/web/src/app/share/[token]/page.tsx` | 公开分享页 |
| `apps/web/src/app/not-found.tsx` | 404 |
| `apps/web/src/app/error.tsx` | 500 |
| `apps/web/src/app/loading.tsx` | loading |

### 修改

| 文件 | 修改点 |
|---|---|
| `apps/web/src/app/globals.css` | 全替换 |
| `apps/web/src/app/layout.tsx` | 加 Inter + JetBrains Mono + Toaster + CommandPalette |
| `apps/web/src/app/(auth)/login/page.tsx` | 重设计 |
| `apps/web/src/app/(auth)/register/page.tsx` | 重设计 |
| `apps/web/src/app/bases/layout.tsx` | 用 `<AppShell>` |
| `apps/web/src/app/bases/page.tsx` | list 布局 |
| `apps/web/src/app/bases/[baseId]/layout.tsx` | 加 AppShell breadcrumb 数据 |
| `apps/web/src/app/bases/[baseId]/page.tsx` | redirect 逻辑 |
| `apps/web/src/app/bases/[baseId]/tables/[tableId]/page.tsx` | 数据加载 |
| `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx` | 大重构 |
| `apps/web/package.json` | 加 Inter + JetBrains Mono 字体包 |

### 删除

| 文件 | 何时删 |
|---|---|
| `apps/web/src/components/sidebar-nav.tsx` | Phase 1 AppShell 接管后 |

### 字体依赖

```bash
pnpm --filter @markpocket/web add @fontsource-variable/inter @fontsource-variable/jetbrains-mono
```

---

## Phase 0 · 设计 token 落地（0.5 day）

### Task 0.1: 落地 Paper & Ink token 与字体

**Files:**
- Modify: `apps/web/src/app/globals.css`（全替换）
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/package.json`（加字体依赖）

**Interfaces:**
- Produces: 所有 CSS 变量名（`--background` / `--foreground` / `--primary` / `--muted` / `--border` / `--destructive` / `--online` / `--field-*` / `--radius-*` / `--sidebar*`）供后续所有 task 使用

- [ ] **Step 1: 加字体依赖**

Run:
```bash
pnpm --filter @markpocket/web add @fontsource-variable/inter @fontsource-variable/jetbrains-mono
```

Expected: `package.json` 多两行 dependencies，lockfile 更新。

- [ ] **Step 2: 全替换 `apps/web/src/app/globals.css`**

```css
@import 'tailwindcss';
@import 'tw-animate-css';
@import 'shadcn/tailwind.css';
@import '@fontsource-variable/inter';
@import '@fontsource-variable/jetbrains-mono';

@custom-variant dark (&:is(.dark *));

@theme inline {
  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono Variable', ui-monospace, SFMono-Regular, monospace;
  --font-heading: var(--font-sans);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-online: var(--online);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --color-field-text: var(--field-text);
  --color-field-number: var(--field-number);
  --color-field-date: var(--field-date);
  --color-field-select: var(--field-select);
  --color-field-link: var(--field-link);
  --color-field-bool: var(--field-bool);

  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);

  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

/* ─── Paper & Ink ─── Light-first, ink black as primary */
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.18 0 0);
  --card: oklch(0.995 0 0);
  --card-foreground: oklch(0.18 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.18 0 0);
  --primary: oklch(0.18 0 0);
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.96 0 0);
  --secondary-foreground: oklch(0.22 0 0);
  --muted: oklch(0.96 0 0);
  --muted-foreground: oklch(0.45 0 0);
  --accent: oklch(0.96 0 0);
  --accent-foreground: oklch(0.18 0 0);
  --destructive: oklch(0.55 0.22 27);
  --online: oklch(0.65 0.15 145);
  --border: oklch(0.92 0 0);
  --input: oklch(0.92 0 0);
  --ring: oklch(0.18 0 0);

  /* Field-type tints — color belongs to data, not chrome */
  --field-text: oklch(0.55 0.01 75);
  --field-number: oklch(0.50 0.04 250);
  --field-date: oklch(0.55 0.05 60);
  --field-select: oklch(0.55 0.05 330);
  --field-link: oklch(0.55 0.04 130);
  --field-bool: oklch(0.55 0.02 200);

  --radius: 0.375rem;

  --sidebar: oklch(0.98 0 0);
  --sidebar-foreground: oklch(0.18 0 0);
  --sidebar-primary: oklch(0.18 0 0);
  --sidebar-primary-foreground: oklch(1 0 0);
  --sidebar-accent: oklch(0.95 0 0);
  --sidebar-accent-foreground: oklch(0.18 0 0);
  --sidebar-border: oklch(0.92 0 0);
  --sidebar-ring: oklch(0.18 0 0);
}

.dark {
  /* Phase 2 — 留口不挂 */
  --background: oklch(0.155 0 0);
  --foreground: oklch(0.95 0 0);
  --card: oklch(0.185 0 0);
  --card-foreground: oklch(0.95 0 0);
  --popover: oklch(0.185 0 0);
  --popover-foreground: oklch(0.95 0 0);
  --primary: oklch(0.95 0 0);
  --primary-foreground: oklch(0.155 0 0);
  --secondary: oklch(0.24 0 0);
  --secondary-foreground: oklch(0.95 0 0);
  --muted: oklch(0.22 0 0);
  --muted-foreground: oklch(0.62 0 0);
  --accent: oklch(0.28 0 0);
  --accent-foreground: oklch(0.95 0 0);
  --destructive: oklch(0.65 0.2 25);
  --online: oklch(0.7 0.15 145);
  --border: oklch(0.28 0 0);
  --input: oklch(0.28 0 0);
  --ring: oklch(0.95 0 0);

  --sidebar: oklch(0.135 0 0);
  --sidebar-foreground: oklch(0.88 0 0);
  --sidebar-primary: oklch(0.95 0 0);
  --sidebar-primary-foreground: oklch(0.155 0 0);
  --sidebar-accent: oklch(0.20 0 0);
  --sidebar-accent-foreground: oklch(0.95 0 0);
  --sidebar-border: oklch(0.25 0 0);
  --sidebar-ring: oklch(0.95 0 0);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
    font-feature-settings: 'cv11', 'ss01', 'ss03';
    -webkit-font-smoothing: antialiased;
    letter-spacing: -0.006em;
  }
  html {
    @apply font-sans;
  }
  .font-mono, code, pre {
    font-family: var(--font-mono), ui-monospace, SFMono-Regular, monospace;
  }
}

/* ─── Grid polish ─── */
table.markpocket-grid {
  font-variant-numeric: tabular-nums;
}
table.markpocket-grid th {
  font-weight: 500;
  letter-spacing: -0.01em;
}
table.markpocket-grid td {
  font-variant-numeric: tabular-nums;
  vertical-align: top;
}

/* ─── Scrollbar ─── */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: oklch(0.6 0 0 / 0.25); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: oklch(0.5 0 0 / 0.45); }

/* ─── Selection ─── */
::selection {
  background: oklch(0.18 0 0 / 0.12);
}

/* ─── Loading bar ─── */
@keyframes mp-loading {
  0% { transform: translateX(-100%); }
  50% { transform: translateX(0%); }
  100% { transform: translateX(100%); }
}
.mp-loading-bar {
  animation: mp-loading 1.6s ease-in-out infinite;
}
```

- [ ] **Step 3: 修改 `apps/web/src/app/layout.tsx`**

读现有文件，找到 `<html lang=...>` 与 body。在 body 内顶部加 Toaster + CommandPalette 占位（这两个组件后续 Phase 创建，先 import 占位为空 fragment 也可以，或留到 Phase 7 再加）。本步只改字体相关：

```tsx
// apps/web/src/app/layout.tsx
import type { Metadata } from 'next';
import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'markpocket',
  description: 'the airtable you own',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
```

> 字体已通过 `@import` 在 globals.css 加载，无需 next/font。

- [ ] **Step 4: typecheck + lint**

Run:
```bash
pnpm typecheck && pnpm lint
```
Expected: 0 errors。

- [ ] **Step 5: 启动 dev 肉眼验证**

Run:
```bash
./dev.sh
```
打开 http://localhost:7420，登录进 `/bases`。验收：
- 页面整体白底（不是之前的深色）
- shadcn 默认按钮变墨黑底白字
- 任何旧页面（不重构 HTML）颜色对得上，不报错

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/app/layout.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
style: 落地 Paper & Ink 设计 token

替换 Carbon & Citrus 调色板。Light-first · 墨黑主色 · 字段类型 muted tint。
Inter Variable + JetBrains Mono Variable 通过 @fontsource 引入。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 1 · App Shell（1 day）

### Task 1.1: sidebar 折叠 hook + Breadcrumb 组件 + breadcrumb context

**Files:**
- Create: `apps/web/src/lib/use-sidebar-collapsed.ts`
- Create: `apps/web/src/lib/breadcrumb-context.tsx`
- Create: `apps/web/src/components/breadcrumb.tsx`

**Interfaces:**
- Produces: `useSidebarCollapsed()` → `{ collapsed: boolean; toggle: () => void; setCollapsed: (v: boolean) => void }`
- Produces: `<BreadcrumbProvider>` / `useBreadcrumb()` / `useBreadcrumbSetter(segments)`
- Produces: `<Breadcrumb segments={[{label, href?}]} />`

- [ ] **Step 1: 写 `use-sidebar-collapsed.ts`（含 mobile 自动折叠）**

```ts
// apps/web/src/lib/use-sidebar-collapsed.ts
'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'mp:sidebar';
const MOBILE_BREAKPOINT = 1024;

export function useSidebarCollapsed() {
  const [collapsed, setCollapsedState] = useState(false);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    if (stored === '1') setCollapsedState(true);
    // < 1024px 自动折叠（spec §5.8）
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    if (mq.matches) setCollapsedState(true);
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setCollapsedState(true);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(KEY, v ? '1' : '0');
    }
  }, []);

  const toggle = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  return { collapsed, toggle, setCollapsed };
}
```

- [ ] **Step 2: 写 `breadcrumb-context.tsx`**

```tsx
// apps/web/src/lib/breadcrumb-context.tsx
'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { BreadcrumbSegment } from '@/components/breadcrumb';

const DEFAULT_SEGMENTS: BreadcrumbSegment[] = [{ label: 'Workspace' }];

const Ctx = createContext<{
  segments: BreadcrumbSegment[];
  setSegments: (s: BreadcrumbSegment[]) => void;
}>({ segments: DEFAULT_SEGMENTS, setSegments: () => {} });

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [segments, setSegments] = useState<BreadcrumbSegment[]>(DEFAULT_SEGMENTS);
  return <Ctx.Provider value={{ segments, setSegments }}>{children}</Ctx.Provider>;
}

export function useBreadcrumb() {
  return useContext(Ctx).segments;
}

export function useBreadcrumbSetter(segments: BreadcrumbSegment[]) {
  const { setSegments } = useContext(Ctx);
  const key = JSON.stringify(segments);
  useEffect(() => {
    setSegments(segments);
    return () => setSegments(DEFAULT_SEGMENTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setSegments]);
}
```

- [ ] **Step 3: 写 `breadcrumb.tsx`**

```tsx
// apps/web/src/components/breadcrumb.tsx
'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export type BreadcrumbSegment = {
  label: string;
  href?: string;
};

export function Breadcrumb({ segments }: { segments: BreadcrumbSegment[] }) {
  return (
    <nav className="flex items-center gap-0.5 text-sm min-w-0">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <div key={i} className="flex items-center gap-0.5 min-w-0">
            {seg.href && !isLast ? (
              <Link
                href={seg.href}
                className="text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted truncate max-w-[180px]"
              >
                {seg.label}
              </Link>
            ) : (
              <span
                className={cn(
                  'px-1.5 py-0.5 truncate max-w-[220px]',
                  isLast ? 'text-foreground font-medium' : 'text-muted-foreground'
                )}
              >
                {seg.label}
              </span>
            )}
            {!isLast && <ChevronRight className="size-3.5 text-muted-foreground/60 shrink-0" />}
          </div>
        );
      })}
    </nav>
  );
}
```

> `cn` 工具已存在于 `apps/web/src/lib/cn.ts`（shadcn 标准）。若不存在，本步先创建：
> ```ts
> // apps/web/src/lib/cn.ts
> import { clsx, type ClassValue } from 'clsx';
> import { twMerge } from 'tailwind-merge';
> export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
> ```

- [ ] **Step 4: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/use-sidebar-collapsed.ts apps/web/src/lib/breadcrumb-context.tsx apps/web/src/lib/cn.ts apps/web/src/components/breadcrumb.tsx
git commit -m "feat(shell): sidebar 折叠 hook + Breadcrumb 组件 + context

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.2: Topbar 组件（含 OnlineAvatars）

**Files:**
- Create: `apps/web/src/components/online-avatars.tsx`
- Create: `apps/web/src/components/topbar.tsx`

**Interfaces:**
- Consumes: `useSidebarCollapsed().toggle`、`useBreadcrumb()`（context）
- Produces: `<Topbar onlineUsers={users} currentUser={user} />`（breadcrumb 走 context）

- [ ] **Step 1: 写 `online-avatars.tsx`**

```tsx
// apps/web/src/components/online-avatars.tsx
'use client';

import { cn } from '@/lib/cn';

export type OnlineUser = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function OnlineAvatars({ users, max = 3 }: { users: OnlineUser[]; max?: number }) {
  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;
  return (
    <div className="flex items-center -space-x-2">
      {visible.map((u) => {
        const hue = hashHue(u.id);
        return (
          <div
            key={u.id}
            className="relative size-5 rounded-full ring-1 ring-background overflow-hidden flex items-center justify-center text-[10px] font-medium text-white"
            style={{ background: u.avatarUrl ? undefined : `oklch(0.55 0.04 ${hue})` }}
            title={u.name}
          >
            {u.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={u.avatarUrl} alt={u.name} className="size-full object-cover" />
            ) : (
              <span className="font-mono">{initials(u.name)}</span>
            )}
            <span className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-online ring-1 ring-background" />
          </div>
        );
      })}
      {overflow > 0 && (
        <div
          className={cn(
            'size-5 rounded-full ring-1 ring-background bg-muted flex items-center justify-center',
            'text-[10px] font-mono text-muted-foreground'
          )}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 写 `topbar.tsx`**

```tsx
// apps/web/src/components/topbar.tsx
'use client';

import { PanelLeftClose, PanelLeft, Command } from 'lucide-react';
import { Breadcrumb } from './breadcrumb';
import { OnlineAvatars, type OnlineUser } from './online-avatars';
import { useSidebarCollapsed } from '@/lib/use-sidebar-collapsed';
import { useBreadcrumb } from '@/lib/breadcrumb-context';
import { cn } from '@/lib/cn';

export type CurrentUser = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

export function Topbar({
  onlineUsers = [],
  currentUser,
}: {
  onlineUsers?: OnlineUser[];
  currentUser?: CurrentUser;
}) {
  const { collapsed, toggle } = useSidebarCollapsed();
  const breadcrumb = useBreadcrumb();

  return (
    <header
      className={cn(
        'sticky top-0 z-30 h-10 flex items-center gap-2 px-3',
        'bg-background/95 backdrop-blur-sm border-b border-border'
      )}
    >
      <button
        type="button"
        onClick={toggle}
        className="size-7 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar (⌘\\)' : 'Collapse sidebar (⌘\\)'}
      >
        {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
      </button>

      <div className="flex-1 min-w-0">
        <Breadcrumb segments={breadcrumb} />
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {onlineUsers.length > 0 && <OnlineAvatars users={onlineUsers} />}
        <kbd
          className="hidden md:inline-flex items-center gap-0.5 h-5 px-1.5 rounded border border-border bg-muted text-[10px] text-muted-foreground font-mono"
          title="Command palette"
        >
          <Command className="size-2.5" />K
        </kbd>
        {currentUser && (
          <div
            className="size-7 rounded-full bg-muted flex items-center justify-center text-xs font-mono"
            title={currentUser.name}
          >
            {currentUser.name
              .split(/\s+/)
              .slice(0, 2)
              .map((s) => s[0]?.toUpperCase())
              .join('')}
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 3: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/online-avatars.tsx apps/web/src/components/topbar.tsx
git commit -m "feat(shell): Topbar 组件 + 在线头像堆叠

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.3: Sidebar 组件

**Files:**
- Create: `apps/web/src/components/sidebar.tsx`

**Interfaces:**
- Consumes: `useSidebarCollapsed()`
- Produces: `<Sidebar bases={[...]} currentBaseId? />`

- [ ] **Step 1: 写 `sidebar.tsx`**

```tsx
// apps/web/src/components/sidebar.tsx
'use client';

import Link from 'next/link';
import { Database, Users, Settings, Plus } from 'lucide-react';
import { useSidebarCollapsed } from '@/lib/use-sidebar-collapsed';
import { cn } from '@/lib/cn';

export type SidebarBase = {
  id: string;
  name: string;
  tables: { id: string; name: string }[];
};

export function Sidebar({
  bases,
  currentBaseId,
  workspaceName = 'Workspace',
}: {
  bases: SidebarBase[];
  currentBaseId?: string;
  workspaceName?: string;
}) {
  const { collapsed } = useSidebarCollapsed();
  const width = collapsed ? 'w-12' : 'w-60';

  return (
    <aside
      className={cn(
        'shrink-0 border-r border-border bg-sidebar text-sidebar-foreground',
        'flex flex-col transition-[width] duration-150',
        width
      )}
    >
      {/* workspace name */}
      <div className="h-10 flex items-center px-3 border-b border-sidebar-border shrink-0">
        {collapsed ? (
          <Database className="size-4 text-muted-foreground" />
        ) : (
          <span className="text-sm font-medium truncate">{workspaceName}</span>
        )}
      </div>

      {/* bases list */}
      <nav className="flex-1 overflow-y-auto py-2">
        {!collapsed && bases.length > 0 && (
          <div className="px-3 pb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {bases.length} {bases.length === 1 ? 'base' : 'bases'}
          </div>
        )}
        <ul className="px-1.5 space-y-0.5">
          {bases.map((base) => {
            const isCurrent = base.id === currentBaseId;
            return (
              <li key={base.id}>
                <Link
                  href={`/bases/${base.id}`}
                  className={cn(
                    'group relative flex items-center gap-2 px-2 py-1.5 rounded text-sm',
                    isCurrent
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'hover:bg-sidebar-accent/60 text-sidebar-foreground/80 hover:text-sidebar-foreground',
                    collapsed && 'justify-center'
                  )}
                  title={collapsed ? base.name : undefined}
                >
                  {isCurrent && (
                    <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-foreground rounded-r" />
                  )}
                  <Database className="size-3.5 shrink-0 text-muted-foreground" />
                  {!collapsed && <span className="truncate">{base.name}</span>}
                </Link>
              </li>
            );
          })}
        </ul>

        {!collapsed && (
          <div className="px-1.5 pt-1">
            <Link
              href="/bases/new"
              className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
            >
              <Plus className="size-3.5" />
              <span>new base</span>
            </Link>
          </div>
        )}
      </nav>

      {/* bottom fixed */}
      <div className="border-t border-sidebar-border p-1.5 space-y-0.5 shrink-0">
        <Link
          href="/members"
          className={cn(
            'flex items-center gap-2 px-2 py-1.5 rounded text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
            collapsed && 'justify-center'
          )}
          title={collapsed ? 'Members' : undefined}
        >
          <Users className="size-3.5" />
          {!collapsed && <span>members</span>}
        </Link>
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-2 px-2 py-1.5 rounded text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
            collapsed && 'justify-center'
          )}
          title={collapsed ? 'Settings' : undefined}
        >
          <Settings className="size-3.5" />
          {!collapsed && <span>settings</span>}
        </Link>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/sidebar.tsx
git commit -m "feat(shell): Sidebar 组件（240/48 折叠）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.4: Statusbar 组件

**Files:**
- Create: `apps/web/src/components/statusbar.tsx`

**Interfaces:**
- Produces: `<Statusbar onlineCount savedSecondsAgo lww? shortcuts? />`

- [ ] **Step 1: 写 `statusbar.tsx`**

```tsx
// apps/web/src/components/statusbar.tsx
'use client';

import { cn } from '@/lib/cn';

function relativeTime(secondsAgo: number | null): string {
  if (secondsAgo === null) return '';
  if (secondsAgo < 5) return 'saved just now';
  if (secondsAgo < 60) return `saved ${secondsAgo}s ago`;
  if (secondsAgo < 3600) return `saved ${Math.floor(secondsAgo / 60)}m ago`;
  return `saved ${Math.floor(secondsAgo / 3600)}h ago`;
}

export function Statusbar({
  onlineCount = 1,
  savedSecondsAgo = null,
  lww = null,
  shortcuts = '↑↓ nav · ⌘K',
  variant = 'full',
}: {
  onlineCount?: number;
  savedSecondsAgo?: number | null;
  lww?: { field: string; by: string } | null;
  shortcuts?: string;
  variant?: 'full' | 'compact';
}) {
  return (
    <footer
      className={cn(
        'h-6 shrink-0 flex items-center justify-between px-3 text-[11px] font-mono',
        'bg-background border-t border-border text-muted-foreground'
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-online" />
          {onlineCount} online
        </span>
        {variant === 'full' && savedSecondsAgo !== null && (
          <span className="truncate">{relativeTime(savedSecondsAgo)}</span>
        )}
        {variant === 'full' && lww && (
          <span className="text-destructive truncate">
            LWW: {lww.field} overwritten by @{lww.by}
          </span>
        )}
      </div>
      {variant === 'full' && (
        <div className="hidden md:block text-muted-foreground/70 shrink-0">{shortcuts}</div>
      )}
    </footer>
  );
}
```

- [ ] **Step 2: typecheck + lint + Commit**

```bash
pnpm typecheck && pnpm lint && \
git add apps/web/src/components/statusbar.tsx && \
git commit -m "feat(shell): Statusbar 组件

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.5: AppShell 容器 + 删除旧 sidebar-nav + 接入 bases layout

**Files:**
- Create: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/app/bases/layout.tsx`
- Delete: `apps/web/src/components/sidebar-nav.tsx`

**Interfaces:**
- Produces: `<AppShell onlineUsers currentUser bases currentBaseId statusbarVariant>{children}</AppShell>`（breadcrumb 走 context）

- [ ] **Step 1: 写 `app-shell.tsx`**

```tsx
// apps/web/src/components/app-shell.tsx
'use client';

import { Topbar, type CurrentUser } from './topbar';
import { Sidebar, type SidebarBase } from './sidebar';
import { Statusbar } from './statusbar';
import { OnlineUser } from './online-avatars';
import { BreadcrumbProvider } from '@/lib/breadcrumb-context';
import { cn } from '@/lib/cn';

export function AppShell({
  onlineUsers = [],
  currentUser,
  bases = [],
  currentBaseId,
  statusbarVariant = 'full',
  children,
}: {
  onlineUsers?: OnlineUser[];
  currentUser?: CurrentUser;
  bases?: SidebarBase[];
  currentBaseId?: string;
  statusbarVariant?: 'full' | 'compact' | 'none';
  children: React.ReactNode;
}) {
  return (
    <BreadcrumbProvider>
      <div className="h-screen flex flex-col bg-background">
        <Topbar onlineUsers={onlineUsers} currentUser={currentUser} />
        <div className="flex-1 flex min-h-0">
          <Sidebar bases={bases} currentBaseId={currentBaseId} />
          <main className={cn('flex-1 min-w-0 flex flex-col')}>{children}</main>
        </div>
        {statusbarVariant !== 'none' && <Statusbar variant={statusbarVariant} />}
      </div>
    </BreadcrumbProvider>
  );
}
```

- [ ] **Step 2: 改 `apps/web/src/app/bases/layout.tsx`**

```tsx
// apps/web/src/app/bases/layout.tsx
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AppShell } from '@/components/app-shell';
import { auth } from '@/server/auth';

export default async function BasesLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect('/login');

  // TODO Task 1.6: 真实 bases 列表 + online presence 从 realtime 取
  const bases: never[] = [];
  const onlineUsers: never[] = [];

  return (
    <AppShell
      currentUser={
        session.user
          ? {
              id: session.user.id,
              name: session.user.name ?? session.user.email ?? 'me',
              avatarUrl: session.user.image ?? null,
            }
          : undefined
      }
      bases={bases}
      onlineUsers={onlineUsers}
    >
      {children}
    </AppShell>
  );
}
```

> 注：`bases` 与 `onlineUsers` 暂传空数组。Task 1.6 接真实数据。

- [ ] **Step 3: 删旧组件**

```bash
rm apps/web/src/components/sidebar-nav.tsx
```

检查残留引用：
```bash
grep -rn "sidebar-nav" apps/web/src
```
Expected: 无输出。若有，按报错处改成新 Sidebar。

- [ ] **Step 4: typecheck + lint + 启动验证**

```bash
pnpm typecheck && pnpm lint && ./dev.sh
```
打开 http://localhost:7420/bases，验收：
- topbar 显示 "Workspace" + 用户头像首字母
- sidebar 显示 "0 bases" 空态 + new base 链接 + members/settings 链接
- 点折叠按钮，sidebar 收成 48px，刷新仍保持折叠
- 底部 statusbar 显示 "1 online"

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/app-shell.tsx apps/web/src/app/bases/layout.tsx
git rm apps/web/src/components/sidebar-nav.tsx
git commit -m "feat(shell): AppShell 接入 bases layout，删除旧 sidebar-nav

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.6: 接入真实 bases 列表与 online presence

**Files:**
- Modify: `apps/web/src/app/bases/layout.tsx`
- Read: `apps/web/src/server/trpc.ts`（找 router 入口）
- Read: `apps/web/src/server/realtime/*`（找 presence API）

> 本 task 假设后端已有 `base.list` tRPC 路由和 realtime presence。若没有，先看 `apps/web/src/server/trpc/router/` 找到对应 router 名。

- [ ] **Step 1: 看现有 router 与 presence 实现**

Run:
```bash
ls apps/web/src/server/trpc/router 2>/dev/null || ls apps/web/src/server/trpc 2>/dev/null
ls apps/web/src/server/realtime 2>/dev/null
```

记录：base 列表的 tRPC procedure 全名（例如 `base.list`）、presence 来源（例如 redis、内存 Map、或 ws 连接列表）。

- [ ] **Step 2: 在 `bases/layout.tsx` 用 server-side tRPC caller 取 bases**

具体代码取决于 tRPC router 结构。模板：

```tsx
// 在 bases/layout.tsx 顶部 import
import { api } from '@/server/trpc/server'; // 或对应路径，根据现有 caller 形态

// 在组件内：
const bases = await api.base.list.query();
const mappedBases = bases.map((b) => ({
  id: b.id,
  name: b.name,
  tables: (b.tables ?? []).map((t) => ({ id: t.id, name: t.name })),
}));
```

> 若 server-side caller 不存在，本 task 范围内加一个 `createTRPCServerCaller()` 工厂，放在 `apps/web/src/server/trpc/server-caller.ts`。详细步骤参见现有 `apps/web/src/server/trpc/*` 代码。

- [ ] **Step 3: online presence**

如果 realtime 已有 presence（看 `apps/web/src/server/realtime/`），用同样 server-side 取一份当前 base 内 online user list。如果没有 presence：**本 task 跳过**，`onlineUsers` 暂传空数组，留 TODO。Phase 1 验收不依赖此条。

- [ ] **Step 4: typecheck + lint + 启动验证**

```bash
pnpm typecheck && pnpm lint && ./dev.sh
```
验收：sidebar 出现真实 base 列表（若 DB 里有 base）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/bases/layout.tsx apps/web/src/server/trpc/server-caller.ts 2>/dev/null
git commit -m "feat(shell): sidebar 接入真实 base 列表

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 2 · Login / Register（0.5 day）

### Task 2.1: 重设计 Login 与 Register 页

**Files:**
- Modify: `apps/web/src/app/(auth)/login/page.tsx`
- Modify: `apps/web/src/app/(auth)/register/page.tsx`

- [ ] **Step 1: 写 Login 页**

```tsx
// apps/web/src/app/(auth)/login/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/server/auth/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await auth.signIn.email({ email, password });
    setLoading(false);
    if (res.error) {
      setError(res.error.message ?? 'Sign in failed');
      return;
    }
    router.push('/bases');
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">markpocket</h1>
        <p className="text-sm text-muted-foreground mt-1">the airtable you own</p>
      </div>

      <form onSubmit={onSubmit} className="w-[360px] space-y-3">
        <label className="block">
          <span className="text-xs text-muted-foreground">email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full h-8 px-2.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full h-8 px-2.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-8 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {loading ? '···' : 'sign in'}
        </button>

        <div className="flex items-center gap-2 py-1">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            or
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <button
          type="button"
          onClick={() => auth.signIn.social({ provider: 'oidc' })}
          className="w-full h-8 rounded-md border border-input text-sm hover:bg-muted"
        >
          continue with oidc
        </button>
      </form>

      <p className="mt-6 text-xs text-muted-foreground">
        no account?{' '}
        <Link href="/register" className="text-foreground underline underline-offset-2">
          register
        </Link>
      </p>
    </main>
  );
}
```

> `auth` client 路径根据现有 `apps/web/src/server/auth.ts` 决定。若有 `auth.client`，用之；否则 import 顶层 client，名字按现有代码。

- [ ] **Step 2: 写 Register 页（复用 Login 结构）**

```tsx
// apps/web/src/app/(auth)/register/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/server/auth/client';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('passwords do not match');
      return;
    }
    setLoading(true);
    const res = await auth.signUp.email({ email, password, name });
    setLoading(false);
    if (res.error) {
      setError(res.error.message ?? 'Sign up failed');
      return;
    }
    router.push('/bases');
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">markpocket</h1>
        <p className="text-sm text-muted-foreground mt-1">the airtable you own</p>
      </div>

      <form onSubmit={onSubmit} className="w-[360px] space-y-3">
        <label className="block">
          <span className="text-xs text-muted-foreground">name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full h-8 px-2.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full h-8 px-2.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full h-8 px-2.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">confirm password</span>
          <input
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full h-8 px-2.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-8 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {loading ? '···' : 'register'}
        </button>
      </form>

      <p className="mt-6 text-xs text-muted-foreground">
        already have an account?{' '}
        <Link href="/login" className="text-foreground underline underline-offset-2">
          sign in
        </Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 3: typecheck + lint + 浏览器验证**

```bash
pnpm typecheck && pnpm lint && ./dev.sh
```
验收：
- http://localhost:7420/login 显示居中卡片，墨黑按钮
- 错误密码 → input 下方红字
- 登录成功 → 跳 /bases
- http://localhost:7420/register 同样工作
- 两次密码不一致 → 红字

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(auth\)/login/page.tsx apps/web/src/app/\(auth\)/register/page.tsx
git commit -m "feat(auth): 重设计 Login / Register 页（Paper & Ink）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 3 · Bases 列表（0.5 day）

### Task 3.1: 重设计 `/bases` 列表

**Files:**
- Modify: `apps/web/src/app/bases/page.tsx`
- Create: `apps/web/src/components/empty-state.tsx`

- [ ] **Step 1: 写 `empty-state.tsx`**

```tsx
// apps/web/src/components/empty-state.tsx
import { cn } from '@/lib/cn';

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)}>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 2: 写 `/bases/page.tsx`**

```tsx
// apps/web/src/app/bases/page.tsx
'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/server/trpc/client';
import { OnlineAvatars } from '@/components/online-avatars';
import { EmptyState } from '@/components/empty-state';

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function BasesPage() {
  const { data: bases, isLoading } = useQuery(trpc.base.list.queryOptions());

  if (isLoading) {
    return <div className="flex-1 p-6"><div className="h-12 rounded bg-muted animate-pulse" /></div>;
  }

  if (!bases || bases.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          title="No bases yet"
          description="Create one to get going"
          action={
            <Link
              href="/bases/new"
              className="h-8 px-3 inline-flex items-center rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90"
            >
              create your first base
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <header className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold">Workspace</h1>
            <p className="text-xs text-muted-foreground font-mono">
              {bases.length} {bases.length === 1 ? 'base' : 'bases'}
            </p>
          </div>
          <Link
            href="/bases/new"
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90"
          >
            + new base
          </Link>
        </header>

        <ul className="border-t border-border">
          {bases.map((b) => (
            <li key={b.id}>
              <Link
                href={`/bases/${b.id}`}
                className="block px-3 py-3 -mx-3 rounded hover:bg-muted border-b border-border"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{b.name}</div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                      {b.tableCount} {b.tableCount === 1 ? 'table' : 'tables'} · {b.rowCount} rows
                      {' · '}
                      {timeAgo(b.lastActivityAt)} by @{b.lastActivityBy ?? '—'}
                    </div>
                  </div>
                  <OnlineAvatars users={(b.members ?? []).map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl }))} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

> 注：`b.tableCount / b.rowCount / b.lastActivityAt / b.lastActivityBy / b.members` 是 tRPC `base.list` 返回字段。若 router 不返回这些，**本 task 范围内**给 router 补：编辑 `apps/web/src/server/trpc/router/base.ts`（路径可能不同），在 list handler 里 `select` 聚合 `count()` table/row，按 `cell_history.created_at desc` 取 last activity。若聚合过重，Phase 1 可只返回 `name` 和 `id`，列表显示 "Workspace · N bases" 不显示 meta；后续 task 补。

- [ ] **Step 3: typecheck + lint + 浏览器验证**

```bash
pnpm typecheck && pnpm lint && ./dev.sh
```
验收：
- /bases 显示 base 列表，每行紧凑 72px
- 空状态（清空 DB 后）显示 "No bases yet"
- 排序默认 last-activity（router 已 ORDER BY 即可）

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/bases/page.tsx apps/web/src/components/empty-state.tsx apps/web/src/server/trpc/router/base.ts 2>/dev/null
git commit -m "feat(bases): list 布局 + EmptyState 组件

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 4 · Base 详情 + Tabs（0.5 day）

### Task 4.1: redirect + settings tabs 页

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/page.tsx`
- Create: `apps/web/src/app/bases/[baseId]/settings/page.tsx`
- Create: `apps/web/src/app/bases/[baseId]/layout.tsx` 内容（breadcrumb 补 base name）

- [ ] **Step 1: 改 `bases/[baseId]/page.tsx` 为 redirect**

```tsx
// apps/web/src/app/bases/[baseId]/page.tsx
import { redirect } from 'next/navigation';
import { db } from '@/server/db';
import { tables } from '@/server/db/schema';
import { eq } from 'drizzle-orm';

export default async function BaseRootPage({
  params,
}: {
  params: Promise<{ baseId: string }>;
}) {
  const { baseId } = await params;
  const firstTable = await db.query.tables.findFirst({
    where: eq(tables.baseId, baseId),
    orderBy: (tables, { asc }) => [asc(tables.createdAt)],
  });

  if (!firstTable) {
    redirect(`/bases/${baseId}/settings`);
  }
  redirect(`/bases/${baseId}/tables/${firstTable.id}`);
}
```

> schema 路径与 table 名按现有 `apps/web/src/server/db/schema.ts` 替换。

- [ ] **Step 2: 简化 `bases/[baseId]/layout.tsx`**

breadcrumb 由子页面（settings/page.tsx、grid editor）通过 `useBreadcrumbSetter` 上抛（context 已在 Task 1.1 创建，AppShell 在 Task 1.5 已包 Provider）。本 layout 极简，只透 baseId：

```tsx
// apps/web/src/app/bases/[baseId]/layout.tsx
export default async function BaseLayout({
  children,
}: {
  children: React.ReactNode;
  params: Promise<{ baseId: string }>;
}) {
  return <>{children}</>;
}
```

> 若需服务端预取 base 名传给 client 子页面（避免 settings/grid 编辑器各取一次），可用 server caller 取一次 base，以 `<BaseContext.Provider value={base}>` 透出。但本计划范围采用客户端各自 query 的更简单做法。

- [ ] **Step 3: 写 `bases/[baseId]/settings/page.tsx`**

```tsx
// apps/web/src/app/bases/[baseId]/settings/page.tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/server/trpc/client';
import { useBreadcrumbSetter } from '@/lib/breadcrumb-context';
import { cn } from '@/lib/cn';

type Tab = 'tables' | 'members' | 'settings' | 'history';

export default function BaseSettingsPage({ params }: { params: { baseId: string } }) {
  const [tab, setTab] = useState<Tab>('tables');
  const { data: base } = useQuery(trpc.base.get.queryOptions({ id: params.baseId }));

  useBreadcrumbSetter([
    { label: 'Workspace', href: '/bases' },
    { label: base?.name ?? 'Base' },
    { label: 'settings' },
  ]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <header className="mb-4">
          <h1 className="text-lg font-semibold">{base?.name ?? '—'}</h1>
          {base?.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{base.description}</p>
          )}
        </header>

        <nav className="sticky top-10 z-10 -mx-6 px-6 py-2 bg-background/95 backdrop-blur-sm border-b border-border mb-4 flex gap-4 text-sm">
          {(['tables', 'members', 'settings', 'history'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'h-7 px-1 border-b-2 -mb-px capitalize',
                tab === t
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t}
              {t === 'tables' && base?.tables && (
                <span className="ml-1 text-[10px] text-muted-foreground font-mono">
                  {base.tables.length}
                </span>
              )}
              {t === 'members' && base?.members && (
                <span className="ml-1 text-[10px] text-muted-foreground font-mono">
                  {base.members.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {tab === 'tables' && <TablesTab baseId={params.baseId} />}
        {tab === 'members' && <MembersTab baseId={params.baseId} />}
        {tab === 'settings' && <SettingsTab baseId={params.baseId} />}
        {tab === 'history' && <HistoryTab baseId={params.baseId} />}
      </div>
    </div>
  );
}

function TablesTab({ baseId }: { baseId: string }) {
  const { data: tables } = useQuery(trpc.table.list.queryOptions({ baseId }));
  return (
    <ul className="border-t border-border">
      {(tables ?? []).map((t) => (
        <li key={t.id} className="border-b border-border py-2.5 flex items-center justify-between">
          <div>
            <div className="text-sm">{t.name}</div>
            <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
              {t.rowCount} rows · default {t.defaultView}
            </div>
          </div>
          <a
            href={`/bases/${baseId}/tables/${t.id}`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            open →
          </a>
        </li>
      ))}
    </ul>
  );
}

function MembersTab({ baseId: _ }: { baseId: string }) {
  return (
    <p className="text-xs text-muted-foreground font-mono">
      Members matrix (owner / editor / viewer) — Phase 4 详细实现（沿用现有 router.base.members）
    </p>
  );
}

function SettingsTab({ baseId: _ }: { baseId: string }) {
  return (
    <p className="text-xs text-muted-foreground font-mono">
      Base name / description / danger zone — Phase 4 详细实现
    </p>
  );
}

function HistoryTab({ baseId: _ }: { baseId: string }) {
  return (
    <p className="text-xs text-muted-foreground font-mono">
      Base-level history timeline — Phase 4 详细实现
    </p>
  );
}
```

> Members / Settings / History 三个 tab **本 task 只搭壳**。详细表单 Phase 4.5（看进度决定是否单独拆 task）。

- [ ] **Step 4: typecheck + lint + 浏览器验证**

```bash
pnpm typecheck && pnpm lint && ./dev.sh
```
验收：
- 访问 `/bases/<some-base-id>` 自动跳到 `/bases/<id>/tables/<first-table>`（若有 table）
- 访问 `/bases/<id>/settings` 显示 tabs，可切换
- breadcrumb 显示 `Workspace > Base名 > settings`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/bases/\[baseId\]/ apps/web/src/lib/breadcrumb-context.tsx
git commit -m "feat(base): redirect 逻辑 + settings tabs 页（tables/members/settings/history）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 5 · Grid Editor（3 day）

### Task 5.1: ViewTabs + FilterBar + grid 外壳

**Files:**
- Create: `apps/web/src/components/view-tabs.tsx`
- Create: `apps/web/src/components/filter-bar.tsx`
- Create: `apps/web/src/components/chip.tsx`
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/page.tsx`
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`

- [ ] **Step 1: 写 `chip.tsx`（四类 chip）**

```tsx
// apps/web/src/components/chip.tsx
import { cn } from '@/lib/cn';
import { X } from 'lucide-react';

export type FieldType =
  | 'text'
  | 'long-text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'single-select'
  | 'multi-select'
  | 'attachment'
  | 'user'
  | 'link'
  | 'expression';

const fieldTintClass: Record<FieldType, string> = {
  text: 'bg-field-text',
  'long-text': 'bg-field-text',
  number: 'bg-field-number',
  boolean: 'bg-field-bool',
  date: 'bg-field-date',
  'single-select': 'bg-field-select',
  'multi-select': 'bg-field-select',
  attachment: 'bg-field-text',
  user: 'bg-field-number',
  link: 'bg-field-link',
  expression: 'bg-foreground',
};

/** 表达式里的字段引用 chip：[amount] */
export function FieldRefChip({
  label,
  type = 'text',
  onClick,
}: {
  label: string;
  type?: FieldType;
  onClick?: () => void;
}) {
  return (
    <span
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 h-[22px] px-1.5 rounded',
        'border border-foreground/30 bg-transparent',
        'text-[11px] font-mono cursor-default'
      )}
    >
      <span className={cn('size-1.5 rounded-full', fieldTintClass[type])} />
      {label}
    </span>
  );
}

/** multi-select cell 里的 chip */
export function MultiSelectChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center h-5 px-1.5 rounded bg-muted text-[11px]">
      {label}
    </span>
  );
}

/** filter bar 的 chip：status is Active ✕ */
export function FilterChip({
  field,
  op,
  value,
  onRemove,
}: {
  field: string;
  op: string;
  value: string;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center h-[26px] gap-2 pl-2 pr-1 rounded border border-foreground/20 text-[11px]">
      <span className="font-mono text-muted-foreground">{field}</span>
      <span className="font-mono text-muted-foreground/70">{op}</span>
      <span className="font-mono">{value}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="size-4 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

/** select 字段 cell 里的 dot + label */
export function StatusDot({ label, type = 'single-select' }: { label: string; type?: FieldType }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]">
      <span className={cn('size-1.5 rounded-full', fieldTintClass[type])} />
      {label}
    </span>
  );
}

export { fieldTintClass };
```

- [ ] **Step 2: 写 `view-tabs.tsx`**

```tsx
// apps/web/src/components/view-tabs.tsx
'use client';

import { cn } from '@/lib/cn';
import { Plus, LayoutGrid, FormInput, Kanban, Image as ImageIcon } from 'lucide-react';

export type ViewType = 'grid' | 'form' | 'kanban' | 'gallery';

const viewIcon: Record<ViewType, typeof LayoutGrid> = {
  grid: LayoutGrid,
  form: FormInput,
  kanban: Kanban,
  gallery: ImageIcon,
};

export type ViewTabsProps = {
  views: { id: string; name: string; type: ViewType }[];
  currentViewId: string;
  onSelect: (id: string) => void;
  onCreate?: () => void;
};

export function ViewTabs({ views, currentViewId, onSelect, onCreate }: ViewTabsProps) {
  return (
    <div className="flex items-center gap-1 h-9 px-3 border-b border-border bg-background">
      {views.map((v) => {
        const Icon = viewIcon[v.type];
        const isCurrent = v.id === currentViewId;
        return (
          <button
            key={v.id}
            onClick={() => onSelect(v.id)}
            className={cn(
              'inline-flex items-center gap-1.5 h-7 px-2 rounded text-xs',
              isCurrent
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
            )}
          >
            <Icon className="size-3.5" />
            {v.name}
          </button>
        );
      })}
      {onCreate && (
        <button
          onClick={onCreate}
          className="ml-1 size-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted"
          title="new view"
        >
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 写 `filter-bar.tsx`**

```tsx
// apps/web/src/components/filter-bar.tsx
'use client';

import { Filter, ArrowUpDown } from 'lucide-react';
import { FilterChip } from './chip';

export type ActiveFilter = {
  id: string;
  field: string;
  op: string;
  value: string;
};

export function FilterBar({
  filters,
  sorts,
  onRemoveFilter,
  onOpenFilterBuilder,
}: {
  filters: ActiveFilter[];
  sorts?: { field: string; direction: 'asc' | 'desc' }[];
  onRemoveFilter?: (id: string) => void;
  onOpenFilterBuilder?: () => void;
}) {
  if (filters.length === 0 && (!sorts || sorts.length === 0)) {
    return (
      <div className="flex items-center gap-2 h-7 px-3 text-[11px] text-muted-foreground/70 font-mono border-b border-border">
        <button
          onClick={onOpenFilterBuilder}
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <Filter className="size-3" /> filter
        </button>
        <span>·</span>
        <button className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowUpDown className="size-3" /> sort
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 h-7 px-3 border-b border-border overflow-x-auto">
      {filters.map((f) => (
        <FilterChip
          key={f.id}
          field={f.field}
          op={f.op}
          value={f.value}
          onRemove={() => onRemoveFilter?.(f.id)}
        />
      ))}
      {sorts?.map((s, i) => (
        <span
          key={i}
          className="inline-flex items-center h-[26px] gap-1 px-2 rounded border border-foreground/20 text-[11px] font-mono"
        >
          <ArrowUpDown className="size-3" />
          {s.field} {s.direction === 'asc' ? '↑' : '↓'}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 重写 grid editor 外壳**

读现有 `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`。**保留**所有数据加载逻辑（trpc.useQuery、realtime 订阅、写入 mutation）。**替换**JSX 结构如下（伪代码，根据现有变量名映射）：

```tsx
// apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx
'use client';

// ... 原有 imports
import { ViewTabs } from '@/components/view-tabs';
import { FilterBar } from '@/components/filter-bar';
import { useBreadcrumbSetter } from '@/lib/breadcrumb-context';

export function GridEditor({ baseId, tableId }: { baseId: string; tableId: string }) {
  // ... 原有数据 hooks（fields, records, views, ...）

  useBreadcrumbSetter([
    { label: 'Workspace', href: '/bases' },
    { label: baseName ?? 'Base', href: `/bases/${baseId}/settings` },
    { label: tableName ?? 'Table' },
    { label: currentViewName ?? 'view' },
  ]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ViewTabs
        views={views}
        currentViewId={currentViewId}
        onSelect={(id) => setCurrentViewId(id)}
      />
      <FilterBar
        filters={activeFilters}
        sorts={activeSorts}
        onRemoveFilter={removeFilter}
      />
      <div className="flex-1 overflow-auto">
        {/* Phase 5.2 / 5.3 / 5.4 / 5.5 在此填 grid 主体 */}
        <div className="p-6 text-xs text-muted-foreground font-mono">
          grid skeleton placeholder
        </div>
      </div>
    </div>
  );
}
```

> 注意：现有 grid-editor.tsx 596 行的实现，**保留所有**已有的 trpc 调用、realtime 订阅、mutation、状态变量。**只替换** `return (...)` 的 JSX 结构。如果原文件含 inline cell 渲染，**全部删掉**，留 placeholder。下一 task 重建。

- [ ] **Step 5: 修改 `[tableId]/page.tsx` 数据加载**

读现有 page.tsx，确保它把 base / table 元信息传给 `<GridEditor>`。若已有 client-side data hooks，page 只做 auth 校验 + 渲染 GridEditor。

```tsx
// apps/web/src/app/bases/[baseId]/tables/[tableId]/page.tsx
import { GridEditor } from './grid-editor';
import { auth } from '@/server/auth';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

export default async function TablePage({
  params,
}: {
  params: Promise<{ baseId: string; tableId: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect('/login');
  const { baseId, tableId } = await params;
  return <GridEditor baseId={baseId} tableId={tableId} />;
}
```

- [ ] **Step 6: typecheck + lint + 浏览器验证**

```bash
pnpm typecheck && pnpm lint && ./dev.sh
```
验收：访问某 table，看到 view tabs + filter bar + placeholder 文字。**没有 cell**。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/chip.tsx apps/web/src/components/view-tabs.tsx apps/web/src/components/filter-bar.tsx apps/web/src/app/bases/\[baseId\]/tables/\[tableId\]/
git commit -m "feat(grid): view tabs + filter bar + chip 系统 + grid 外壳

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5.2: 列头 + 行号 + ghost cell + 静态 grid 渲染

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`

- [ ] **Step 1: 在 grid-editor.tsx 实现只读 grid**

替换上一 task 的 placeholder `<div>`：

```tsx
// 在 GridEditor 内 JSX 的 grid 主体处：
const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 36;
const ROW_NUMBER_WIDTH = 48;

return (
  <div className="flex-1 flex flex-col min-h-0">
    <ViewTabs ... />
    <FilterBar ... />
    <div className="flex-1 overflow-auto">
      <table className="markpocket-grid min-w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-background">
          <tr>
            <th
              className="sticky left-0 z-20 bg-background border-r border-b border-border"
              style={{ height: HEADER_HEIGHT, width: ROW_NUMBER_WIDTH }}
            />
            {fields.map((f) => (
              <th
                key={f.id}
                className="text-left border-r border-b border-border px-2.5 py-1 min-w-[120px]"
                style={{ height: HEADER_HEIGHT }}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[12px] font-medium truncate">{f.name}</span>
                  {f.sortState && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {f.sortState === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
                <div className="text-[10px] font-mono text-muted-foreground mt-0.5 flex items-center gap-1">
                  {f.type === 'expression' ? (
                    <ExpressionHeader expr={f.expression} />
                  ) : (
                    <>
                      <span className={cn('size-1 rounded-full', fieldTintClass[f.type as FieldType])} />
                      <span>{f.type}</span>
                    </>
                  )}
                </div>
              </th>
            ))}
            <th
              className="w-8 border-b border-border bg-background hover:bg-muted cursor-pointer"
              style={{ height: HEADER_HEIGHT }}
            >
              <button className="size-full flex items-center justify-center text-muted-foreground hover:text-foreground">
                +
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, rowIdx) => (
            <tr key={r.id} className="hover:bg-muted/30 group">
              <td
                className="sticky left-0 z-10 bg-background group-hover:bg-muted/30 border-r border-b border-border text-right pr-2 text-[10px] font-mono text-muted-foreground"
                style={{ height: ROW_HEIGHT, width: ROW_NUMBER_WIDTH }}
              >
                {rowIdx + 1}
              </td>
              {fields.map((f) => {
                const cell = r.cells[f.id];
                return (
                  <td
                    key={f.id}
                    className="border-r border-b border-border px-2.5 py-1 text-[12px] align-top"
                    style={{ height: ROW_HEIGHT }}
                  >
                    {/* Phase 5.3 / 5.4 在此替换为 CellRenderer */}
                    <CellStatic value={cell?.value} type={f.type} />
                  </td>
                );
              })}
              <td className="border-b border-border" style={{ height: ROW_HEIGHT }} />
            </tr>
          ))}
          {/* ghost new row */}
          <tr className="border-b border-dashed border-border/80">
            <td
              className="sticky left-0 bg-background border-r border-dashed border-border/80 text-center text-muted-foreground"
              style={{ height: ROW_HEIGHT, width: ROW_NUMBER_WIDTH }}
            >
              +
            </td>
            {fields.map((f) => (
              <td
                key={f.id}
                className="border-r border-dashed border-border/80"
                style={{ height: ROW_HEIGHT }}
              />
            ))}
            <td style={{ height: ROW_HEIGHT }} />
          </tr>
        </tbody>
      </table>
    </div>
  </div>
);

// 占位静态 cell（下一 task 替换）
function CellStatic({ value, type }: { value: unknown; type: string }) {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground/40">—</span>;
  return <span className="truncate block max-w-[200px]">{String(value)}</span>;
}

function ExpressionHeader({ expr }: { expr: string }) {
  // expr 是序列化好的 token 数组（field_id refs），渲染为 FieldRefChip 序列
  // 占位：直接展示 expr 字符串
  return <span className="truncate">{expr}</span>;
}
```

- [ ] **Step 2: typecheck + lint + 浏览器验证**

```bash
pnpm typecheck && pnpm lint && ./dev.sh
```
验收：grid 显示表头（两行）、行号、空值占位 `—`、最后一行虚线 ghost。**还是文本占位**，没有真 cell renderer。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/bases/\[baseId\]/tables/\[tableId\]/grid-editor.tsx
git commit -m "feat(grid): 列头 + 行号 + ghost row（静态渲染）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5.3: 11 种 cell renderer

**Files:**
- Create: `apps/web/src/components/cell-renderers.tsx`
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`

- [ ] **Step 1: 写 `cell-renderers.tsx`（11 种 + 调度器）**

```tsx
// apps/web/src/components/cell-renderers.tsx
import { cn } from '@/lib/cn';
import { Check, Paperclip } from 'lucide-react';
import { FieldRefChip, MultiSelectChip, StatusDot, type FieldType } from './chip';

export type CellValue =
  | string
  | number
  | boolean
  | { id: string; label: string } // single-select option
  | { id: string; label: string }[] // multi-select
  | { date: string } // ISO date
  | { url: string; name: string; thumbUrl?: string } // attachment (single)
  | { url: string; name: string; thumbUrl?: string }[] // attachments
  | { id: string; name: string; avatarUrl?: string | null } // user
  | { recordId: string; label: string } // link
  | null;

export function CellRenderer({ value, type }: { value: CellValue; type: FieldType }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground/40">—</span>;
  }

  switch (type) {
    case 'text':
      return <span className="truncate block max-w-[300px]">{String(value)}</span>;

    case 'long-text': {
      const text = String(value);
      return (
        <span className="flex items-center gap-1 truncate">
          <span className="truncate block max-w-[280px]">{text}</span>
          {text.length > 40 && <span className="text-muted-foreground">⟼</span>}
        </span>
      );
    }

    case 'number': {
      const n = Number(value);
      return (
        <span
          className={cn(
            'block text-right font-mono tabular-nums',
            n < 0 && 'text-destructive'
          )}
        >
          {Number.isFinite(n) ? n.toLocaleString('en-US') : String(value)}
        </span>
      );
    }

    case 'boolean':
      return value ? (
        <Check className="size-3.5 text-foreground" strokeWidth={3} />
      ) : (
        <span className="text-muted-foreground/40">—</span>
      );

    case 'date': {
      const iso = typeof value === 'object' && value && 'date' in value ? value.date : String(value);
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return <span className="text-muted-foreground">{String(value)}</span>;
      const today = new Date();
      const isToday = d.toDateString() === today.toDateString();
      const yest = new Date(today);
      yest.setDate(yest.getDate() - 1);
      const isYest = d.toDateString() === yest.toDateString();
      const label = isToday ? 'today' : isYest ? 'yesterday' : iso.slice(0, 10);
      return <span className={cn('font-mono', (isToday || isYest) && 'text-muted-foreground')}>{label}</span>;
    }

    case 'single-select': {
      const opt = value as { id: string; label: string };
      return <StatusDot label={opt.label} type="single-select" />;
    }

    case 'multi-select': {
      const opts = value as { id: string; label: string }[];
      const visible = opts.slice(0, 2);
      const overflow = opts.length - visible.length;
      return (
        <span className="flex items-center gap-1">
          {visible.map((o) => (
            <MultiSelectChip key={o.id} label={o.label} />
          ))}
          {overflow > 0 && <span className="text-[10px] text-muted-foreground font-mono">+{overflow}</span>}
        </span>
      );
    }

    case 'attachment': {
      const files = Array.isArray(value) ? value : [value];
      const visible = files.slice(0, 2);
      const overflow = files.length - visible.length;
      return (
        <span className="flex items-center gap-1">
          {visible.map((f, i) => (
            <span
              key={i}
              className="inline-block size-6 rounded bg-muted overflow-hidden ring-1 ring-border relative"
              style={{ marginLeft: i > 0 ? -8 : 0 }}
            >
              {f.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.thumbUrl} alt={f.name} className="size-full object-cover" />
              ) : (
                <Paperclip className="size-3 text-muted-foreground m-auto mt-1.5" />
              )}
            </span>
          ))}
          {overflow > 0 && <span className="text-[10px] text-muted-foreground font-mono">+{overflow}</span>}
        </span>
      );
    }

    case 'user': {
      const u = value as { id: string; name: string; avatarUrl?: string | null };
      const initials = u.name.split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('');
      return (
        <span className="flex items-center gap-1.5">
          <span className="size-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-mono overflow-hidden">
            {u.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={u.avatarUrl} alt={u.name} className="size-full object-cover" />
            ) : (
              initials
            )}
          </span>
          <span className="truncate">{u.name}</span>
        </span>
      );
    }

    case 'link': {
      const ref = value as { recordId: string; label: string };
      return (
        <span className="text-foreground hover:underline cursor-pointer truncate">
          {ref.label}
        </span>
      );
    }

    case 'expression': {
      // materialized 值，按 scalar 简单渲染，左 2px ink 竖条
      const text = (() => {
        if (typeof value === 'number') return value.toLocaleString('en-US');
        if (typeof value === 'boolean') return value ? '✓' : '';
        if (typeof value === 'string') return value;
        return JSON.stringify(value);
      })();
      return (
        <span className="block pl-1.5 border-l-2 border-foreground/60 font-mono tabular-nums">
          {text || <span className="text-muted-foreground/40">—</span>}
        </span>
      );
    }

    default:
      return <span className="text-muted-foreground">{JSON.stringify(value)}</span>;
  }
}
```

- [ ] **Step 2: 在 grid-editor.tsx 替换 `CellStatic` 调用为 `<CellRenderer>`**

```tsx
// grid-editor.tsx import
import { CellRenderer } from '@/components/cell-renderers';

// JSX 中：
<td key={f.id} ...>
  <CellRenderer value={cell?.value as CellValue} type={f.type as FieldType} />
</td>

// 删掉本文件内的 CellStatic 函数
```

- [ ] **Step 3: typecheck + lint + 浏览器验证**

```bash
pnpm typecheck && pnpm lint && ./dev.sh
```
验收：每种字段类型显示对应形态。**测试不出错**：DB 里建一个含每种字段类型的 table，肉眼看渲染对。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/cell-renderers.tsx apps/web/src/app/bases/\[baseId\]/tables/\[tableId\]/grid-editor.tsx
git commit -m "feat(grid): 11 种字段类型 cell renderer

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5.4: inline 编辑 + 键盘导航

**Files:**
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`
- Create: `apps/web/src/lib/use-grid-keyboard.ts`

- [ ] **Step 1: 写 `use-grid-keyboard.ts`**

```ts
// apps/web/src/lib/use-grid-keyboard.ts
'use client';
import { useEffect, useState, useCallback } from 'react';

export type Cursor = { row: number; col: number } | null;

export function useGridKeyboard(rowCount: number, colCount: number) {
  const [cursor, setCursor] = useState<Cursor>(null);
  const [editing, setEditing] = useState(false);

  const move = useCallback(
    (dr: number, dc: number) => {
      setCursor((c) => {
        if (!c) return { row: 0, col: 0 };
        return {
          row: Math.max(0, Math.min(rowCount - 1, c.row + dr)),
          col: Math.max(0, Math.min(colCount - 1, c.col + dc)),
        };
      });
    },
    [rowCount, colCount]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editing) {
        if (e.key === 'Escape') setEditing(false);
        if (e.key === 'Enter') {
          setEditing(false);
          move(1, 0);
          e.preventDefault();
        }
        if (e.key === 'Tab') {
          setEditing(false);
          move(0, e.shiftKey ? -1 : 1);
          e.preventDefault();
        }
        return;
      }
      if (!cursor) return;
      switch (e.key) {
        case 'ArrowUp':
          move(-1, 0);
          e.preventDefault();
          break;
        case 'ArrowDown':
        case 'Enter':
          move(1, 0);
          e.preventDefault();
          break;
        case 'ArrowLeft':
          move(0, -1);
          e.preventDefault();
          break;
        case 'ArrowRight':
        case 'Tab':
          move(0, 1);
          e.preventDefault();
          break;
        case 'Backspace':
        case 'Delete':
          // dispatch clear event, handled in component
          window.dispatchEvent(new CustomEvent('mp:clear-cell', { detail: cursor }));
          e.preventDefault();
          break;
        default:
          // 可见字符 → 进入编辑
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            setEditing(true);
          }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursor, editing, move]);

  return { cursor, setCursor, editing, setEditing };
}
```

- [ ] **Step 2: 在 grid-editor.tsx 接入**

```tsx
// grid-editor.tsx
import { useGridKeyboard } from '@/lib/use-grid-keyboard';

// 在组件内：
const { cursor, setCursor, editing, setEditing } = useGridKeyboard(records.length, fields.length);

// 监听 clear 事件
useEffect(() => {
  function onClear(e: Event) {
    const { row, col } = (e as CustomEvent).detail;
    const record = records[row];
    const field = fields[col];
    if (record && field) {
      updateCell.mutate({ recordId: record.id, fieldId: field.id, value: null });
    }
  }
  window.addEventListener('mp:clear-cell', onClear);
  return () => window.removeEventListener('mp:clear-cell', onClear);
}, [records, fields, updateCell]);

// 在 td 上：
const isCursor = cursor?.row === rowIdx && cursor?.col === colIdx;
const isEditing = isCursor && editing;

<td
  key={f.id}
  className={cn(
    'border-r border-b border-border px-2.5 py-1 text-[12px] align-top relative',
    isCursor && 'ring-2 ring-foreground ring-inset'
  )}
  style={{ height: ROW_HEIGHT }}
  onClick={() => setCursor({ row: rowIdx, col: colIdx })}
  onDoubleClick={() => {
    setCursor({ row: rowIdx, col: colIdx });
    setEditing(true);
  }}
>
  {isEditing && f.type !== 'expression' ? (
    <CellEditor
      value={cell?.value}
      type={f.type}
      onSubmit={(v) => {
        updateCell.mutate({ recordId: r.id, fieldId: f.id, value: v });
        setEditing(false);
      }}
      onCancel={() => setEditing(false)}
    />
  ) : (
    <CellRenderer value={cell?.value as CellValue} type={f.type as FieldType} />
  )}
</td>
```

```tsx
// grid-editor.tsx 底部加：
function CellEditor({
  value,
  type,
  onSubmit,
  onCancel,
}: {
  value: unknown;
  type: string;
  onSubmit: (v: unknown) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(typeof value === 'string' || typeof value === 'number' ? String(value) : '');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (type === 'boolean') {
    return (
      <select
        autoFocus
        value={value === true ? 'true' : value === false ? 'false' : ''}
        onChange={(e) => onSubmit(e.target.value === 'true')}
        onBlur={onCancel}
        className="w-full h-full bg-background text-[12px] outline-none"
      >
        <option value="">—</option>
        <option value="true">✓</option>
      </select>
    );
  }

  if (type === 'number') {
    return (
      <input
        ref={ref}
        type="number"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onSubmit(v === '' ? null : Number(v))}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        className="w-full h-full bg-background text-right font-mono text-[12px] outline-none"
      />
    );
  }

  // 默认 text / long-text / date / select.label fallback
  return (
    <input
      ref={ref}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onSubmit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
      className="w-full h-full bg-background text-[12px] outline-none"
    />
  );
}
```

- [ ] **Step 3: typecheck + lint + 浏览器验证**

```bash
pnpm typecheck && pnpm lint && ./dev.sh
```
验收：
- 单击 cell → 选中（描边）
- 双击 cell → 进入编辑
- 键盘 `↑↓←→` 移动选中
- `Enter` 进入编辑 / 下一行
- `Esc` 取消编辑
- `Tab` / `Shift+Tab` 横向跳
- `Backspace` 清空 cell
- expression 列**不**可编辑（只读）

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/use-grid-keyboard.ts apps/web/src/app/bases/\[baseId\]/tables/\[tableId\]/grid-editor.tsx
git commit -m "feat(grid): inline 编辑 + 键盘导航

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5.5: cell 历史 dock

**Files:**
- Create: `apps/web/src/components/cell-history-dock.tsx`
- Modify: `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx`

- [ ] **Step 1: 写 `cell-history-dock.tsx`**

```tsx
// apps/web/src/components/cell-history-dock.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/server/trpc/client';
import { X, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/cn';

export type HistoryEntry = {
  id: string;
  createdAt: number;
  userName: string;
  oldValue: unknown;
  newValue: unknown;
};

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function fmtAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function CellHistoryDock({
  baseId,
  tableId,
  fieldId,
  recordId,
  canRestore = false,
  onClose,
}: {
  baseId: string;
  tableId: string;
  fieldId: string;
  recordId: string;
  canRestore?: boolean;
  onClose: () => void;
}) {
  const { data: history } = useQuery(
    trpc.cellHistory.list.queryOptions({ baseId, tableId, fieldId, recordId })
  );

  return (
    <aside className="w-[280px] shrink-0 border-l border-border bg-background flex flex-col">
      <header className="h-9 flex items-center justify-between px-3 border-b border-border">
        <span className="text-[11px] font-mono text-muted-foreground">cell history</span>
        <button
          onClick={onClose}
          className="size-5 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
        >
          <X className="size-3" />
        </button>
      </header>
      <div className="px-3 py-2 border-b border-border">
        <div className="text-[10px] font-mono text-muted-foreground">
          {fieldId.slice(0, 8)} · {recordId.slice(0, 8)}
        </div>
        <div className="text-sm mt-0.5 truncate">
          {history && history[0] ? fmtValue(history[0].newValue) : '—'}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {(history ?? []).map((h, i) => (
          <div
            key={h.id}
            className={cn(
              'px-3 py-2 border-b border-border text-[11px]',
              i === 0 && 'bg-muted/40'
            )}
          >
            <div className="flex items-center justify-between mb-0.5">
              <span className="font-mono text-muted-foreground">@{h.userName}</span>
              <span className="font-mono text-muted-foreground/70">{fmtAgo(h.createdAt)}</span>
            </div>
            <div className="font-mono truncate">
              <span className="text-muted-foreground">{fmtValue(h.oldValue)}</span>
              <span className="mx-1 text-muted-foreground/60">→</span>
              <span>{fmtValue(h.newValue)}</span>
            </div>
          </div>
        ))}
      </div>
      {canRestore && history && history.length > 1 && (
        <footer className="p-2 border-t border-border">
          <button className="w-full h-7 text-xs inline-flex items-center justify-center gap-1 rounded border border-input hover:bg-muted">
            <RotateCcw className="size-3" />
            restore previous value
          </button>
        </footer>
      )}
    </aside>
  );
}
```

> **若 `trpc.cellHistory.list` 不存在**：本 task 范围内创建。读 `apps/web/src/server/trpc/router/` 找到现有 router（例如 `cell.ts` 或 `history.ts`，按现有命名），加 `list` procedure：input `{ baseId, tableId, fieldId, recordId }` zod schema，output `HistoryEntry[]`，从 `cell_history` 表查 `where fieldId=? and recordId=? order by created_at desc limit 50`。同时加 `restore` mutation：input `{ entryId }`，写入新 cell 值 = 旧 entry 的 `oldValue`，再 append 一条 history。

- [ ] **Step 2: 在 grid-editor.tsx 接入 dock**

```tsx
// grid-editor.tsx 顶部 import
import { CellHistoryDock } from '@/components/cell-history-dock';

// 组件内：选中 cell 时显示
const showDock = cursor && records[cursor.row] && fields[cursor.col];

// 主 JSX 改为：
return (
  <div className="flex-1 flex flex-col min-h-0">
    <ViewTabs ... />
    <FilterBar ... />
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 overflow-auto">
        {/* table 主体（Task 5.2/5.3/5.4 已写） */}
      </div>
      {showDock && (
        <CellHistoryDock
          baseId={baseId}
          tableId={tableId}
          fieldId={fields[cursor!.col].id}
          recordId={records[cursor!.row].id}
          canRestore={canEdit}
          onClose={() => setCursor(null)}
        />
      )}
    </div>
  </div>
);
```

- [ ] **Step 3: typecheck + lint + 浏览器验证**

```bash
pnpm typecheck && pnpm lint && ./dev.sh
```
验收：
- 选中 cell → 右侧 dock 滑入 280px
- 显示当前值 + 历史时间线
- Esc 关闭 dock（cursor → null）
- 改一个 cell → dock 出现新一条

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/cell-history-dock.tsx apps/web/src/app/bases/\[baseId\]/tables/\[tableId\]/grid-editor.tsx
git commit -m "feat(grid): cell 历史 dock

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 6 · 公开分享页（0.5 day）

### Task 6.1: `/share/[token]` 页

**Files:**
- Create: `apps/web/src/app/share/[token]/page.tsx`

- [ ] **Step 1: 写 share 页**

```tsx
// apps/web/src/app/share/[token]/page.tsx
import { db } from '@/server/db';
import { shares } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { ShareGrid } from './share-grid';

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = await db.query.shares.findFirst({
    where: eq(shares.token, token),
  });
  if (!share || share.revoked) notFound();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-8 flex items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">markpocket</span>
          <span className="text-[10px] font-mono text-muted-foreground uppercase">public</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/export?share=${share.token}`}
            className="h-6 px-2 inline-flex items-center text-[11px] rounded border border-input hover:bg-muted"
          >
            export csv
          </a>
        </div>
      </header>
      <div className="px-4 py-3 border-b border-border">
        <h1 className="text-base font-semibold">{share.title ?? 'Shared view'}</h1>
        {share.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{share.description}</p>
        )}
        <p className="text-[10px] font-mono text-muted-foreground mt-1.5">
          Read-only · powered by markpocket
        </p>
      </div>
      <ShareGrid share={share} />
      <footer className="border-t border-border py-2 text-center">
        <span className="text-[10px] text-muted-foreground/60 font-mono">
          powered by markpocket
        </span>
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: 写 `share-grid.tsx`**

```tsx
// apps/web/src/app/share/[token]/share-grid.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/server/trpc/client';
import { CellRenderer } from '@/components/cell-renderers';
import { ViewTabs } from '@/components/view-tabs';

export function ShareGrid({ share }: { share: { id: string; tableId: string; baseId: string; allViews: boolean } }) {
  const { data: table } = useQuery(
    trpc.share.getTable.queryOptions({ shareId: share.id })
  );
  if (!table) return <div className="flex-1 p-6 text-xs font-mono text-muted-foreground">Loading...</div>;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {share.allViews && (
        <ViewTabs
          views={table.views}
          currentViewId={table.defaultViewId}
          onSelect={() => {}}
        />
      )}
      <div className="flex-1 overflow-auto">
        <table className="markpocket-grid min-w-full text-sm">
          <thead className="sticky top-0 bg-background border-b border-border">
            <tr>
              {table.fields.map((f) => (
                <th key={f.id} className="text-left px-2.5 py-1.5 border-r border-border min-w-[120px]">
                  <div className="text-[12px] font-medium">{f.name}</div>
                  <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{f.type}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.records.map((r) => (
              <tr key={r.id} className="border-b border-border">
                {table.fields.map((f) => (
                  <td key={f.id} className="px-2.5 py-1 border-r border-border text-[12px] align-top">
                    <CellRenderer value={(r.cells as any)[f.id]} type={f.type} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: typecheck + lint + 浏览器验证**

```bash
pnpm typecheck && pnpm lint && ./dev.sh
```
验收：
- 创建一个 share token，访问 `/share/<token>`
- 显示极简顶条 + grid（只读）
- 无 sidebar、无 statusbar、无 history dock
- export csv 按钮可下载

> **若 `trpc.share.getTable` 不存在**：本 task 范围内创建。读 `apps/web/src/server/trpc/router/`，找到 share 相关 router（或新建 `share.ts`），加 `getTable` procedure：input `{ shareId }`，校验 share 未 revoke 且未过期，output `{ fields, records, views, defaultViewId }`。复用现有 `table.get` 内部实现（若已有），只加 share 校验层。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/share/
git commit -m "feat(share): 公开分享页（只读 grid · 极简 shell）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 7 · 收尾（0.5 day）

### Task 7.1: 404 / 500 / loading + Toaster + 命令面板占位

**Files:**
- Create: `apps/web/src/app/not-found.tsx`
- Create: `apps/web/src/app/error.tsx`
- Create: `apps/web/src/app/loading.tsx`
- Create: `apps/web/src/components/loading-bar.tsx`
- Create: `apps/web/src/components/toaster.tsx`
- Create: `apps/web/src/components/command-palette.tsx`
- Modify: `apps/web/src/app/layout.tsx`

- [ ] **Step 1: 写 404**

```tsx
// apps/web/src/app/not-found.tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <Link href="/bases" className="mt-3 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
        ← back to workspace
      </Link>
    </main>
  );
}
```

- [ ] **Step 2: 写 500**

```tsx
// apps/web/src/app/error.tsx
'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center">
      <h1 className="text-lg font-semibold">Something broke</h1>
      {error.digest && (
        <p className="mt-2 text-[10px] font-mono text-muted-foreground">{error.digest}</p>
      )}
      <button
        onClick={reset}
        className="mt-4 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90"
      >
        retry
      </button>
    </main>
  );
}
```

- [ ] **Step 3: 写 loading**

```tsx
// apps/web/src/app/loading.tsx
import { LoadingBar } from '@/components/loading-bar';

export default function Loading() {
  return (
    <div className="h-screen">
      <LoadingBar />
    </div>
  );
}
```

- [ ] **Step 4: 写 `loading-bar.tsx`**

```tsx
// apps/web/src/components/loading-bar.tsx
export function LoadingBar() {
  return (
    <div className="fixed top-10 left-0 right-0 h-px overflow-hidden z-50">
      <div className="h-full bg-foreground mp-loading-bar" />
    </div>
  );
}
```

- [ ] **Step 5: 写 `toaster.tsx`**

```tsx
// apps/web/src/components/toaster.tsx
'use client';

import { create } from 'zustand';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

type Toast = { id: string; message: string };
type ToastStore = { toasts: Toast[]; push: (m: string) => void; remove: (id: string) => void };

export const useToast = create<ToastStore>((set) => ({
  toasts: [],
  push: (m) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, message: m }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function Toaster() {
  const { toasts, remove } = useToast();
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onMouseEnter={() => {}}
          className="w-[320px] h-12 px-3 flex items-center gap-2 rounded border border-border bg-card shadow-sm text-sm"
        >
          <Check className="size-4 text-online" />
          <span className="flex-1 truncate">{t.message}</span>
          <button onClick={() => remove(t.id)} className="text-xs text-muted-foreground hover:text-foreground">×</button>
        </div>
      ))}
    </div>
  );
}
```

> 需要 `pnpm --filter @markpocket/web add zustand`。

- [ ] **Step 6: 写 `command-palette.tsx`（Phase 2 占位）**

```tsx
// apps/web/src/components/command-palette.tsx
'use client';

import { useEffect, useState } from 'react';
import { Command } from 'cmdk';

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        // sidebar toggle handled elsewhere; this is just a hint listener
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-foreground/20"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[560px] max-w-[90vw] rounded-md border border-border bg-popover shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <div className="border-b border-border px-3">
            <Command.Input
              autoFocus
              placeholder="Search bases, tables, views..."
              className="w-full h-10 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Command.List className="max-h-[320px] overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-xs text-muted-foreground font-mono">
              Search ready · full index in v2
            </Command.Empty>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: 修改 `apps/web/src/app/layout.tsx` 接入 Toaster + CommandPalette**

```tsx
// apps/web/src/app/layout.tsx
import type { Metadata } from 'next';
import '@/app/globals.css';
import { Toaster } from '@/components/toaster';
import { CommandPalette } from '@/components/command-palette';

export const metadata: Metadata = {
  title: 'markpocket',
  description: 'the airtable you own',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
        <Toaster />
        <CommandPalette />
      </body>
    </html>
  );
}
```

- [ ] **Step 8: 装 zustand**

```bash
pnpm --filter @markpocket/web add zustand
```

- [ ] **Step 9: typecheck + lint + 浏览器验证**

```bash
pnpm typecheck && pnpm lint && ./dev.sh
```
验收：
- 访问不存在路径 → 404 居中
- 触发异常 → 500 居中带 retry
- 路由切换 → 顶部 1px 进度条
- 任何 mutation 成功后 → 右下 toast
- ⌘K → 命令面板弹出，输入字符无结果但占位文字对

- [ ] **Step 10: 截图存档**

```bash
mkdir -p docs/screenshots
# 用 Playwright MCP 或浏览器手动截图，覆盖 6 个页面 + 命令面板
```

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/app/not-found.tsx apps/web/src/app/error.tsx apps/web/src/app/loading.tsx apps/web/src/components/ apps/web/src/app/layout.tsx apps/web/package.json pnpm-lock.yaml docs/screenshots/
git commit -m "feat: 收尾 — 404/500/loading + Toaster + ⌘K 占位

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 验收清单（全部 phase 跑完后）

- [ ] 6 个页面（login / register / bases / base settings / grid / share）视觉对得上 spec
- [ ] 墨黑是唯一品牌色，颜色仅出现在 destructive / field-type / online 三类
- [ ] 行高 32px，cell padding 4×10
- [ ] chip 是描边不填充，类型色仅落在 dot
- [ ] sidebar 折叠状态持久化（localStorage）
- [ ] grid 全键盘可用：↑↓←→ / Enter / Esc / Tab / Backspace / ⌘C/V
- [ ] cell 历史 dock 选中即开，Esc 关
- [ ] ⌘K 弹命令面板（占位即可）
- [ ] toast 只在操作成功时出现
- [ ] mobile < 1024px 自动折叠 sidebar，< 768px 显示 "best on desktop"
- [ ] `pnpm typecheck` + `pnpm lint` 全过
- [ ] `docs/screenshots/` 6 张截图存档
