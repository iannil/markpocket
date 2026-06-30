# markpocket 领域术语表

本文件是 glossary，**只定义领域语言**，不记录任何实现/架构决策。架构决策见 `docs/adr/`。

## 核心实体

- **Workspace** —— 系统的顶层组织容器。单租户自托管部署下，全局只有一个 Workspace。
- **Base** —— Workspace 内的顶层工作单元，对应"一个数据库文件"。包含若干 Table。
- **Table** —— Base 内的一张表，由若干 Field 和若干 Record 组成。
- **Field** —— Table 的列定义，带类型（text / number / date / select / attachment / link 等）与配置（options）。
- **Record** —— Table 的一行数据，是若干 Cell 的集合。
- **Cell** —— 一个 Record 与一个 Field 的交点，即单个单元格的值。
- **View** —— 同一张 Table 的某种呈现方式（Grid / Form / Kanban / Gallery）。View 不改变底层数据，只改变展示与交互；可携带自己的 filter / sort / group / hidden-fields 配置。

## 字段类型语义

- **Link Field** —— 跨 Table 的关联字段，引用另一张 Table 的 Record。v1 支持。
- **Lookup Field** —— 在本表里"看穿"Link、引用对端 Table 的某个 Field 的值。**v2 推迟**。
- **Rollup Field** —— 对 Link 关联的对端 Record 集合做聚合（SUM / COUNT / AVG 等）。**v2 推迟**。
- **Expression Field** —— 由表达式定义的计算字段（如 `单价 * 数量`），由成熟库评估，**无依赖图、无跨 record 级联重算**。刻意不使用 "Formula" 一词，以区别于 teable 的全 DSL Formula。
  - **写时求值（同 record 内重算）**：写入同一 record 的任一 Cell 时，在同一事务内重算该 record 的所有 Expression Field，结果物化到 `cells.value`。
  - **只能引用本 record 内的基础字段**：不可引用另一个 Expression Field，不可跨表。因此依赖闭包永远是"本行的其它 cell"，无依赖图、无跨 record 级联。
  - **字段引用以 token 形式编写**：编辑器内呈现为 chip、锚定稳定字段 id，而非自由文本字段名。引用解析因此无歧义，依赖列表由 token 扫描精确派生。

## 协作与一致性

- **Soft Real-time** —— 同一 Base 内的客户端之间广播数据变更；Last-Write-Wins，**不**做并发同字段的 OT/CRDT。
- **LWW (Last-Write-Wins)** —— 并发对同一 Cell 的写入，以最后到达的服务端时间戳为准；不合并、不分叉。

## 历史

- **Field-level History** —— 对每个 Cell 的每次值变更保留可回溯记录（谁、何时、旧值、新值）。

## 数据生命周期

- **Import** —— 从外部文件（v1：CSV）解析并写入为某 Table 的 Record。
- **Export** —— 将某 Table 的 Record 序列化导出（v1：CSV）。

## 非术语（避免使用）

- **Formula** —— 不使用。在 markpocket 语境里一律称为 Expression Field。历史代码里出现的 "formula" 一律视为 teable 遗留，迁移时降级为 Expression Field 或丢弃。
- **Aggregate / Aggregation** —— 不作为独立子系统。需要时由 View 的查询层做 SQL 聚合，不引入独立计算引擎。
