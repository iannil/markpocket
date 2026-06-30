# ADR-0005：row-per-cell 的查询与完整性操作契约

- **状态**：Accepted
- **日期**：2026-06-30
- **相关**：落实 ADR-0001（单 Postgres + row-per-cell + JSONB）的查询与引用完整性操作方式；汇总 `plan.md` §5 设计要点 5–9、§8、View 查询路径

## 背景

ADR-0001 选定了 row-per-cell + JSONB value，但只论证了**存储选型**，没有指定操作面：

- 一条 record 散落在 `cells` 表的 N 行里，View 读取怎么把它查回来、怎么 filter/sort/分页？
- 空 Cell 怎么表示（无行 / null 行）？
- 各字段类型的 `value` JSONB 形态是什么？
- link 反向查询怎么做（要不要独立 links 表）？
- 引用目标（record / option / user）被删时引用方怎么办？

这些决策**互锁**，collectively 决定"row-per-cell 在 v1 <10 万行约束下是否真能跑"。只读 ADR-0001 会缺操作面的 why，故单独成文。

## 决策

1. **两阶段查询路径**：View 读取分两步——(1) SQL 阶段按 filter/sort 在 `cells` 上用 `(field_id) INCLUDE(value)` / GIN 索引筛 `record_id` 并分页排序；(2) 应用层把候选 record 的全部 cell pivot 成宽行，统一处理 JSONB 多态与 expression 哨兵。filter/sort 必须落 SQL 才能用索引与分页；pivot 必须落应用层才能统一多态。
2. **空 Cell = 无行**：未赋值不占行（稀疏友好，直接服务 ADR-0001 的 <10 万行赌注）；清空 = `DELETE` cell 行 + 同事务追加 `cell_history(old_value, new_value=null)`。
3. **字段值形态（value schema）**：见 `plan.md` §5 `cells.value` 注释。关键：number = float64 + `options.precision/scale` 控显示精度；date = ISO 8601（TZ-aware instant 或 naive `YYYY-MM-DD`，由 `options.includeTime` 区分）；single/multi-select 按 option id；multi-select/attachment/link 为有序 id 数组。
4. **Link 单一事实源**：link 值**只**存 `cells.value` 的 `recordId[]`，**不设独立 `links` 表**；反向查询走 `cells.value` 的 GIN 包含索引（`value @> '["rec_x"]'`）。无双写同步、单一 SoT。
5. **引用完整性 = 级联清空**：link 目标 record、select option、被引用 user 被删时，同事务反查引用方 cell 并清死 id（数组空则按决策 2 删行），各写一行 `cell_history`。不阻止删除、不留墓碑；历史兜底信息不丢。
6. **View 查询语义**：filter 支持嵌套 AND/OR；v1 不支持 sort/group by link（语义模糊，实为 Lookup/Rollup，v2）；filter by link（contains/empty）走决策 4 的 GIN。

## 后果

**正面**

- 查询与完整性全部可由小团队掌握：无动态 DDL、无双写 SoT、无 op-log
- 每个决策都直接服务"<10 万行 + 简化维护"的初衷
- 单一事实源 + 无墓碑 = 状态空间小，并发边界（LWW、结构变更）清晰

**负面**

- 反向 link 查询依赖 JSONB 数组上的 GIN 索引（比独立 links 表的 B-tree 略 fiddly）
- 级联清空在删 record 时有 fan-out（v1 量级可控；量大时可切"读时惰性裁剪"，数据模型不变）
- row-per-cell 行数仍随 records × fields 增长，量级突破约束时需重新评估（回 ADR-0001）

## 备选方案

- **纯 SQL pivot（crosstab / 条件聚合）**：性能最好，但 JSONB 多态让 `WHERE`/`ORDER BY` 表达式极复杂、字段类型推导在 SQL 里重做。否决。
- **预铺 null 行（empty = null row）**：pivot 略简，但稀疏表吃满最坏行数，违背 ADR-0001 量级赌注。否决。
- **独立 `links` 表（双写 SoT）**：反向查询快（B-tree），但双写同步 bug 风险、两处事实源。否决——留作性能不济时的派生索引加法（不破坏数据）。
- **阻止删除 / 软删墓碑**：前者 UX 差（删不掉被引用 record），后者引入额外状态。否决。

## 反悔代价

中。查询路径与完整性策略贯穿所有读写代码；切换到反范式读模型或独立 links 表是真实重构，但**不涉及数据重排**（相对 ADR-0001 存储选型的反悔代价低）。重新评估触发条件：(a) 量级突破 10 万行；(b) 反向 link 查询性能不济；(c) 出现强一致跨表聚合需求（届时优先走 v2 的 Lookup/Rollup 而非全 DSL）。
