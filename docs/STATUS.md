# markpocket 项目状态

> **最后更新**：2026-07-02
> 本文档是项目层面的完整状态快照，供大模型（LLM）与人类开发者使用。本文件记录的是**当前实际状态**，而非目标。

---

## 1. 项目概览

markpocket 是一个面向小团队的自托管数据库（Airtable 替代品），从 teable fork 全量重写而来。

| 维度 | 状态 |
|---|---|
| 产品定位 | 单租户自托管通用数据库（Base/Table/Field/Record/View） |
| v1 核心功能 | **✅ 全部完成**（Phase 0–7） |
| Paper & Ink 重设计 | **🔄 进行中**（Phase 0–4 ✅；Phase 5 Grid / 6 分享 / 7 收尾 未开始） |
| 技术栈 | Next.js 16 (App Router) + tRPC + Drizzle + Postgres 16 + ws |
| Dev 打包器 | **Rspack**（next-rspack）——Turbopack 有内存泄漏，见 §4.2 |
| 部署形态 | 单 Docker Compose（web + postgres）；dev 拆 `next dev` + 独立 realtime 网关 |
| 发布状态 | 未发布到 registry，无 tagged release，master 视作 unstable |

---

## 2. v1 核心功能状态（Phase 0–7）

v1 功能 Phase 已全部落地，按 git log 从旧到新排列。每一 Phase 说明其覆盖范围与实际状态。

### Phase 0 — 骨架（`bf7511d`）
**状态**: ✅ Complete
- 单仓 Monorepo（pnpm workspace + Turborepo）
- Postgres 16 + Docker Compose
- better-auth 登录注册
- tRPC + Drizzle 联通

### Phase 1 — 数据内核（`9e6d8ef`）
**状态**: ✅ Complete
- base / table / field / record CRUD
- 基础字段类型（text / number / boolean / date / select）
- 最小 Grid 页面与编辑
- 最大化复用 teable 前端参考

### Phase 2 — 视图系统（`e861958` → `128d7a8`）
**状态**: ✅ Complete
- filter / sort / group + 多视图 + 持久化
- Grid / Form / Kanban / Gallery 四种视图类型
- filter ILIKE 通配符转义安全修复

### Phase 3 — 实时（`ee1c3e0`）
**状态**: ✅ Complete
- WebSocket 网关（per-Base 频道）
- LWW 广播
- Presence（在线成员）
- 客户端缓存 invalidate-on-change

### Phase 4 — Expression Field（`78b63ac`）
**状态**: ✅ Complete
- Expression Field：写时求值 + 同 record 重算并物化
- 字段引用以 token-chip 形式
- 无跨 record 级联、无依赖图

### Phase 5a — 富字段（`eff5c50`）
**状态**: ✅ Complete
- multi-select 字段
- user 字段

### Phase 5b — 富字段续（`64ae22e`）
**状态**: ✅ Complete
- link 字段（跨表关联，单一 SoT 在 cells.value.recordId[]）
- attachment 字段 + storage adapter（本地 FS）

### Phase 6 — 历史（`2d9eb08`）
**状态**: ✅ Complete
- cell_history 追加写 + 时间轴 UI
- 安全审查修复

### Phase 7 — 收尾（`5c3b127`）
**状态**: ✅ Complete
- CSV 导入导出
- 公开分享（base_shares, read-only token）
- 权限三层角色（owner / editor / viewer）

---

## 3. Paper & Ink 重设计状态

重设计 spec 见 `docs/redesign/2026-07-01-paper-ink-design.md`，实施计划见 `docs/redesign/2026-07-01-paper-ink-plan.md`。

### Phase 0 — 设计 Token 落地（0.5d）
**状态**: ✅ Complete（commits: `cfa83ab`, `c7ffb39`）
- Paper & Ink 调色板 CSS 变量（Light-first）
- Inter Variable + JetBrains Mono Variable 字体引入
- 字段类型 muted tint（--field-*）
- 滚动条、选中、loading bar 样式
- typecheck + lint 通过

### Phase 1 — App Shell（1d）
**状态**: ✅ Complete

| Task | 状态 | Commit | 说明 |
|---|---|---|---|
| 1.1 use-sidebar-collapsed + Breadcrumb | ✅ Done | `db87f66` | hook + context + 组件 |
| 1.2 Topbar 组件 + 在线头像 | ✅ Done | `6135f43` | 40px 顶条 + online-avatars |
| 1.3 Sidebar 组件（240/48 折叠） | ✅ Done | `ae0e515` | 折叠侧栏 |
| 1.4 Statusbar 组件 | ✅ Done | `05709da` | 24px 状态条 |
| 1.5 AppShell 接入 bases layout | ✅ Done | `498aa10` | 替换旧 sidebar-nav |
| 1.6 Sidebar 接入真实 base 列表 | ✅ Done | `db7b583` | trpc 数据接入 |
| 1.7 Login/Register 重设计 | ✅ Done | `f84a0da` | 居中卡片 + inline 错误 |
| 1.8 Bases 列表重设计 | ✅ Done | `27a06c7` | list 布局 + EmptyState + `/bases/new` |
| 1.9 Base 详情 + Tabs | ⚠️ 部分 | `27a06c7` | redirect + 空态建表；Tabs 外壳未做 |

### Phase 2 — Login/Register（0.5d）
**状态**: ✅ Complete（已符合 spec）

### Phase 3 — Bases 列表（0.5d）
**状态**: ✅ Complete（`27a06c7`）——紧凑 list + EmptyState + 新建页

### Phase 4 — Base 详情 + Tabs（0.5d）
**状态**: ✅ Complete（`27a06c7`, `4035cb0`..`a41fd66`；SDD 执行）——redirect + Tabs 外壳 + Tables/Members/Settings 真做；History 及 邀请/描述/base 级时间线/导出全部 按设计留占位（缺后端）

### Phase 5 — Grid Editor（3d，分 4 个子 Task）
**状态**: ⏳ Not Started
- 5.1 ViewTabs + FilterBar + grid 外壳
- 5.2 Cell 类型渲染（11 种字段）
- 5.3 Inline 编辑 + 键盘导航
- 5.4 Cell 历史 dock

### Phase 6 — 公开分享页（0.5d）
**状态**: ⏳ Not Started

### Phase 7 — 收尾（0.5d）
**状态**: ⏳ Not Started
- 404/500/loading、Toast、⌘K 占位

### 最新 Commit（`99218a7`, `f84a0da`）
**状态**: ⚠️ Uncommitted fixes
- login/register page tsx 重设计适配（部分重构）
- bases/layout.tsx 调整
- layout.tsx 调整

---

## 4. 代码库健康状况

### 4.1 冗余 / 过期代码

| 位置 | 大小 | 说明 | 处置建议 |
|---|---|---|---|
| `archived/teable/` | 64 MB | teable 完整 fork，仅作只读参考。含大量 ARCHITECTURE.md、README。 | ✅ 正确归档，保持不动 |
| `.superpowers/sdd/` | ~184 KB | SDD 任务跟踪文件（task-*.brief.md），内容与 `docs/redesign/2026-07-01-paper-ink-plan.md` 重复。 | 🔄 可删除或精简（计划中） |
| `apps/web/src/components/view-config/` | 4 个旧组件 | `view-tabs.tsx` / `filter-panel.tsx` / `sort-menu.tsx` / `view-fields-menu.tsx` — 旧 Carbon & Citrus 时代的实现。新实现计划在 Phase 5 重建。 | ⏳ Phase 5 时替换，目前 grid-editor 仍然引用 |
| `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx` | 596 行 | 旧风格 Grid 编辑器，含完整数据加载 + 历史 cell 渲染 + inline 编辑。Phase 5 需要用新设计替换 JSX 外壳。 | ⏳ Phase 5 时重构 |
| `.next/` | 大量缓存 | Next.js 开发缓存。 | 应 `.gitignore`（已排除） |

### 4.2 已知问题

0. **Dev 服务器内存（已缓解，根因在上游）**：
   - **Turbopack（Next 16.2.x 默认）dev server 存在内存泄漏**：真实使用后即使空闲、0% CPU 仍以 ~20MB/s 线性增长（`vmmap` 确认为真实 anonymous dirty 内存），本机涨到 22GB+。属 Vercel 已知、跨版本（15.3→16.2）未修的 issue（[#93896](https://github.com/vercel/next.js/issues/93896) / [#91396](https://github.com/vercel/next.js/issues/91396) / [#93451](https://github.com/vercel/next.js/discussions/93451)），M 系列 Mac 尤甚。
   - **早期自定义服务器（`next({dev})` 内联跑编译器）不管哪种打包器都从开机泄漏 → OOM 崩溃**；worker 隔离仅 Next CLI（`next dev`）提供。
   - **当前对策**：① dev 拆两进程——`next dev` serve 页面 + 独立 `realtime-server.ts` serve `/realtime`，跨进程实时改用 **Postgres LISTEN/NOTIFY**（`publish.ts` → `subscribe.ts`）；② dev 打包器换 **Rspack**（`next-rspack`，`next.config.js` withRspack），实测空闲平稳 ~1.5GB。
   - **回退路径**：Turbopack 修复后，去掉 withRspack + 卸 next-rspack 即可回默认；或临时用 webpack（dev 脚本加 `--webpack` + 去掉 withRspack）。生产 `next({dev:false})` 不编译、不受影响。
1. **无测试框架**：项目迄今无任何自动化测试（单元/集成/E2E）。Phase 0–7 的验收"在 dev 浏览器肉眼验证"。
2. **两个 `fix` commit 未描述具体修复内容**：`99218a7` 和 `f84a0da` commit message 仅写 "fix"，缺少上下文。
3. **`packages/` 目录不存在**：迁移计划中预留的 `packages/domain` 尚未创建（v1 只有 `apps/web` 一个包，合理，但文档已过时）。
4. **无 AGENTS.md**：项目根目录缺失该文件（如无需求则忽略）。

### 4.3 已消除的风险（来自迁移计划 §15）

以下风险问题已在之前解决：
- ✅ ~~读时求值性能~~ → 改为写时物化
- ✅ ~~better-auth 与 App Router 兼容性~~ → 已查证为一等支持
- ✅ ~~Link 字段完整性~~ → 级联清空策略已落地
- ✅ ~~teable UI 复用~~ → 走品类惯例 + teable 只读参考

---

## 5. 下一步工作（按优先级）

### 🔴 P0 — Paper & Ink Phase 5（Grid Editor，最大工作项）
- 重构 `grid-editor.tsx`（596 行旧风格）：保留数据/实时/mutation，仅换 JSX 外壳
- 5.1 ViewTabs + FilterBar + grid 外壳 / 5.2 11 种 cell 渲染 / 5.3 inline 编辑 + 键盘导航 / 5.4 cell 历史 dock
- 清理旧 `view-config/` 组件
- ~~Phase 1–4（Login/Register、Bases 列表、Base 详情 + Tabs）~~ ✅

### 🟡 P1 — Phase 4 遗留占位（待后端）
- 邀请成员机制、base 描述字段、History base 级时间线 endpoint、导出全部、前端角色门控

### 🔴 P0 — Paper & Ink Phase 5（Grid Editor）
- 重构 grid-editor.tsx：用 Paper & Ink 组件替换 JSX
- 保留所有数据加载逻辑（trpc, realtime, mutation）
- 实现 11 种 cell 类型渲染
- 实现 inline 编辑 + 键盘导航
- 实现 cell 历史 dock

### 🟡 P1 — 测试基础设施
- 建立单元测试（vitest）
- 建立 E2E 测试（Playwright 已安装）

### 🟡 P1 — 文档补全
- 建立 AGENTS.md 或 CHANGELOG.md
- 统一 docs 文件夹层次结构

### 🟢 P2 — v2 候选
- Lookup / Rollup
- 多实例 Redis pubsub
- Calendar 视图
- S3 storage adapter
- i18n
- 行/字段级权限

---

## 6. 架构速查

### 核心文件索引（LLM 友好）

| 关注点 | 文件路径 |
|---|---|
| 领域术语 | `CONTEXT.md` |
| 架构决策 | `docs/adr/0001` ~ `0005` |
| 数据模型 | `apps/web/src/server/db/schema.ts` |
| tRPC 路由定义 | `apps/web/src/server/trpc/router.ts` + `routers/*.ts` |
| 业务 Feature | `apps/web/src/server/trpc/routers/*.ts` |
| 实时 WebSocket 网关 | `apps/web/src/server/realtime/gateway.ts` |
| 实时 跨进程投递（NOTIFY/LISTEN） | `apps/web/src/server/realtime/publish.ts` + `subscribe.ts` |
| Dev 独立 realtime 进程入口 | `apps/web/src/realtime-server.ts`（prod 用 `server.ts` 单进程） |
| 鉴权配置 | `apps/web/src/server/auth.ts` |
| 字段类型定义 | `apps/web/src/lib/field-types.ts` |
| 表达式求值 | `apps/web/src/lib/expression-eval.ts` |
| Expression Field | `docs/adr/0003-expression-field-not-formula-dsl.md` |
| View 查询 AST | `apps/web/src/lib/view-ast.ts` + `view-query.ts` |
| Grid 编辑器（旧） | `apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx` |
| 全局样式（新） | `apps/web/src/app/globals.css` |
| App Shell 组件 | `apps/web/src/components/app-shell.tsx` |
| Paper & Ink 设计 spec | `docs/redesign/2026-07-01-paper-ink-design.md` |
| Paper & Ink 实施计划 | `docs/redesign/2026-07-01-paper-ink-plan.md` |

### 关键设计原则

1. **Row-per-cell + JSONB**：`cells` 表每 Cell 一行，JSONB value，无动态 DDL（ADR-0001, ADR-0005）
2. **软实时 + LWW**：WebSocket 广播 + Last-Write-Wins，无 OT/CRDT（ADR-0002）
3. **Expression Field**：写时求值 + 同 record 重算 + 物化，无依赖图/跨表级联（ADR-0003）
4. **单租户自托管**：一个 Compose 服务一个团队，无 tenant_id/RLS（ADR-0004）
5. **Paper & Ink**：Light-first、墨黑主色、颜色让给数据、Hairlines 不 shadow

---

## 7. 变更记录

| 日期 | 变更内容 |
|---|---|
| 2026-07-01 | 创建 STATUS.md，记录 v1 完成 + Paper & Ink 重设计 Phase 0-1 进行中状态 |
| 2026-07-02 | Paper & Ink：Bases 列表/详情/新建页重设计（`27a06c7`，Phase 1–3 ✅、4 部分） |
| 2026-07-02 | 修复 dev 内存 OOM：dev 拆进程 + Postgres NOTIFY/LISTEN（`2b5cfc5`）；打包器 Turbopack→Rspack（`4d72162`），根因见 §4.2 |
| 2026-07-02 | Paper & Ink Phase 4 完成（SDD 执行，`4035cb0`..`a41fd66`）：Base 详情 Tabs（Tables/Members/Settings 真做，History+邀请+描述+导出全部 占位） |
