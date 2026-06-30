# markpocket 迁移方案：从 teable fork 到轻量化 TS 全栈

> 本文档是技术迁移总方案。术语定义见 `../../CONTEXT.md`。关键不可逆决策的背景论证见 `../adr/`。

## 1. 背景与目标

markpocket 当前是 teable 的 fork（`archived/teable/`，~50MB 源码）。teable 作为通用数据库平台过于复杂（双 Postgres + 动态 DDL + Prisma 双层 + 全 DSL 公式引擎 + op-log 实时 + 多租户），已无人维护。

**目标**：用一套轻量 TS 全栈从零重写 markpocket 所需的"通用数据库产品"能力，**主动砍掉所有非线性复杂度子系统**，使整个产品可由小团队长期维护。

**非目标**：不保留 teable 代码、不做数据迁移（markpocket 未上线）、不追求功能完全对齐 teable。

## 2. 决策矩阵（已确认）

| 维度 | 决策 | 替代方案（被否） |
|---|---|---|
| 起点 | 全新重写，teable 仅作参考 | 改造 teable / 渐进替换 |
| 数据迁移 | 不需要（未上线） | 双跑 / 在线迁移 |
| 产品形态 | 通用数据库产品（base/table/field/record/view） | 垂直场景 |
| 单表量级 | < 10 万行，JSON-row 存储 | 百万行 + 动态 DDL |
| 实时协作 | 软实时广播 + LWW | OT / CRDT |
| 公式 | Expression Field（库评估，无依赖图） | 全 DSL + 依赖图 |
| 视图 | Grid / Form / Kanban / Gallery | + Calendar / Gantt 等 |
| 字段类型 | 全基础类型 + Link + Expression；**Lookup/Rollup 推迟 v2** | 含 Lookup/Rollup |
| 多租户 | 单租户自托管 | SaaS / RLS |
| 鉴权 | better-auth + 密码 + 可选 OIDC | 自建 / 魔法链接 |
| 附件 | 可插拔 storage（默认本地 FS） | 强绑 S3 |
| 历史 | 字段级 Cell 历史 | 不做 / 仅记录级 |
| 导入导出 | CSV | + Excel / JSON |
| 技术栈 | Next.js (App Router) + tRPC + Drizzle + Postgres + ws | NestJS / Go / BaaS |

## 3. 目标架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│  浏览器                                                          │
│  Next.js (RSC + Client) ── tRPC client ──┐                       │
│                                  └────── WebSocket client ──┐    │
└──────────────────────────────────────────────────────────────┼──┘
                                                                │
┌───────────────────────────────────────────────────────────────┴──┐
│  单一 Next.js 进程（Node runtime）                                │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ App Router    │  │ tRPC server  │  │ WebSocket 网关          │  │
│  │ (RSC 页面)    │  │ (CRUD/查询)  │  │ (per-base 频道订阅)     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────┘  │
│         │                 │                     │                │
│         └─────────────────┴─────────────────────┘                │
│                           │                                      │
│  ┌────────────────────────▼───────────────────────────────────┐  │
│  │  领域服务层（features/）                                      │  │
│  │  base / table / field / record / view / expression /         │  │
│  │  history / attachment / share / import-export / realtime     │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │                                      │
│  ┌────────────────────────▼───────────────────────────────────┐  │
│  │  Drizzle ORM  +  better-auth  +  storage adapter            │  │
│  └────────────────────────┬───────────────────────────────────┘  │
└───────────────────────────┼──────────────────────────────────────┘
                            │
                ┌───────────▼───────────┐
                │   PostgreSQL (单实例)   │
                │   + LISTEN/NOTIFY       │
                └────────────────────────┘
```

**与 teable 架构的核心差异**：

| teable | markpocket |
|---|---|
| NestJS 后端 + Next.js 前端，两个独立服务 | 单一 Next.js 进程 |
| 双 Postgres（main + data） | 单 Postgres |
| 动态 DDL：每个 Field 是真实列 | 静态 schema：`cells` 表，JSONB `value` |
| Prisma 双层 + 原生 SQL 适配 | Drizzle 单层 |
| 全 DSL 公式引擎 + 依赖图 + 跨表重算 | Expression Field，库评估，无级联 |
| share-db / op-log 实时同步 | ws 广播 + LWW |
| 多租户 + RLS + 计费 | 单租户 |
| 40+ feature 模块 | 12 个 features |

## 4. 仓库结构

采用 **pnpm 单仓 + Turborepo**，但 v1 只有 2 个包，避免 teable "20 个包" 的过度抽象：

```
markpocket/
├── CONTEXT.md
├── docs/
│   ├── migration/plan.md            ← 本文件
│   └── adr/                          ← 架构决策记录
├── apps/
│   └── web/                          ← 单一 Next.js 应用（前端 + API + ws）
│       ├── src/
│       │   ├── app/                  ← App Router 页面
│       │   ├── server/
│       │   │   ├── trpc/             ← tRPC router 定义
│       │   │   ├── features/         ← 领域服务（base/field/record/...）
│       │   │   ├── realtime/         ← ws 网关、频道管理
│       │   │   ├── auth/             ← better-auth 配置
│       │   │   ├── db/               ← Drizzle schema、迁移
│       │   │   └── storage/          ← 附件 storage adapter
│       │   ├── modules/              ← 前端领域模块（grid-editor 等）
│       │   └── components/ui/        ← shadcn 组件
│       └── Dockerfile
├── packages/
│   └── domain/                       ← 纯类型 + zod schema（Field/View 类型定义、表达式 AST）
│       └── src/
├── docker-compose.yml                ← web + postgres
├── turbo.json
└── pnpm-workspace.yaml
```

**何时拆包**：只有当某段代码被两个及以上消费者需要（如 `packages/domain` 被 web 和未来的 cli/worker 共用），才提升为独立包。**禁止预先拆包**。

## 5. 数据模型

单 Postgres，静态 schema。核心表：

```sql
-- 鉴权（better-auth 管理，schema 略，含 users / sessions）

-- 工作区（单租户部署下全局唯一一行）
workspaces(id, name, created_at)

-- 顶层容器
bases(id, workspace_id, name, icon, created_at, created_by)

-- 表
tables(id, base_id, name, order_index, created_at)

-- 字段定义（type 决定 value 的 JSON 结构）
fields(
  id, table_id, name,
  type            TEXT,        -- text|long-text|number|boolean|date|
                               -- single-select|multi-select|attachment|user|link|expression
  options         JSONB,        -- 类型相关配置（精度、单位、select 选项、表达式源码…）
  order_index     INT,
  created_at
)

-- 视图（同一 table 的不同呈现）
views(id, table_id, type, name, options JSONB, order_index)
-- options 内含 filter / sort / group / hiddenFields / columnWidth 等

-- 记录（瘦行）
records(id, table_id, created_at, updated_at, created_by, updated_by)

-- 单元格值（每个 Cell 一行，便于历史与按字段索引）
cells(
  id,
  record_id,
  field_id,
  value          JSONB,         -- 类型相关：text→string、number→number、
                                -- multi-select→string[]、link→recordId[]…
  updated_at,
  UNIQUE(record_id, field_id)
)
CREATE INDEX ON cells(field_id) INCLUDE(value);
CREATE INDEX ON cells(record_id);

-- 字段级历史（追加写）
cell_history(
  id, cell_id, old_value JSONB, new_value JSONB,
  changed_by, changed_at
)

-- 附件元数据（实际文件在 storage adapter）
attachments(
  id, filename, mime, size,
  storage_driver TEXT,         -- 'local' | 's3'
  storage_key    TEXT,
  uploaded_by, created_at
)

-- 链接（反向查询用；正向值存在 cells.value 的 recordId 数组里）
links(
  from_field_id, from_record_id, to_record_id,
  PRIMARY KEY(from_field_id, from_record_id, to_record_id)
)

-- 权限
base_members(base_id, user_id, role)   -- role: owner|editor|viewer
base_shares(id, base_id, view_id, mode, token, expires_at)
```

**设计要点**：

1. **Row-per-cell 而非 row-per-record**：每个 Cell 单独一行，使字段级历史天然成为 cells 变更的旁路表；按字段筛选/索引也直接。代价是行数 = records × fields，但单表 <10 万行约束下完全可接受。
2. **JSONB `value`**：类型由 `fields.type` 决定，应用层做序列化/校验（zod）。查询特定字段值用 `cells.value->>'x'` 或专门的 GIN 索引，仅在确有查询需求时加。
3. **不使用动态 DDL**：彻底消除 teable 的 schema 同步、`db-data-prisma`、aggregator。
4. **Link 不引入外键约束**：跨表引用完整性由应用层校验（避免删除被引用 record 时的级联复杂度）。

## 6. teable → markpocket 模块映射

| teable 模块 | 处置 | markpocket 落点 |
|---|---|---|
| `apps/nestjs-backend` | **丢弃** | 重写为 `apps/web/src/server/features/*`，tRPC + 单进程 |
| `apps/nextjs-app` | **丢弃** | 重写为 `apps/web/src/app/*`（App Router） |
| `packages/core`（field/view 模型） | **借鉴 + 简化** | `packages/domain/src/`（zod schema，砍掉 derivate/show-as 等复杂分支） |
| `packages/formula` | **丢弃** | 改用第三方表达式库（见 §7） |
| `packages/db-main-prisma` | **丢弃** | 合并进单一 Drizzle schema |
| `packages/db-data-prisma` | **丢弃** | 同上（消除双库） |
| `packages/openapi` | **丢弃** | tRPC 推断类型，不做 OpenAPI 导出（v1 不需要第三方集成） |
| `packages/sdk` | **丢弃** | 前端直接用 tRPC client，不做独立 SDK |
| `packages/ui-lib` | **丢弃** | 用 shadcn/ui + Tailwind，按需添加 |
| `packages/v2`（DDD 重写中） | **丢弃** | teable 自己都在重写，无继承价值 |
| `packages/common-i18n` / `icons` | **丢弃** | v1 仅英文 / 直接用 lucide-icons |
| `features/record` `field` `base` `table` `view` `selection` | **重写** | 对应 features |
| `features/calculation` `graph` | **丢弃** | 改为 Expression Field（无 graph） |
| `features/aggregation` | **简化** | View 查询层直接 SQL 聚合，无独立引擎 |
| `features/share-db` `ws` `record-events` `op-builder` | **丢弃** | 重写为 ws 广播 + LWW |
| `features/auth` `oauth` `invitation` `organization` | **替换** | better-auth |
| `features/comment` `chat` `ai` `notification` | **丢弃** | v1 不做 |
| `features/plugin*` `dashboard` `pin` | **丢弃** | v1 不做 |
| `features/base-sql-executor` | **丢弃** | 不暴露 SQL（单租户内部场景由 DBA 直连） |
| `features/audit` | **改造** | 升级为字段级 cell_history |
| `features/import` `export` | **简化** | 仅 CSV |
| `features/attachments` | **重写** | 抽象 storage adapter |
| `features/base-share` `collaborator` | **简化重写** | base_members + base_shares |
| `features/integrity` | **丢弃** | 单库无完整性同步问题 |

**净效果**：teable 的 ~40 feature 模块 → markpocket 的 12 个 features：`base / table / field / record / view / expression / history / attachment / share / import-export / realtime / auth`。

## 7. Expression Field 策略

**目标**：用户能在表里写 `单价 * 数量` 这类计算字段，但**不引入 teable 式依赖图与级联重算**。

**方案**：

- **存储**：Expression Field 的 `fields.options = { expression: "单价 * 数量", dependsOn: ["fld_x", "fld_y"] }`。**不**预存计算结果到 cells（避免重算一致性）。
- **求值时机**：**读取时求值**（read-time eval）。查询 record 时，若含 Expression Field，服务端拉取依赖 Cell 的值，调用表达式库求值后注入响应。
  - 备选：**写入时求值**（write-time），依赖 Cell 写入触发重算。本方案不选，因为它需要事件链，破坏"无级联"原则。
- **求值库**：优先 `@odoo/yaml-expression` / `hot-formula-parser` / `formula-parser` 之一；若需 JS 函数（SUM/IF/DATE），用 `isolated-vm` 跑受控 JS 子集。**禁止自研 DSL parser。**
- **跨表引用**：v1 **不支持**（即表达式只能引用本 record 内字段）。跨表聚合（SUM 另一张表的字段）= Rollup，推迟 v2。
- **依赖循环**：因无跨字段链式，仅在 Expression 依赖的 Field 被删除时校验报错。

**显式放弃的 teable 能力**：依赖图、增量重算、跨表引用、公式字段类型推导、公式错误级联。

## 8. Soft Real-time 策略

- **传输**：单一 Next.js 进程挂 WebSocket server（`ws` 库，或 `socket.io` 若需要房间抽象）。生产单实例足够；多实例时引入 Redis pubsub（v2）。
- **频道**：每个 Base 一个频道 `base:{baseId}`。客户端进入 Base 时订阅。
- **事件**：服务端在任何 record/cell/field/view 写入后，构造 `ChangeEvent`（type + 变更 payload）广播。
- **冲突解决**：Cell 写入带客户端 `updatedAt` 时间戳；服务端用 **LWW**（服务端时间戳为准）。**不合并**、**不分叉**。客户端收到变更事件后直接覆盖本地状态。
- **presence**（谁在线、光标在哪个 Cell）：可选，v1 仅"在线成员列表"，不做光标级。
- **不实现**：op-log 持久化、断线重连的 op 回放（客户端断线后全量重拉当前 Base 状态）、并发同字段合并。

## 9. 字段级历史策略

- 每次写 `cells` 时，事务内追加一行 `cell_history`（old_value / new_value / changed_by / changed_at）。
- 查询：按 `cell_id` 倒序拉取，UI 展示时间轴。
- **不做**：历史回放重建任意时刻全表状态（这需要快照表）、合并/压缩旧历史。
- 保留策略：v1 不自动清理（单租户自托管，让用户自行管理）。

## 10. 鉴权与权限

- **better-auth**：管理 users / sessions / email-password；通过插件支持 OIDC（对接企业 SSO）。
- **三层角色**（base 粒度）：`owner`（含 base 设置、成员管理）/ `editor`（CRUD 数据与结构）/ `viewer`（只读）。
- **公开分享**：`base_shares` 表发 token，支持 read-only 公开访问某个 view。无编辑分享。
- **不做**：行级 / 字段级权限（v1 不做）、组织级 SSO 强制。

## 11. 附件存储

- `storage` adapter 接口：`put(key, stream, meta) → url` / `get(key) → stream` / `delete(key)`。
- 实现：`LocalStorage`（默认，写本地 FS，路径配置化，Docker 挂 volume）、`S3Storage`（v1 后期或按需）。
- 上传走 tRPC mutation（v1 不做分片 / 直传签名 URL）。

## 12. 显式丢弃清单（避免遗漏）

teable 里 markpocket **不做**：

- AI / Chat / 评论 / @mention / 通知系统
- Plugin / Dashboard / Pin / 自定义视图扩展
- SQL 直查暴露
- 多租户 / 计费 / 用量限额 / 邀请邮件
- Calendar / Gantt / 看板高级特性
- RecordUndo/Redo（仅保留 Cell 历史；不做会话级 undo stack）
- 实时并发同字段 OT
- 百万行性能优化（动态 DDL、aggregator、双重索引）
- 公式依赖图 / 跨表公式 / Lookup / Rollup（v2）
- 多语言界面（v1 仅英文）
- OpenAPI / SDK 包对外发布

## 13. 分阶段里程碑

每个阶段都是可独立交付的状态。

**Phase 0 — 骨架（~1 周）**
- 仓库 / Turborepo / Docker Compose / Postgres / CI
- better-auth 登录注册
- tRPC + Drizzle 联通，Hello-World 增删改查

**Phase 1 — 数据骨架（~2 周）**
- features：`base / table / field / record`
- 完整 CRUD（不含 view）+ 基础字段类型（text/number/boolean/date/select）
- 简单 Grid 页面展示与编辑

**Phase 2 — 视图（~2 周）**
- features：`view`
- Grid（含 filter/sort/group/列宽/隐藏列）+ Form + Kanban + Gallery
- per-view 配置持久化

**Phase 3 — 实时（~1 周）**
- features：`realtime`
- ws 网关 + Base 频道 + LWW + 在线成员

**Phase 4 — 计算字段（~1 周）**
- features：`expression`
- Expression Field + 求值库 + 读时求值

**Phase 5 — 富字段（~2 周）**
- attachment（含 storage adapter）+ link 字段 + multi-select + user 字段

**Phase 6 — 历史（~1 周）**
- features：`history`
- cell_history 写入 + 时间轴 UI

**Phase 7 — 收尾（~1 周）**
- CSV 导入导出 + base_share（公开只读链接）+ 权限三层角色落地

**总计 v1：~11 周（小团队 2-3 人）**

**v2 候选**（不在本方案）：Lookup / Rollup、多实例 Redis pubsub、Calendar 视图、S3 storage、i18n、行/字段级权限。

## 14. 风险与开放问题

1. **读时求值性能**：Expression Field 在大 record 集合上读时求值会放大查询成本。缓解：限制单次查询 record 数（分页）、对高频表达式缓存。需在 Phase 4 做基准测试。
2. **Row-per-cell 行数膨胀**：1 万 record × 30 字段 = 30 万行 cells。在 <10 万 record 约束下仍可控，但若未来放宽量级，需重新评估（届时可加 record-level JSONB 回退）。
3. **LWW 在弱网下的用户感知**：并发编辑同 Cell 时后写覆盖前写，可能让用户感到数据丢失。UI 需在冲突时提示。是否升级为字段级 OT 是 v2 议题。
4. **better-auth 与 Next.js App Router 兼容性**：better-auth 对 RSC 支持持续演进，Phase 0 需做技术验证；备选 Lucia v2。
5. **Link 字段完整性**：删除被引用 record 时如何处理（清空 link / 阻止删除 / 软删）。需 Phase 5 确定策略。
6. **teable UI/交互的复用**：本方案默认全新 UI。若产品上要求"用起来像 teable"，需在 Phase 1 前对齐 UX 期望。
