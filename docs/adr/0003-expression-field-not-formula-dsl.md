# ADR-0003：Expression Field（不引入 teable 全 DSL 公式引擎）

- **状态**：Accepted
- **日期**：2026-06-30
- **相关**：取代 teable 的 `packages/formula`、`features/calculation`、`features/graph`

## 背景

teable 拥有一套完整的公式系统：

- 自研 DSL（`packages/formula`，~240KB），含 lexer / parser / 类型推导
- `features/graph` 维护字段间依赖图
- `features/calculation` 在写入时做**跨表级联增量重算**
- 支持跨表引用、Lookup、Rollup

这套系统是 teable 最难维护的部分：DSL 自研导致类型推导与错误处理路径极多，依赖图与级联重算引入事务、锁、一致性等大量边界问题。markpocket fork 后无人维护，主因之一即在此。

markpocket 需要决定：表内计算字段做到什么粒度。

## 决策

采用 **Expression Field**，刻意**不**使用 "Formula" 一词（见 `CONTEXT.md`）：

- 用户可定义表达式字段，如 `单价 * 数量`
- 表达式由**第三方成熟库**评估（候选：`hot-formula-parser` / `formula-parser` / 受控 JS 子集 + `isolated-vm`），**禁止自研 DSL parser**
- **读时求值**（read-time eval）：查询 record 时拉取依赖 Cell 值并求值，**不**预存计算结果
- **不做依赖图、不做级联重算**
- **不支持跨表引用**：表达式只能引用本 record 内字段
- Lookup / Rollup **推迟到 v2**（它们强依赖跨表关系图）

## 后果

**正面**

- 彻底消除 teable 最难维护的子系统
- 公式相关代码量从 teable 的 ~300KB（formula + calculation + graph）降到预估 <1 个 feature 目录
- 无级联重算 = 无事务、无锁、无一致性问题
- 求值逻辑可单元测试，行为可预测

**负面**

- 用户不能在 v1 写跨表聚合公式（如 `SUM(另一张表.字段)`）—— 该需求由 v2 的 Rollup 满足
- 读时求值在大结果集上会放大查询成本 → 需要分页与缓存（见 plan.md §14 风险）
- 表达式能力受限于所选库的函数集

## 备选方案

- **全 DSL + 依赖图（teable 式）**：能力最强但复杂度不可控，违背初衷。否决。
- **写入时求值（预存结果）**：避免读时开销，但需要事件链触发重算，破坏"无级联"原则。否决。
- **完全不做计算字段**：最简但产品价值损失过大（用户期望表内公式）。否决。

## 反悔代价

中。从读时求值升级到全 DSL 需要重写 field schema、引入依赖图、设计级联重算管道——是 markpocket 内部最大的潜在子系统。该决策应在 v2 真有跨表需求时才重新评估，且届时优先考虑 Lookup/Rollup 而非全 DSL。
