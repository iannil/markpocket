# ADR-0006：插件扩展点与第一个接缝（StorageProvider）

- **状态**：Proposed（仅 StorageProvider 接缝 Accepted 并已落地）
- **日期**：2026-07-09
- **相关**：落地 `docs/superpowers/specs/2026-07-09-markpocket-commercial-positioning-design.md` §2「插件系统架构概要」的第一步「核心解耦」；不改变 ADR-0001~0005 的数据与一致性契约

## 背景

商业化设计稿提出「核心免费 + 插件市场」，其 §2 列了 7 个扩展点（Field Type / View Type / Table Action / UI Slot / Server Router / Storage Provider / Auth Provider）。但审计当前 `apps/web` 实现时发现：**代码里不存在任何插件接缝**。

- Field Type：`lib/field-types.ts` 是硬编码 `as const` 枚举 + 静态 `optionsSchemas` 字典，加类型必须改核心源码。
- Server Router：`server/trpc/router.ts` 把 11 个 router 静态 import 后拼进 `router({...})`，无动态挂载入口。
- **Storage**：`server/storage/local.ts` 裸导出 `put/get/remove` 函数，**没有 interface、没有 provider 抽象**，两个路由（`api/upload`、`api/files/[id]`）直接 import 具体实现。

设计稿把 storage 描述为「adapter 已有抽象，接入简单」，据此给 S3 插件估「2 周」。该前提与代码不符，估时不成立。本 ADR 记录：把扩展点从「文档概念」变成「代码接缝」的最小策略，并先落地风险最低、被第一批付费插件（S3 附件）直接依赖的 **StorageProvider** 接缝作为示范。

## 决策

1. **扩展点以「注册表 + 解析器」模式落地，而非 DI 容器或动态 import 全家桶**。每类扩展点提供 `registerX(name, impl)` 与 `getX()`：核心只依赖 interface，具体实现在模块加载时自注册，运行时按 env / 配置解析。理由：与 ADR-0004（单租户自托管、状态空间小）一致，避免引入插件框架的复杂度。

2. **第一个接缝：StorageProvider（本 ADR 已落地）**。
   - `server/storage/provider.ts`：`interface StorageProvider { makeKey / put / get / remove }` + `registerStorageProvider` + `getStorage`。
   - `server/storage/local.ts`：改为实现该接口的 `localStorageProvider`，模块加载时以名字 `'local'` 自注册。
   - `server/storage/index.ts`：barrel，副作用 import `./local` 保证内建 provider 在 `getStorage()` 被调用前完成注册。
   - 解析规则：`STORAGE_PROVIDER` env，缺省 `'local'`；未知名字抛错并列出已注册 provider。
   - 调用点（`api/upload`、`api/files/[id]`）改为 `getStorage()`，不再 import 具体实现。
   - 第三方 S3/MinIO/WebDAV 插件只需 `registerStorageProvider('s3', ...)`，核心零改动。

3. **其余扩展点暂不落地，仅在此登记接口草图**，待各自「有真实插件要用」时按同一模式抽出：
   - **Field Type Registry**：`registerFieldType(type, { optionsSchema, normalizeCellValue, ... })`，把 `field-types.ts` 的静态字典改为注册表。风险中（触及写路径与 View 查询）。
   - **Server Router**：`appRouter` 暴露一个 `plugins` 命名空间，插件在启动钩子里 `mergeRouters`。风险中（tRPC 类型在编译期静态，动态挂载需运行时 + 类型双轨）。
   - View Type / UI Slot / Table Action / Auth Provider：各自成文，不在本 ADR 展开。

4. **License 验证不属于本 ADR**。付费/license 闭源模块另起 ADR-0007，本 ADR 只解决「核心可被扩展」这一步，与收费解耦。

## 后果

**正面**

- 「核心+插件」从文档走进代码：存在一个可编译、被真实调用点使用的扩展点，S3 插件的「2 周」估时有了成立前提。
- 模式统一（注册表 + 解析器），后续接缝复制同一形状，认知负担低。
- 对 v1 行为零影响：默认仍是 local，调用语义不变。

**负面**

- 目前只有 1/7 个扩展点落地，设计稿的「三层架构」仍主要停留在纸面；不可据此宣称已是插件化架构。
- 注册表在模块加载期自注册，依赖 barrel 的副作用 import 顺序；新增内建 provider 必须在 `storage/index.ts` 登记，否则 `getStorage` 解析不到。
- Server Router / Field Type 的动态化会触及 tRPC 编译期类型与核心写路径，比 storage 难，本 ADR 未验证其可行性。

## 备选方案

- **完整插件框架（清单 manifest + 沙箱 + 动态 import）一次到位**：与设计稿终态一致，但违背「solo dev、低复杂度优先」，且在没有任何真实插件时属过度设计。否决——按接缝增量抽出。
- **保持现状、只改文档**：把设计稿里「已有抽象」改成「待建」即可，不写代码。否决——那样「核心+插件」永远是 0 行代码；至少要有一个可复制的示范接缝。
- **用 DI 容器（如 tsyringe）统一注入**：能力更强，但引入框架与装饰器元编程，团队掌控成本高。否决——注册表 + 解析器已够。

## 反悔代价

低（就 StorageProvider 而言）。接缝只是加了一层 interface 与 2 个调用点改写，回退＝把 `getStorage()` 换回直接 import。其余扩展点尚未落地，不产生反悔债。重新评估触发条件：(a) Field Type / Server Router 动态化被证明与 tRPC 编译期类型不可调和；(b) 插件市场方向取消（则本接缝退化为普通存储抽象，仍无害）。
