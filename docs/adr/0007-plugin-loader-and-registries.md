# ADR-0007：插件加载器与扩展点注册表

- **状态**：Accepted
- **日期**：2026-07-09
- **相关**：落地 `docs/archive/superpowers/specs/2026-07-09-plugin-architecture-design.md` §2/§3；延续 ADR-0006（StorageProvider 接缝）

## 背景

ADR-0006 用「注册表 + 解析器」抽出了第一个扩展点，但注册表是 storage 专属、注册靠副作用 import，且实现在 `apps/web` 内。要支持多扩展点与「插件即 npm 包」，需要统一的加载与注册机制。

## 决策

1. **编译期捆绑**：插件是 workspace / npm 包，列在 `apps/web/src/plugins.config.ts`，build 时静态 import。装/卸插件 = 改配置 + rebuild。与 tRPC / Next.js 静态编译零摩擦（见备选）。
2. **同形注册表**：所有扩展点用 `@markpocket/plugin-sdk` 的 `createRegistry<T>(kind)`（`register / get / tryGet / list` + 未知名字 / 重名报错）。storage 复用此形，另建 field-type / view-type / ui-slot / event / auth-provider 五个骨架注册表（`apps/web/src/server/plugins/registry.ts`）。
3. **声明式清单 + 单一加载路径**：插件导出 `PluginDefinition`；`loadPlugins`（`apps/web/src/server/plugins/loader.ts`）遍历清单把各具名贡献填进对应注册表；`apps/web/src/server/plugins/index.ts` barrel 首次 import 时同步跑一次 `loadPlugins(plugins)`，消费者经 barrel 读注册表，保证读前已填充。
4. **只有 tRPC server 路由需静态类型**，故仅它需在 `plugins.config.ts` 静态合并；其余扩展点运行时查表（cell 值在 JSONB 边界本就是 `unknown`，client 按 type 字符串查），不侵蚀 client 类型。

## 后果

**正面**

- 多扩展点统一机制；`@markpocket/plugin-storage-local` 成为首个 workspace 包插件，dogfood「插件即 npm 包」分发模型。
- client tRPC 类型零妥协（编译期已知全部路由）。
- storage 注册从副作用 import 收敛为加载器单一路径；`getStorage()` 解析 `STORAGE_PROVIDER`（缺省 `local`），未知后端抛错并列已注册项。

**负面**

- 装插件需 rebuild（非运行时热插）。
- `plugins.config.ts` 手工维护（声明清单 + 若有 router 则静态合并）。
- 注册表是进程内单例，依赖 barrel 的 import 纪律：消费者必须经 `@/server/plugins` barrel 读注册表，直接 import `registry.ts` 会拿到未填充的表。

## 备选方案

- **运行时动态加载**：契合「像装 App」，但与 Next RSC / 打包、tRPC 编译期类型强冲突，需类型双轨 + 沙箱，核心膨胀。否决（留后续 spec）。
- **副作用 import 注册（ADR-0006 现状）**：简单但无清单、难反省、注册顺序隐式。否决——改声明式清单。

## 反悔代价

低。加载器与注册表是新增的加法层；storage 回退＝改回直接 import。运行时动态加载若将来必须，属新增能力而非推翻本决策。
