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
-- options AST（Notion/Airtable 式）：
--   filter:  { op:"and"|"or", conditions:[ {fieldId,operator,operand} | {op,conditions:[...]} ] }
--   sort:    [ {fieldId, direction:"asc"|"desc"} ]   -- 多键依次
--   group:   [ {fieldId} ]                            -- 多级分组
--   hiddenFields: [fieldId];  columnWidth: {fieldId: px}
-- 操作符按 type：text/long-text→equals|contains|startsWith|empty|notEmpty；
--   number→=|!=|>|<|>=|<=|empty|notEmpty；boolean→is(true|false)；
--   date→=|before|after|between|empty|notEmpty；
--   single/multi-select→anyOf|noneOf|empty|notEmpty(operand=option id)；
--   user→is|empty|notEmpty(operand=user id)；
--   link→contains|empty|notEmpty(operand=record id，走 GIN)；
--   expression→沿用其结果类型操作符；{__error} 哨兵不匹配值过滤、排序归一组。
-- 执行：filter/sort 由查询路径 SQL 阶段一承担（AST→cells 上的 WHERE/ORDER BY）。

-- 记录（瘦行）
records(id, table_id, created_at, updated_at, created_by, updated_by)

-- 单元格值（每个 Cell 一行，便于历史与按字段索引）
cells(
  id,
  record_id,
  field_id,
  value          JSONB,         -- 按 fields.type 分形（详见设计要点 6）：
                                -- text/long-text→string；number→number(float64，
                                --   显示精度由 options.precision/scale 控)；boolean→boolean；
                                -- date→ISO 8601 string(TZ-aware instant 或 naive YYYY-MM-DD，
                                --   由 options.includeTime 区分)；
                                -- single-select→option id(string)；multi-select→option id[](有序)；
                                -- attachment→attachment id[](引用 attachments 表)；
                                -- user→user id(string)；link→record id[](有序，单一事实源)；
                                -- expression→结果原生值(number/string/boolean/…) 或 {__error:string} 哨兵
  updated_at,
  UNIQUE(record_id, field_id)
)
CREATE INDEX ON cells(field_id) INCLUDE(value);
CREATE INDEX ON cells(record_id);
CREATE INDEX ON cells USING GIN (value);   -- 反向 link 查询（value @> '["rec_x"]'）；按需启用

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

-- 反向 link 查询不设独立表：link 值单一事实源在 cells.value 的 recordId[]，
-- 反查靠 cells.value 的 GIN 包含索引。详见设计要点 7。

-- 权限
base_members(base_id, user_id, role)   -- role: owner|editor|viewer
base_shares(id, base_id, view_id, mode, token, expires_at)
```

**设计要点**（查询/完整性操作契约详见 ADR-0005）：

1. **Row-per-cell 而非 row-per-record**：每个 Cell 单独一行，使字段级历史天然成为 cells 变更的旁路表；按字段筛选/索引也直接。代价是行数 = records × fields，但单表 <10 万行约束下完全可接受。
2. **JSONB `value`**：类型由 `fields.type` 决定，应用层做序列化/校验（zod）。查询特定字段值用 `cells.value->>'x'` 或专门的 GIN 索引，仅在确有查询需求时加。
3. **不使用动态 DDL**：彻底消除 teable 的 schema 同步、`db-data-prisma`、aggregator。
4. **Link 不引入外键约束**：跨表引用完整性由应用层校验（避免删除被引用 record 时的级联复杂度）。
5. **空 Cell = 无行**：未赋值的 Cell 在 `cells` 表里不存在行（absence = empty），稀疏数据不占空行，直接服务于"<10 万行"约束。清空 = `DELETE` cell 行，但在同事务内先追加一行 `cell_history(old_value, new_value=null)`。建 record 时：field 有非空 default 才写带 default 的 cell 行，否则无行；空集合（multi-select / link）同样以无行表示空。
6. **字段值形态（value schema）**：见 `cells.value` 注释。关键决策：number 存 float64 + `options.precision/scale` 控显示精度（金额级精确升 string 再做）；date 存 ISO 8601（TZ-aware instant 或 naive `YYYY-MM-DD`，由 `options.includeTime` 区分）；single/multi-select 按 option id（稳定，改名不断，改名只动 `field.options` 不动 cells）；multi-select/attachment/link 为有序 id 数组。
7. **Link 单一事实源**：link 字段值**只**存在 `cells.value` 的 `recordId[]`，**不设独立 `links` 表**。反向查询（"谁引用了 rec_x"）靠 `cells.value` 上的 GIN 包含索引（`WHERE value @> '["rec_x"]'`）。代价：GIN 须为 JSONB 数组建索引；收益：无双写同步、单一事实源。性能不济时再加派生索引表（纯加法，不破坏数据）。
8. **引用完整性策略（级联清空）**：link 目标 record、select option、被引用 user 被删时，统一**级联清空**引用方 cell 中的死 id（同事务反查并移除；数组空则遵循要点 5 删行），各写一行 `cell_history`。不阻止删除、不留墓碑；历史兜底信息不丢。link 反查用要点 7 的 GIN 索引；select 反查按 `field_id` 过滤；user 字段选择器限定为 `base_members` 成员，级联清空为兜底。
9. **View 查询语义**：filter 支持**嵌套 AND/OR**（递归组），非扁平。sort/group 在 v1 **不支持 link 字段**（按 link 数组排序语义模糊，实为 Lookup/Rollup，v2）；filter by link（contains/empty）支持，走要点 7 的 GIN。group by multi-select 支持（按 option 分组有意义）。

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

**目标**：用户能在表里写 `单价 * 数量` 这类计算字段，但**不引入 teable 式依赖图与跨 record 级联重算**。详见 ADR-0003。

**方案**：

- **存储与求值时机**：**写时求值（同 record 内重算）**。Expression Field 的 `fields.options = { expression: "{fld_x} * {fld_y}", dependsOn: ["fld_x", "fld_y"] }`（用户在编辑器看到的是 `单价 * 数量` 的 chip 形式，存储为 token-canonical）；写入同一 record 的任一 Cell 时，在同一事务内重算该 record 的所有 Expression Field，结果物化到 `cells.value`。
  - 关键约束：表达式**只能引用本 record 内的基础字段**（不可引用另一个 Expression Field、不可跨表）。因此依赖闭包永远是"本行其它 cell"，无依赖图、无跨 record 级联。这也使 Expression 字段在 `cells` 表有行，View 的 SQL filter/sort/group 对其与普通字段统一生效（见 §5、View 查询两阶段路径）。
- **求值库**：优先 `hot-formula-parser` / `formula-parser` 之一；若需 JS 函数（SUM/IF/DATE），用 `isolated-vm` 跑受控 JS 子集。**禁止自研 DSL parser。**
- **跨表引用**：v1 **不支持**。跨表聚合（SUM 另一张表的字段）= Rollup，推迟 v2。
- **依赖维护**：`dependsOn` 在字段保存时由 token 扫描一次性派生并存储；字段引用以 token-chip 形式编写（非自由文本），故抽取无歧义。当被依赖的基础 Field 被删除时校验报错。

**显式放弃的 teable 能力**：依赖图、增量重算、跨表引用、表达式套娃（引用另一 Expression）、公式字段类型推导、公式错误级联。

## 8. Soft Real-time 策略

- **传输**：单一 Next.js 进程挂 WebSocket server（`ws` 库，或 `socket.io` 若需要房间抽象）。**需 custom server**（ws 挂在 Node HTTP server 上，不能用默认 `next start`、不能 serverless；与 ADR-0004 Docker 长驻 Node 一致）。生产单实例足够；多实例时引入 Redis pubsub（v2）。
- **频道**：每个 Base 一个频道 `base:{baseId}`。客户端进入 Base 时订阅。
- **事件**：服务端在任何 record/cell/field/view 写入后，构造 `ChangeEvent`（type + 变更 payload）广播。
- **冲突解决**：Cell 写入带客户端 `updatedAt` 时间戳；服务端用 **LWW**（服务端时间戳为准）。**不合并**、**不分叉**。客户端收到变更事件后直接覆盖本地状态。
- **presence**（谁在线、光标在哪个 Cell）：可选，v1 仅"在线成员列表"，不做光标级。
- **结构变更并发**：field/table 删除走级联清空（§5 要点 8，事务内删 cell 行）；迟到的 cell 写若目标字段/记录已不存在，在 mutation 校验阶段拒绝并向客户端回推"字段/记录已删除"错误，不产生僵尸 cell。
- **不实现**：op-log 持久化、断线重连的 op 回放（客户端断线后**重拉激活 view 的可见数据集 + 该 view 配置**——非整个 base；客户端本就只持有当前可见数据，故重拉天然有界）、并发同字段合并。

## 9. 字段级历史策略

- 每次写 `cells` 时，事务内追加一行 `cell_history`（old_value / new_value / changed_by / changed_at）。
- 查询：按 `cell_id` 倒序拉取，UI 展示时间轴。
- **不做**：历史回放重建任意时刻全表状态（这需要快照表）、合并/压缩旧历史。
- 保留策略：v1 不自动清理（单租户自托管，让用户自行管理）。

## 10. 鉴权与权限

- **better-auth**：管理 users / sessions / email-password；通过插件支持 OIDC（对接企业 SSO）。
- **三层角色**（base 粒度）：`owner`（含 base 设置、成员管理）/ `editor`（CRUD 数据与结构）/ `viewer`（只读）。
- **公开分享**：`base_shares` 表发 token，支持 read-only 公开访问某个 view。无编辑分享。
- **公开分享投影**：token 公开端点**严格 view 作用域**——服务端投影到该 view 的 filter∩可见字段，只返回结果数据；隐藏字段、其它 view、其它表、以及 filter AST 一律不外泄。token per-view、只读、可过期。
- **不做**：行级 / 字段级权限（v1 不做）、组织级 SSO 强制。

## 11. 附件存储

- `storage` adapter 接口：`put(key, stream, meta) → url` / `get(key) → stream` / `delete(key)`。
- 实现：`LocalStorage`（默认，写本地 FS，路径配置化，Docker 挂 volume）、`S3Storage`（v1 后期或按需）。
- 上传走 tRPC mutation（v1 不做分片 / 直传签名 URL）。

## 12. 导入导出（CSV）

v1 仅 CSV。value 形态见 §5 设计要点 6；CSV 是扁平文本，复杂类型按下列规则：

- **标量直白**：text/long-text 原样（含 CSV 转义）；number 按 `options.precision` 输出 locale 无关小数串；boolean → `true`/`false`；date → ISO 8601 字符串。
- **single-select**：导出 option **name**（人读）；导入按 name 匹配，不存在则自动建 option。
- **multi-select**：`|`（或换行）定界拼接，避开 CSV 逗号冲突；导入按 name 匹配/建。
- **link / attachment / user**：recordId / attachmentId / userId 在 CSV 中无意义且无法可靠反解——**导出尽力而为的人读渲染**（linked record 的主字段、附件文件名列表、user 邮箱），**导入忽略这些列**。

**已知限制**：CSV 只保证标量数据可靠往返；关系/附件字段为"导出降级、导入跳过"。需要保真导入导出时走 v2 的 JSON 结构化格式。

## 13. 显式丢弃清单（避免遗漏）

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

## 14. 分阶段里程碑

每个阶段都是可独立交付的状态。

**Phase 0 — 骨架（~1 周）**
- 仓库 / Turborepo / Docker Compose / Postgres / CI
- better-auth 登录注册
- tRPC + Drizzle 联通，Hello-World 增删改查

**Phase 1 — 数据骨架（~2 周）**
- features：`base / table / field / record`
- 完整 CRUD（不含 view）+ 基础字段类型（text/number/boolean/date/select）
- 简单 Grid 页面展示与编辑
- Grid 交互向品类惯例靠拢（archived teable 作只读参考）；附"核心交互清单"（Enter/Tab 导航、双击/F2 编辑、Ctrl+C/V、Shift 多选、字段菜单等）作验收标准

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

## 15. 风险与开放问题

1. ~~读时求值性能~~（已废止，见 ADR-0003 修订）：改为写时物化后，读路径不再有求值开销。残余风险：每次 cell 写入多 N 次同 record 求值，需在 Phase 4 对"高密度 expression 字段表"做写入吞吐基准。
2. **Row-per-cell 行数膨胀**：1 万 record × 30 字段 = 30 万行 cells。在 <10 万 record 约束下仍可控，但若未来放宽量级，需重新评估（届时可加 record-level JSONB 回退）。
3. **LWW 在弱网下的用户感知**：并发编辑同 Cell 时后写覆盖前写。缓解：客户端在收到同 cell 时间戳更晚的 ChangeEvent（自己的写被覆盖）时，对该格瞬时高亮 + 一次性 toast"你的编辑被 X 覆盖"；无 modal、无合并 UI（LWW 不合并）。是否升级为字段级 OT 是 v2 议题。
4. ~~better-auth 与 Next.js App Router 兼容性~~（已查证 2026-06-30，基本消险）：better-auth 对 App Router / RSC / Server Actions 是**一等支持**——`/api/auth/[...all]` handler、RSC 与 server action 内 `auth.api.getSession`、`nextCookies` 插件处理 server action 写 cookie、Next.js 16 proxy 兼容。Phase 0 仅需常规联通验证，非技术风险。**原备选 Lucia 已失效**（v3 于 2025-03 官方废弃、npm 不再维护；社区推荐的继任者正是 better-auth）。故 v1 不设 fallback；若将来真要换，候选为 Auth.js（NextAuth v5）或托管型（Clerk / WorkOS）。
5. ~~Link 字段完整性~~（已解决，见设计要点 8）：删除被引用 record 时**级联清空**引用方 cell 的死 id + 写历史。策略统一适用于 link / select-option / user。
6. ~~teable UI/交互的复用~~（已解决）：走**品类惯例 + teable 只读参考**——核心编辑语法（Grid 单元格编辑 / 键盘导航 / 字段配置 / 视图切换 / 表达式栏）向已收敛的品类标准（Airtable/teable/Smartsheet）靠拢；UI 外壳、被砍功能面、渲染层（DOM/SVG，非 teable 的 canvas）markpocket 自定。archived teable 前端作**只读交互参考**（抄交互不抄代码，不违背 §6）。Phase 1 Grid 需附"核心交互清单"作验收标准。
