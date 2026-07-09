# Markpocket 核心+插件架构设计（Phase 0 核心解耦）

> **日期**：2026-07-09
> **状态**：设计稿（待审阅）
> **作者**：iannil + Claude
> **相关**：落地 ADR-0006 的 Phase 0「核心解耦」；商业化设计稿 `2026-07-09-markpocket-commercial-positioning-design.md` §2 的技术前置。**本 spec 只覆盖架构/加载器/扩展点解耦，不含 Marketplace / 支付 / License**（另立 spec）。

---

## 0. 目标与非目标

**目标**

- 把「核心+插件」从文档概念变成代码：核心尽可能微小，能力皆插件。
- 6 个扩展点（Field Type / View Type / Server Router / UI Slot / Table Action-Event / Auth Provider）落地为「注册表 + 解析器」，复刻已完成的 StorageProvider（ADR-0006）形状。
- 第一方内建能力（内建 field types、Form/其余视图、CSV、attachment 存储）反向拆成随核心捆绑的第一方插件，dogfood SDK。
- v1 行为零回归。

**非目标（本 spec 明确排除）**

- Marketplace 前端、支付（Stripe/Paddle）、License key 生成/验证 —— 另立 spec。
- 运行时动态加载 / 插件沙箱 —— 本期用编译期捆绑（见 §2 决策）。
- 修改 ADR-0001~0005 的数据模型、值语义、一致性契约。

---

## 1. 关键决策（已与用户确认）

| 决策 | 选择 | 理由 |
|---|---|---|
| **加载/分发模型** | **编译期捆绑** | 插件是 npm 包，列在 `plugins.config.ts`，build 时静态 import。与 tRPC/Next.js 静态编译零摩擦，核心加载器极小。装/卸插件 = 改配置 + `docker build`。最契合单容器自托管 + solo dev。 |
| **核心边界** | **数据内核 only，能力皆插件** | 核心 = 数据模型 + 写路径/查询 + 扩展点注册表 + 加载器 + Grid 基线。内建 field types、其余视图、CSV、attachment 存储均为第一方捆绑插件。SDK 被内建能力反复验证。 |
| **本 spec 范围** | **仅架构/加载器/扩展点解耦** | Marketplace/支付/License 另立 spec，保证单一实现计划可收敛。 |

---

## 2. 核心边界

### 2.1 留在核心（不可移，ADR-0001/0005 的基底）

- **数据模型**：`server/db/schema.ts` 的 Base/Table/Field/Record/Cell/View/attachment 表定义。
- **写路径 + 两阶段 View 查询**：`lib/view-query.ts` / `lib/view-ast.ts` / cell 写入事务 —— 强制 ADR-0005（row-per-cell、empty=无行、级联清空、link 单一事实源）。
- **数据实体 CRUD 路由**：`server/trpc/routers/{base,table,field,record,cell,view,workspace,member,history,share}`。field-type 插件依赖核心 `field` 路由建字段，故实体 CRUD 属核心。
- **6 个扩展点注册表 + 插件加载器**（本 spec 新增，见 §3/§4）。
- **Grid 视图**：唯一恒在的基线渲染器。
- **better-auth 会话基座**：Auth *Provider* 是扩展点，但会话机制本身属核心。

### 2.2 出核心，成为第一方捆绑插件

| 插件包 | 内容 | 用到的扩展点 |
|---|---|---|
| `plugin-builtin-fields` | 10 个内建 field type 的行为（text/number/boolean/date/single-select/multi-select/expression/user/link/attachment） | Field Type |
| `plugin-view-form` | Form 视图（其余视图 Kanban/Gallery 后续同型） | View Type + UI Slot |
| `plugin-csv` | CSV 导入导出（搬自现有 `api/import`、`api/export`） | Server Router + UI Slot + Event |
| `plugin-storage-local` | 本地磁盘存储（StorageProvider `local`，已实现，本期归档为插件形态） | Storage Provider |

> **field type 打包粒度**：内建 10 类型合为**一个** `plugin-builtin-fields` 包（dogfood 注册表而不引入 10 个包的开销）；付费 Rating/QR/JSON 各自独立包（属未来 spec）。

### 2.3 边界的净效果

核心**新增**：6 注册表（各 ~30 行）+ 加载器（~70 行）≈ **+250 行**。核心**移出**：`field-types.ts` 的类型行为、CSV 路由、视图组件等，移出量更大。核心净变小，且每类能力有了外部可插的接缝。

---

## 3. 加载模型：编译期捆绑如何做到类型安全

### 3.1 决定性 insight

**只有 server 端 tRPC 路由需要静态类型**；其余扩展点都是运行时 `Map` 查表——cell 值在 JSONB 边界本就是 `unknown`，client 按 `type` 字符串查 renderer。因此：动态注册**不侵蚀** tRPC 的 client 类型。

### 3.2 唯一静态组装点

```ts
// apps/web/src/plugins.config.ts —— 装插件 = 改这里 + rebuild
import builtinFields from '@markpocket/plugin-builtin-fields';
import csv from '@markpocket/plugin-csv';
import viewForm from '@markpocket/plugin-view-form';
import storageLocal from '@markpocket/plugin-storage-local';

// 全部插件的声明式清单（加载器遍历，填充各注册表）
export const plugins = [storageLocal, builtinFields, viewForm, csv] as const;

// server 路由是唯一需要静态类型的贡献 → 显式静态合并
export const pluginRouters = {
  csv: csv.router,
} as const;
```

- **加载器**（`server/plugins/loader.ts`）遍历 `plugins`，把非路由贡献（fieldTypes / viewTypes / uiSlots / events / authProviders）调用对应 `registerX` 填进各 `Map`。加载器在 server 启动与 client bootstrap 各跑一次（各自注册各自那一侧的贡献）。
- **appRouter**：`router({ ...coreRouters, ...pluginRouters })`；`typeof appRouter` 静态可推断 → client tRPC 类型零妥协。
- **第三方插件**：发布 npm 包 → 用户 `pnpm add @vendor/plugin-x` + 在 `plugins.config.ts` 加两行（清单 + 若有 router 则加进 `pluginRouters`）+ `docker build`。

### 3.3 插件清单（声明式，非纯副作用）

```ts
// @markpocket/plugin-sdk 导出的类型
export interface PluginDefinition {
  name: string;
  version: string;
  // 各扩展点贡献；缺省即不贡献该类
  fieldTypes?: FieldTypeContribution[];   // server 侧值语义
  fieldRenderers?: FieldRendererContribution[]; // client 侧 renderer/editor
  viewTypes?: ViewTypeContribution[];
  viewComponents?: ViewComponentContribution[];
  router?: AnyTRPCRouter;                  // 由 plugins.config.ts 静态挂进 pluginRouters
  uiSlots?: UiSlotContribution[];
  events?: EventHandlerContribution[];
  authProviders?: AuthProviderContribution[];
}
```

声明式（而非像当前 StorageProvider 的纯副作用 import 注册）的理由：加载器有清单可反省——列出已装插件/版本，为未来 marketplace + license gating 留钩子。StorageProvider 的副作用注册在本期归入 `plugin-storage-local` 的 `provider` 字段，保持形状统一。

---

## 4. 六个扩展点接口

所有扩展点复刻 StorageProvider（ADR-0006）的「注册表 + 解析器」形状：`registerX(name, impl)` + `getX()/listX()`，未知名字抛错并列出已注册项。

| 扩展点 | 注册接口 | 侧 | 触及 |
|---|---|---|---|
| **Field Type** | server: `registerFieldType(type, { optionsSchema, normalizeCellValue, cellCodec })`；client: `registerFieldRenderer(type, { renderer, editor })` | 双端（两注册表） | 写路径 + pivot；**值语义仍由核心按 ADR-0005 强制**，插件只提供 schema/编解码/渲染 |
| **View Type** | server: `registerViewType(type, { queryContribution? })`；client: `registerViewComponent(type, { component })` | 双端 | View 查询贡献；核心保证两阶段查询与分页 |
| **Server Router** | 清单 `router` 字段 → `plugins.config.ts` 静态挂 `pluginRouters[name]` | 服务端 | 无（纯增量命名空间） |
| **UI Slot** | `registerSlot(slotId, component)`；核心在 topbar/sidebar/context-menu/settings 预置 `<Slot id=...>` 挂载点 | 客户端 | 纯增量 |
| **Table Action / Event** | `on(event, handler)`，event ∈ `record.created/updated/deleted`、`cell.changed`；核心在写事务提交后派发 | 服务端 | 纯增量；webhook 首用 |
| **Auth Provider** | `registerAuthProvider(cfg)` 注入 better-auth 的 social/OIDC 配置 | 服务端 | 隔离 |

**Field Type 的 ADR-0005 边界（重要约束）**：field-type 插件可注册新类型的 `optionsSchema`、`normalizeCellValue`（empty 信号）、`cellCodec`（JSONB 值形态）、client renderer/editor；但**不可**改变存储契约——值仍存 `cells.value` JSONB、empty=删行、link 仍单一事实源、级联清空由核心执行。注册表是接缝，ADR-0005 的强制点留核心。

---

## 5. 目录与包布局

```
packages/
  plugin-sdk/               # PluginDefinition + 各 Contribution 类型 + register* 客户端 re-export
  plugin-storage-local/     # 本地磁盘 StorageProvider（归档现有实现为插件）
  plugin-builtin-fields/    # 10 内建 field type（server 值语义 + client renderer）
  plugin-view-form/         # Form 视图
  plugin-csv/               # CSV 导入导出
apps/web/src/
  plugins.config.ts         # 唯一静态组装点
  server/plugins/
    loader.ts               # 遍历清单填充注册表
    registries/
      field-type.ts  view-type.ts  ui-slot.ts  event.ts  auth-provider.ts
  server/storage/           # provider.ts 的 registry 保留；local.ts 迁往 packages/plugin-storage-local
```

第一方插件作为 pnpm workspace 包（`@markpocket/plugin-*`），dogfood「插件即 npm 包」的分发模型。

---

## 6. 抽出顺序（按风险递增，每步可编译、可 pause 验证）

1. ✅ **StorageProvider**（ADR-0006，已完成）。
2. **加载器 + SDK 清单类型 + 空注册表骨架**（纯新增，零风险）。交付：`plugin-sdk` + `loader` + 5 个空注册表 + `plugins.config.ts` 骨架。
3. **Server Router + UI Slot + Event 三点** → 首个真插件 **`plugin-csv`**（把 `api/import`/`api/export` 搬成插件，端到端验证三点能从外部包接进来）。
4. **Field Type 注册表** → 内建 10 类型搬进 `plugin-builtin-fields`（中风险，dogfood 关键块；逐类型迁移，每类型迁完跑回归）。
5. **View Type 注册表** → Form 搬进 `plugin-view-form`（Kanban/Gallery 后续同型，不在本期硬性范围）。
6. **Auth Provider**（隔离，收尾）。

> `plugin-storage-local` 的归档（把 `server/storage/local.ts` 迁成 workspace 包）并入步骤 2，使 storage 与其余扩展点形状统一。

---

## 7. 测试策略

- **注册表单元测试**：每个注册表测 注册 / 解析 / 未知名字报错 / `list` 反省（复刻 StorageProvider 已建形状）。
- **加载器测试**：给定 manifest 数组 → 断言各注册表被正确填充、顺序正确。
- **CSV 插件端到端**：作为第一个外部包插件，验证 server router 挂载 + event 派发 + ui slot 渲染三点贯通。
- **Field Type 回归**：10 类型搬成插件后，现有 grid 编辑、cell 写入/清空（empty=删行）、link 级联清空、expression 写时求值测试全绿——证明 ADR-0005 契约未破。
- **View 回归**：View 查询/filter/sort/分页在 Grid（核心）与 Form（插件）下行为不变。
- **类型验证**：`tsc --noEmit` 通过，`AppRouter` 类型在 client 端仍完整推断（含 `pluginRouters` 命名空间）。

---

## 8. 风险与应对

| 风险 | 应对 |
|---|---|
| Field Type 搬出触及写路径/pivot，回归面大 | 逐类型迁移，每类型迁完跑全回归；ADR-0005 强制点留核心，插件只提供 schema/codec/renderer |
| 双端注册表（server + client）状态不同步 | 加载器在两侧各跑一次、各注册各侧贡献；清单是单一事实源，两侧读同一 `plugins.config.ts` |
| `plugins.config.ts` 手工维护 router 静态合并易漏 | 加载器启动时校验：清单里声明了 `router` 的插件必须出现在 `pluginRouters`，否则启动报错 |
| 编译期捆绑 ≠ spec 愿景的「像装 App」 | 本期明确只做编译期；运行时动态加载留后续 spec，接口已按「未来可运行时」预留清单/生命周期形状 |
| 把已完成 v1 大改引入不稳定 | 每步可编译可 pause；纯增量步骤（2、3、6）先行，高风险重构（4、5）在有回归网兜底后进行 |

---

## 附录：与现有 ADR 的兼容性

| ADR | 兼容性 | 说明 |
|---|---|---|
| ADR-0001（单 Postgres row-per-cell） | ✅ | 插件 field type 值仍存 JSONB，不改存储选型 |
| ADR-0002（LWW 软实时） | ✅ | Event 扩展点只监听、不改同步策略 |
| ADR-0003（Expression Field） | ✅ | expression 作为内建 field type 插件，求值语义不变 |
| ADR-0004（单租户自托管） | ✅ | 编译期捆绑 + 单容器，不引入多租户 |
| ADR-0005（row-per-cell 操作契约） | ✅ | 值语义强制点留核心；插件不可改写路径/完整性 |
| ADR-0006（扩展点接缝） | ✅ 延伸 | 本 spec 落地其 Phase 0；加载器/注册表将补写 ADR-0007+ |
