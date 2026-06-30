# ADR-0003：Expression Field（不引入 teable 全 DSL 公式引擎）

- **状态**：Accepted（2026-06-30 修订：求值时机由"读时求值、不物化"改为"写时求值、同 record 内重算并物化"）
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
- 表达式由**第三方成熟库**评估（候选：`hot-formula-parser` / `formula-parser` / 受控 JS 子集 + `isolated-vm`）。**禁止自建求值器 / 类型推导系统**；字段引用以 token 形式编写（编辑器内为 chip、锚定字段 id），依赖列表由 token 扫描派生——这不算"自研 parser"，分词与求值仍由库承担
- **写时求值（同 record 内重算）**：写入同一 record 的任一 Cell 时，在同一事务内重算该 record 的所有 Expression Field，结果物化到 `cells.value`
- **只能引用本 record 内的基础字段**：表达式不可引用另一个 Expression Field，不可跨表。因此依赖闭包永远是"本行的其它 cell"，**无依赖图、无跨 record 级联重算**
- 这一约束使 Expression 字段在 `cells` 表里有行，View 的 SQL filter/sort/group 对其与普通字段统一生效（见迁移方案 §5、§7）
- Lookup / Rollup **推迟到 v2**（它们强依赖跨表关系图）

## 后果

**正面**

- 彻底消除 teable 最难维护的子系统：相关代码量从 ~300KB（formula + calculation + graph）降到预估 <1 个 feature 目录
- 无跨 record 级联 = 无事务、无锁、无一致性问题
- Expression 字段在 `cells` 有行 → 读路径无需特殊注入，filter/sort/group 在 SQL 层统一处理
- 消除"读时求值在大结果集上放大查询成本"的旧风险
- 求值逻辑可单元测试，行为可预测

**负面**

- 每次 cell 写入多 N 次同 record 求值（N = 该表 Expression Field 数）；v1 量级可接受，需在 Phase 4 做写入吞吐基准
- 表达式不可引用另一个 Expression Field（产品限制：不能套娃）
- 用户不能在 v1 写跨表聚合公式（如 `SUM(另一张表.字段)`）—— 该需求由 v2 的 Rollup 满足
- 表达式能力受限于所选库的函数集

## 备选方案

- **全 DSL + 依赖图（teable 式）**：能力最强但复杂度不可控，违背初衷。否决。
- **读时求值、不物化（本 ADR 前一版方案）**：否决原因——Expression 字段在 `cells` 无行，对 SQL filter/sort 层不可见，用户无法按计算列排序/筛选（"按总价看 top 10"这类最自然的诉求做不了）；且大结果集读时求值放大查询成本、无法分页。读时方案的唯一优势（避免写时重算）被"依赖闭包仅限本 record、无级联"这一约束抵消——同 record 重算不需要事件链，不破坏"无级联"原则。
- **写入时跨 record 级联重算（teable calculation 式）**：需要事件链与依赖图，破坏"无级联"原则。否决。
- **完全不做计算字段**：最简但产品价值损失过大（用户期望表内公式）。否决。

## 反悔代价

中。从"写时同 record 重算"升级到全 DSL 需重写 field schema、引入依赖图、设计级联重算管道——是 markpocket 内部最大的潜在子系统。该决策应在 v2 真有跨表/套娃需求时才重新评估，且届时优先考虑 Lookup/Rollup 而非全 DSL。
