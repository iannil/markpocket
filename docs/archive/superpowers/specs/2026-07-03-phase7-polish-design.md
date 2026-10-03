# Phase 7 — Paper & Ink 收尾设计

> **日期**：2026-07-03
> **范围**：Paper & Ink 重设计最后一个 Phase（收尾/polish）。三块：错误/加载页、Toast 系统、⌘K 命令面板占位。
> **参考**：`docs/redesign/2026-07-01-paper-ink-design.md` §6.6（404/500/loading）、§7（Toast、⌘K）。
> **原则**：不改后端。自造最小 Toast（无新依赖）。命令面板复用已装 `cmdk`（`ui/command.tsx`）。

---

## 1. 目标与非目标

**目标**：补齐 v1 缺失的错误/加载页、全局 Toast 提示、⌘K 命令面板入口，全部 Paper & Ink。

**非目标（本 spec 不做）**：
- 命令面板的真实模糊搜索（record/表内容搜索）——本 Phase 只做占位导航命令
- 把所有 mutation 改用 toast——只接 2–3 个代表性 call site 作演示，其余后续增量采用
- `global-error.tsx`（根 layout 崩溃兜底）——`error.tsx` 覆盖绝大多数；YAGNI
- 公开分享页（Phase 6 已延后为独立功能）
- 任何后端 / schema 改动

---

## 2. 现状（已核实）

- **无** `app/not-found.tsx` / `app/error.tsx` / `app/loading.tsx`。
- **无 Toast 基础设施**（无 sonner 等依赖）。
- `cmdk@^1.1.1` 已装；`ui/command.tsx` 导出 `CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut, CommandSeparator`。`ui/dialog.tsx` 已有。
- Topbar 有一个**静态不可交互**的 `<kbd>`（⌘K 徽章，`title="Command palette"`），无 onClick / 无键盘处理。
- `AppShell({ bases: SidebarBase[], currentUser, onlineUsers, children })` 是客户端外壳，渲染 Topbar/Sidebar/Statusbar/children——命令面板挂这里（有 `bases` 数据）。
- 复用件：`components/empty-state.tsx`（`<EmptyState title description? action? />`）。

---

## 3. 404 / 500 / loading 页

Next App Router 约定文件，放 `apps/web/src/app/` 根级（覆盖整棵树）：

- `not-found.tsx`（server component）：居中 Paper & Ink 空态。标题 `Page not found`、描述、`← Back to bases` 链接（`/bases`）。可复用 `<EmptyState>`（EmptyState 无 'use client'，可在 server 用）。
- `error.tsx`（`'use client'`，Next 错误边界，收 `{ error: Error & {digest?}, reset: () => void }`）：`Something went wrong` + 描述 + `Try again`（调 `reset()`）+ `← Back to bases` 链接。
- `loading.tsx`：Paper & Ink 加载态——居中一个简单 pulse 骨架或细进度条（复用 globals 里已有的 loading bar 样式或 `animate-pulse bg-muted`）。

全部白底、hairline、无 shadow、`text-muted-foreground` 辅助文字。

---

## 4. Toast 系统（自造最小）

**`lib/toast.ts`** — 模块级 pub-sub（可在 React 外调用）：
```ts
export type ToastKind = 'success' | 'error' | 'info';
export interface ToastItem { id: number; kind: ToastKind; message: string; }
// 内部：listeners Set + items 数组 + emit
export function subscribeToasts(cb: (items: ToastItem[]) => void): () => void;
export function getToasts(): ToastItem[];
export const toast: {
  success(message: string): void;
  error(message: string): void;
  info(message: string): void;
};
// push 后 ~3000ms 自动移除该 id
```
用 `useSyncExternalStore(subscribeToasts, getToasts, getToasts)` 供组件订阅。

**`components/toaster.tsx`** — `<Toaster>`（`'use client'`）：订阅 store，右下角固定容器（`fixed bottom-4 right-4 z-50 flex flex-col gap-2`），每条 toast 一张 Paper & Ink 卡片（`rounded-md border border-border bg-background px-3 py-2 text-sm shadow-none`；`error` → `text-destructive` + `border-destructive/40`；带一个 × 手动关）。~3s 自动消失（store 定时移除）。

**挂载**：`app/layout.tsx` 根布局 `<body>` 内加 `<Toaster />`（全局，登录/未登录页都覆盖）。

**演示接线（2–3 处，不铺全）**：
- Settings tab 改名成功 → `toast.success('Base renamed')`。
- 删除 base 成功 → `toast.success('Base deleted')`（跳转前）。
- 一个 mutation 失败路径（如 base.create 或 table.create 的 `onError`）→ `toast.error(err.message)`。
其余 mutation 后续增量采用 `toast()`，本 Phase 不改。

---

## 5. ⌘K 命令面板占位

**`components/command-palette.tsx`**（`'use client'`）：
- props：`bases: Array<{ id: string; name: string }>`（AppShell 传入）。
- 内部 `open` 状态；全局 `keydown` 监听（`useEffect`）：`(e.metaKey || e.ctrlKey) && e.key === 'k'` → `preventDefault` + toggle open。
- 用 `CommandDialog open onOpenChange` + `CommandInput placeholder="Type a command…"` + `CommandList`：
  - `CommandGroup "Navigate"`：`Go to Bases`（→ `/bases`）、`New base`（→ `/bases/new`）。
  - `CommandGroup "Bases"`：遍历 `bases` → 每个 `CommandItem`（→ `/bases/${id}`）。
  - `CommandEmpty`：`No results.`
  - 选中命令后 `router.push(...)` 并关面板。
- **占位说明**：`CommandInput` 只做 cmdk 自带的 label 过滤（前端），不接后端搜索。

**入口接线**：
- `AppShell` 内渲染 `<CommandPalette bases={bases} />`。
- `topbar.tsx` 的 `<kbd>` 改为 `<button>`（保留同样的 Paper & Ink 徽章样式）；onClick 派发全局合成事件 `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))`。CommandPalette 的全局 keydown handler 会捕获它并打开——避免跨组件 prop 传递，复用同一入口逻辑。

---

## 6. 数据流与错误处理

- Toast 是纯前端（pub-sub store）；无查询。
- 命令面板导航用 `next/navigation` 的 `useRouter().push`。
- error.tsx 的 `reset()` 由 Next 提供，重渲染出错子树。
- 无新增校验、无后端改动。

---

## 7. 文件改动

| 文件 | 动作 |
|---|---|
| `app/not-found.tsx` | 新增 |
| `app/error.tsx` | 新增（'use client'） |
| `app/loading.tsx` | 新增 |
| `lib/toast.ts` | 新增（store + toast API） |
| `components/toaster.tsx` | 新增（'use client'） |
| `app/layout.tsx` | 改：挂 `<Toaster />` |
| `components/command-palette.tsx` | 新增（'use client'） |
| `components/app-shell.tsx` | 改：挂 `<CommandPalette bases={bases} />` |
| `components/topbar.tsx` | 改：`<kbd>` 可点击触发打开 |
| Settings/general + 一处 create 的 mutation | 改：接 2–3 处 toast 演示 |

---

## 8. 验收

- 访问不存在路由 → Paper & Ink 404，能返回 /bases。
- 子树抛错 → error.tsx 展示，Try again 可重试。
- 路由切换/数据加载时 → loading 态出现。
- 触发 `toast.success/error` → 右下角出现 Paper & Ink toast，~3s 自动消失，可手动 ×；error 红字。改名/删除/失败路径能看到 toast。
- ⌘K（或点 Topbar kbd）→ 命令面板打开，输入可过滤，选 Navigate/Bases 命令能跳转；Esc/选中后关闭。
- typecheck + lint 通过；浏览器肉眼验证。无后端改动。

---

## 9. 明确不做（见 §1）

命令面板真实搜索、全量 mutation 接 toast、global-error、公开分享页。
