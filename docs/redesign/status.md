# Paper & Ink 重设计 — 实施进度跟踪

> **最后更新**：2026-07-01
> 本文件跟踪 `docs/redesign/2026-07-01-paper-ink-plan.md` 中 8 个 Phase、16+ Tasks 的实际完成状态。
> SDD 进度参见 `.superpowers/sdd/progress.md`（逐步弃用中）。

---

## 总览

| Phase | 内容 | 工期 | 状态 | 完成 Task / 总计 Task |
|---|---|---|---|---|
| 0 | 设计 Token 落地 | 0.5d | ✅ Complete | 1/1 |
| 1 | App Shell | 1d | ✅ Complete | 9/9 |
| 2 | Login / Register 重设计 | 0.5d | ✅ Complete | 1/1 |
| 3 | Bases 列表重设计 | 0.5d | ✅ Complete | 1/1 |
| 4 | Base 详情 + Tabs | 0.5d | ✅ Complete | 1/1 |
| 5 | Grid Editor | 3d | ⏳ Not Started | 0/4 |
| 6 | 公开分享页 | 0.5d | ⏳ Not Started | 0/1 |
| 7 | 收尾 | 0.5d | ⏳ Not Started | 0/1 |
| **合计** | | **7d** | **~68%** | **13/19** |

> **最后更新**：2026-07-02。Phase 4 完成（SDD 执行，commits `4035cb0`..`a41fd66`）：Tabs 外壳 + Tables/Members/Settings 真做，History 及 邀请/base 描述/base 级时间线/导出全部 按设计留占位（缺后端）。

---

## Phase 0 · 设计 Token 落地 ✅

| Step | 说明 | 文件 | 状态 | Commit |
|---|---|---|---|---|
| 0.1 | 落地 Paper & Ink token 与字体 | `globals.css`, `layout.tsx`, `package.json` | ✅ Done | `cfa83ab`, `c7ffb39` |

**验收**：页面整体白底（Light-first），shadcn 默认按钮变墨黑底白字，typecheck + lint 通过。

---

## Phase 1 · App Shell ✅

Progress: **9/9 Tasks Complete**

### Task 1.1 — sidebar 折叠 hook + Breadcrumb ✅
- [x] `use-sidebar-collapsed.ts` — localStorage + mobile 1024px 自动折叠
- [x] `BreadcrumbContext` — provider + setter
- [x] `<Breadcrumb>` 组件

### Task 1.2 — Topbar 组件 + 在线头像堆叠 ✅
- [x] `<Topbar>` — 40px, breadcrumb + online avatars + user menu + ⌘K
- [x] `<OnlineAvatars>` — 堆叠头像 + 绿点在线

### Task 1.3 — Sidebar 组件 ✅
- [x] `<Sidebar>` — 240px 展开 / 48px icon rail 折叠
- [x] current base 高亮（2px ink 竖条 + bg-muted）

### Task 1.4 — Statusbar 组件 ✅
- [x] `<Statusbar>` — 24px, online count + saved time + LWW 冲突提示 + 键盘 hint

### Task 1.5 — AppShell 接入 bases layout ✅
- [x] `<AppShell>` — 三层 shell 容器
- [x] 替换旧 sidebar-nav

### Task 1.6 — Sidebar 接入真实 base 列表 ✅
- [x] trpc base.list 数据接入
- [x] 折叠/展开状态持久化

### Task 1.7 — Login/Register 重设计 ✅ Done
- [x] 居中卡片 360px + inline 错误（login/register 页已符合 spec）

### Task 1.8 — Bases 列表重设计 ✅ Done（`27a06c7`）
- [x] 紧凑 list 布局 + `<EmptyState>` 组件
- [x] `+ new base` → `/bases/new`（新建页，修复 sidebar 现有 404）
- 简化 meta：仅 name + `created X ago`（`base.list` 后端未返回 rowCount/members 聚合）

### Task 1.9 — Base 详情 + Tabs ⚠️ 部分（`27a06c7`）
- [x] redirect 逻辑（有 tables → 第一个 table；无则内联建表空态）
- [ ] Tables / Members / Settings / History 四个 tab 外壳（未做）

---

## Phase 2 · Login / Register ✅

| Step | 说明 | 文件 | 状态 |
|---|---|---|---|
| 2.1 | Login 页重设计 | `login/page.tsx` | ✅ Done |
| 2.2 | Register 页重设计 | `register/page.tsx` | ✅ Done |

---

## Phase 3 · Bases 列表 ✅

| Step | 说明 | 文件 | 状态 |
|---|---|---|---|
| 3.1 | Bases 列表重设计 + EmptyState | `bases/page.tsx`, `components/empty-state.tsx` | ✅ Done（`27a06c7`） |
| 3.2 | 新建 base 页（修复 sidebar 404） | `bases/new/page.tsx` | ✅ Done（`27a06c7`） |

---

## Phase 4 · Base 详情 + Tabs ✅

| Step | 说明 | 文件 | 状态 |
|---|---|---|---|
| 4.1 | Base 详情 redirect + 空态建表 | `bases/[baseId]/page.tsx` | ✅ Done（`27a06c7`） |
| 4.2 | Tabs 外壳 + Tables tab | `settings/{layout,page}.tsx`, `components/settings-tabs.tsx` | ✅ Done（`4035cb0`） |
| 4.3 | Members tab（角色矩阵 + 公开分享链接 + 邀请占位） | `settings/members/page.tsx` | ✅ Done（`55aede9`,`fc02406`） |
| 4.4 | Settings tab（重命名 + 按表导出 + 删除 base） | `settings/general/page.tsx` | ✅ Done（`3d9c89c`） |
| 4.5 | 入口（sidebar 齿轮 + 空 base 链接）+ History 占位 | `sidebar.tsx`, `settings/history/page.tsx` | ✅ Done（`f09aced`） |

> 占位（缺后端，见 spec §9）：邀请链接、base 描述、History base 级时间线、导出全部、前端角色门控。

---

## Phase 5 · Grid Editor ⏳

| Step | 说明 | 文件 | 状态 |
|---|---|---|---|
| 5.1 | ViewTabs + FilterBar + grid 外壳 | `view-tabs.tsx`, `filter-bar.tsx`, `chip.tsx`, `grid-editor.tsx` | ❌ Pending |
| 5.2 | Cell 类型渲染（11 种字段） | `cell-renderers.tsx` | ❌ Pending |
| 5.3 | Inline 编辑 + 键盘导航 | `grid-editor.tsx` | ❌ Pending |
| 5.4 | Cell 历史 dock | `cell-history-dock.tsx` | ❌ Pending |

**注意**：当前 `grid-editor.tsx`（596 行）是旧 Carbon & Citrus 风格，含完整数据加载与交互。Phase 5 需**保留数据加载逻辑**，只替换 JSX 外壳。

---

## Phase 6 · 公开分享页 ⏳

| Step | 说明 | 文件 | 状态 |
|---|---|---|---|
| 6.1 | 公开分享页重设计 | `share/[token]/page.tsx` | ❌ Pending |

---

## Phase 7 · 收尾 ⏳

| Step | 说明 | 文件 | 状态 |
|---|---|---|---|
| 7.1 | 404/500/loading 页 | `not-found.tsx`, `error.tsx`, `loading.tsx` | ❌ Pending |
| 7.2 | Toast 系统 | `toaster.tsx` | ❌ Pending |
| 7.3 | ⌘K 占位 | `command-palette.tsx` | ❌ Pending |
| 7.4 | 截图存档 | — | ❌ Pending |

---

## 已知阻塞项

1. **Grid Editor (Phase 5) 是最大工作项**：原计划 3 天，分 4 步。grid-editor.tsx 596 行包含数据/状态/交互/渲染混在一起，重构需谨慎。
2. **旧 view-config 组件未清理**：`view-tabs.tsx` / `filter-panel.tsx` / `sort-menu.tsx` 在 Phase 5 完成前仍需保留（grid-editor 依赖）。
3. **Login/Register 页有 uncommitted changes**：`f84a0da` 和 `99218a7` 两个 fix commit 涉及 login/register 调整，需确认是否与 Paper & Ink Phase 2 的设计冲突。
