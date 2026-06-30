# ADR-0001：单 Postgres + JSON-row 存储

- **状态**：Accepted
- **日期**：2026-06-30
- **决策者**：markpocket 迁移方案研讨
- **相关**：取代 teable 的"双 Postgres + 动态 DDL"架构

## 背景

teable 为支撑"百万行级查询性能"，采用：

- 两个 Postgres：`main`（存元数据：用户/base/table/field）+ `data`（存实际行数据）
- `data` 库里**每个 Field 是真实列**（动态 DDL），由 Prisma `db-data-prisma` 包 + 一套 schema 同步机制维护
- 配套 `db-aggregator`、`integrity` 等子系统保证两库一致

这套架构是 teable 复杂度的核心来源之一，也是 markpocket fork 后无人能维护的主要原因。

markpocket 尚未上线，无既有数据约束。我们需要决定后端存储模型。

## 决策

采用**单一 Postgres + 静态 schema + row-per-cell + JSONB value**：

- 一个 `cells` 表，每个 Cell 一行，`value` 字段为 JSONB，类型由 `fields.type` 决定
- 单表承诺 **<10 万行**；超过即视为超出 v1 设计域
- 完全不做动态 DDL、不做两库同步

## 后果

**正面**

- 消除 `db-data-prisma`、`db-aggregator`、`integrity` 等子系统，后端复杂度下降一个数量级
- schema 演进只走标准 Drizzle 迁移，无运行时 DDL
- 字段级历史天然成为 `cells` 写入的旁路表（见 ADR 历史策略）
- 单元测试与本地部署只需一个 Postgres

**负面**

- 放弃百万行级查询性能：单表 10 万行内可控，超过后需重新设计
- 不能直接对单个字段做关系索引（需靠 JSONB GIN 或 generated column，按需引入）
- 行数膨胀：1 万 record × 30 字段 = 30 万行 `cells`，查询需依赖 (record_id) / (field_id) 索引

## 备选方案

- **保留 teable 双库 + 动态 DDL**：性能好但复杂度不可控，违背迁移初衷。否决。
- **row-per-record（一张表存 JSONB 整行）**：行数更少，但字段级历史与按字段索引都更难。否决（与 ADR 历史策略冲突）。
- **SQLite 单文件**：进一步简化，但放弃并发写与生态。留作"个人版"未来分支，v1 不采用。

## 反悔代价

高。一旦数据按 row-per-cell 落地，迁回动态 DDL 需要全量数据重排。该决策应在 v1 落地前再次确认量级约束。
