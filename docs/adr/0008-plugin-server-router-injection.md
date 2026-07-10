# ADR-0008：插件 Server Router 注入与 server/client 包拆分

- **状态**：Accepted
- **日期**：2026-07-10
- **相关**：落地 `docs/superpowers/specs/2026-07-09-plugin-csv-server-router-design.md`；延续 ADR-0007（编译期加载器与注册表）；第一个消费者 `@markpocket/plugin-csv`

## 背景

ADR-0007 让插件能在编译期注册进核心，但只验证了 storage（纯服务端、无核心耦合）。真正的功能插件（CSV 导入导出）需要：(1) 从 `packages/*` 拿到核心服务（db / schema / queries / field-types）而**不 import `@/`**；(2) 贡献一个 tRPC router 并让客户端 `trpc.<plugin>.*` 类型完整可用；(3) 同时贡献服务端逻辑与客户端 UI 组件。

难点在 tRPC：router 的类型由 `initTRPC` 实例决定。若插件不能共享 app 的 `t` 实例，能否把插件 router 合并进 app 的 `appRouter` 并保住 client 类型？

## 决策

1. **SDK 提供 tRPC 运行时**（`@markpocket/plugin-sdk/trpc`）：以**结构化** `PluginContext { session: { user: { id } } | null }` 建一个 `initTRPC` 实例，导出 `router / publicProcedure / protectedProcedure`。插件用它建自有 router。**spike 验证**：该 router 合并进 app 的 `appRouter` 后，client 的 `inferRouterInputs/Outputs` 对该命名空间完整流通（protected + zod input + `ctx.session.user.id`，0 type error，改错字面量会报错）。app 无需改自己的 `init.ts` / Context / 既有 router——app 的真实 session 结构上可赋值给 `PluginContext`。

2. **CoreServerApi 工厂注入**：插件 server 贡献 = `(core: CoreServerApi) => Router`。app 在 `plugins.config.ts`（可 import `@/`）构造 `coreServerApi`（`{ db, schema, queries, fieldTypes }`）并调工厂，产出的具体 router 静态挂进 `pluginRouters`；`appRouter = router({ ...core, ...pluginRouters })`。插件只 import `@markpocket/plugin-sdk`。

3. **server/client 子路径导出**：插件包 `exports` 分 `./server`（router 工厂，拖服务端依赖）与 `./client`（纯展示 UI 组件，经 `ctx` 收数据/回调，不含 tRPC/`@/`）。app 的 `plugins.config.ts`（server）与 `plugins.client.ts`（client）各 import 各侧，物理隔离两侧 bundle。UI 经客户端 `registerSlot` + `<Slot>` 挂载；核心页面只渲染 `<Slot id>`，不 import 插件包。

4. **数据传输走文本**：CSV 是纯文本，import 收字符串 mutation、export 返字符串 query，客户端 Blob 下载——避开 tRPC 的二进制传输弱点。

5. **静态合并契约**：声明了 router 的插件必须出现在 `pluginRouters`；一个单测守 `csv ∈ pluginRouters`（client 类型契约的护栏）。

## 后果

**正面**

- 插件是真 npm 包（不 import `@/`），却仍有 client 端完整 tRPC 类型。
- CSV 从两条 REST 路由收敛为一个插件；核心 settings 页去掉对 CSV 的直接依赖。
- server/client 拆分模式为后续 Field Type / View（同样双端）铺好路。

**负面**

- `CoreServerApi.db` 用 `DrizzleLike` 宽松面 / 插件内 `db as any` 落地——插件内 drizzle 查询失列级类型（client 面向 I/O 类型不受影响）。
- `pluginRouters` 后置 spread 理论上可覆盖同名核心 router；第二个 router 插件落地时需加 disjoint 断言。
- 客户端 UI 与其 tRPC 交互被拆到 app 侧（`ctx` 注入），插件 `/client` 偏薄——为守「插件不 import `@/`」的代价。

## 备选方案

- **抽 `@markpocket/core` 大共享包**（db/schema/queries + tRPC 实例）：最“正规”，但大重构、与「核心尽量小/增量」相左。否决。
- **插件共享 app 的 `t` 实例**：需把 `t` 挪进共享包并让 app 采用其 Context——牵动所有既有 router 的 ctx 类型。本方案用结构化 `PluginContext` + 跨实例合并（spike 证明可行）免去此改。否决共享实例。
- **保留 CSV 为 REST 路由**：不验证 Server Router 扩展点。否决。

## 反悔代价

低。注入与拆分是加法层；CSV 回退＝改回 REST 路由。`DrizzleLike` 收紧或将来抽共享包，属演进而非推翻。tRPC 跨实例合并已由 spike 与 client typecheck 双重背书。
