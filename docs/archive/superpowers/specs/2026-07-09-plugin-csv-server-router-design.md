# Plan 2 设计：Server Router + UI Slot 扩展点（CSV 插件）

> **日期**：2026-07-09
> **状态**：设计稿（待审阅）
> **相关**：延续 `2026-07-09-plugin-architecture-design.md` §4/§6 步骤 3；建立在 Plan 1（SDK + 加载器 + storage-local，已合并 master `ec09457`）之上。

---

## 1. 已确认决策

| 决策 | 选择 | 理由 |
|---|---|---|
| **核心服务注入** | **工厂注入 CoreServerApi** | 插件 server 贡献 = `(core: CoreServerApi) => Router`；app 在组装点构 `core` 并调工厂。插件不 import `@/`，是真 npm 包，改动小。备选「抽 `@markpocket/core` 共享包」是大重构，与「核心尽量小/增量」相左，否决。 |
| **CSV 传输** | **tRPC 文本** | import 收 CSV 文本 mutation、export 返回 CSV 字符串 query，客户端 Blob 下载。落进 Server Router 扩展点并 dogfood。CSV 纯文本，无二进制流问题。备选「保留 REST」不验证扩展点，否决。 |
| **UI 挂载** | **UI Slot（随本计划一起做）** | 现无 import UI，export 是 settings/general 里的内联 `<a>`。要把 CSV UI 移出核心页，必须有 slot，否则核心 `trpc.csv.export` 硬编码 = 核心依赖插件。故 Server Router + UI Slot 成对落地。 |
| **Event 扩展点** | **推迟** | 无消费者（webhook 才是首用）。YAGNI，随 webhook 计划做。 |
| **server/client 包拆分** | **本计划建立** | UI Slot 是客户端组件，Server Router 拖 db/procedure（服务端）。插件必须分 `./server` 与 `./client` 子路径导出，两侧各自组装。parent spec §3.2 已预期「加载器两侧各跑一次」。 |

---

## 2. 架构

### 2.1 CoreServerApi 注入

```
apps/web/src/server/plugins/core-api.ts   ← app 构造，类型用 typeof 真实核心对象（零手写 tRPC 泛型）
  export interface CoreServerApi {
    router; protectedProcedure; publicProcedure;   // from server/trpc/init
    db; schema: { cell, field, record, table };    // from server/db
    queries: { listRecordsPivoted };               // from lib/db-queries
    fieldTypes: { FieldType, formatNumberToString, parseStringToNumber };
  }
  export const coreServerApi: CoreServerApi = { ... };
```

- 插件 server 模块签名：`export default (core: CoreServerApi) => core.router({ import: ..., export: ... })`。
- CoreServerApi 的**类型**由 SDK 暴露（插件 import 它做参数类型），但**值**由 app 构造。关键待验证点：让 SDK 的 CoreServerApi 类型与 app 的真实 `typeof protectedProcedure` 兼容而不手写 tRPC 内部泛型（见 §5 风险）。

### 2.2 静态路由合并 + 启动校验

```
apps/web/src/plugins.config.ts (server-only)
  import csvServer from '@markpocket/plugin-csv/server';
  import { coreServerApi } from '@/server/plugins/core-api';
  export const pluginRouters = { csv: csvServer(coreServerApi) } as const;  // 静态、类型可推断

apps/web/src/server/trpc/router.ts
  appRouter = router({ ...coreRouters, ...pluginRouters })  // client AppRouter 类型自动含 csv
```

- **启动校验**：加载器/组装时断言「声明了 router 的插件都出现在 pluginRouters」——本计划以约定 + 一个单测覆盖（清单里带 `hasServerRouter` 标记的插件名 ⊆ `Object.keys(pluginRouters)`）。

### 2.3 客户端 UI Slot

```
packages/plugin-csv 子路径导出：./server（工厂）、./client（uiSlot 组件）

apps/web/src/plugins.client.ts ('use client')
  import csvClient from '@markpocket/plugin-csv/client';
  registerSlot('table-tools', csvClient.slot);   // 客户端 uiSlot 注册表

apps/web/src/components/slot.tsx  <Slot id="table-tools" ctx={...} />
  读客户端 uiSlotRegistry，渲染匹配组件

settings/general/page.tsx
  用 <Slot id="table-tools" ctx={{ tables }} /> 替换内联 Export 区块
```

- 客户端注册表与 server 注册表同形（`createRegistry`），但住在客户端 bundle。客户端 bootstrap（`plugins.client.ts`）在 provider 树里 import 一次触发注册。
- CSV client slot 组件用 `trpc.csv.export.useQuery` / `trpc.csv.import.useMutation`（编译期 AppRouter 已含 csv）。

### 2.4 迁移与删除

- 删 `apps/web/src/app/api/import/route.ts`、`apps/web/src/app/api/export/route.ts`（逻辑搬进 CSV 插件的 tRPC router）。
- `settings/general/page.tsx` 的 Export 区块 → `<Slot id="table-tools">`。
- CSV import/export 逻辑（parseCsv、colMap、cellToCsv、csvEscape）逐字搬进插件，用注入的 `core.*` 取代 `@/` import。

---

## 3. 包布局

```
packages/plugin-csv/
  package.json         # exports: { "./server": "./src/server.ts", "./client": "./src/client.tsx" }
  src/
    server.ts          # (core) => core.router({ import, export })；含 parseCsv / cellToCsv 等纯函数
    server.test.ts     # 用 fake core（内存 db stub 或真 pg 测试库）验 import/export 往返
    client.tsx         # uiSlot 组件（export 下载 + import 上传）
apps/web/src/
  server/plugins/core-api.ts   # CoreServerApi 构造
  plugins.config.ts            # server：pluginRouters 静态合并（本计划从占位改为真挂 csv）
  plugins.client.ts            # client：注册 uiSlots
  components/slot.tsx           # <Slot>
  lib/plugins/ui-slot-client.ts # 客户端 uiSlotRegistry + registerSlot + <Slot> 读取
```

---

## 4. 抽出顺序（TDD，每步可编译）

1. **SDK：CoreServerApi 类型 + ServerRouterFactory 类型 + client slot 贡献类型**（先 prototype-verify tRPC 类型，见 §5）。
2. **app：core-api.ts 构造 + 单测**（断言 core 暴露的 db/queries/fieldTypes 可用）。
3. **CSV 插件 server.ts**：逐字搬 import/export 逻辑为 tRPC router 工厂 + server.test.ts（往返）。
4. **静态合并**：plugins.config `pluginRouters.csv` + router.ts 合并 + 启动校验单测；删两个 REST 路由。
5. **客户端 slot 基础设施**：ui-slot-client 注册表 + `<Slot>` + plugins.client bootstrap（接进 layout/provider）。
6. **CSV client.tsx** slot 组件 + settings/general 用 `<Slot>` 替换；浏览器回归（导出下载、导入生效）。
7. **ADR-0008** 记录 CoreServerApi 注入 + server/client 包拆分。

---

## 5. 风险

| 风险 | 应对 |
|---|---|
| **CoreServerApi 的 tRPC 类型**：让 packages 插件拿到与 app `typeof protectedProcedure` 兼容的类型而不手写 tRPC 内部泛型，可能不平凡 | **实现前先 prototype-verify**：写最小 `(core)=>core.router({ping})` 工厂 + plugins.config 调用，跑 `tsc` 确认 client `trpc.csv.ping` 类型通。通过后再进 CSV。若不可调和，退路：CoreServerApi 里 `router/procedure` 用 `@trpc/server` 的 `AnyRouter`/宽松类型，牺牲插件内 procedure 链式类型（仍保留 client 端 AppRouter 类型）。 |
| tRPC 无法优雅传文件 | CSV 是文本，import 收 string、export 返 string，绕开二进制。大表（ADR-0001 <10 万行）导出为 JSON string 可接受 |
| 客户端 bundle 混入服务端代码 | 靠 `./server` / `./client` 子路径导出物理隔离；plugins.config（server）与 plugins.client（client）各 import 各侧 |
| 改动已完成 v1（settings 页、删 REST 路由） | 每步可编译；删路由前先让 tRPC 路径跑通；浏览器回归导出/导入 |

---

## 6. 与 ADR 兼容

沿用 Plan 1 的兼容性结论（ADR-0001~0005 不变）。新增 ADR-0008（CoreServerApi 注入 + server/client 包拆分）。router 合并延续 ADR-0007 的「编译期静态组装点」。
