# Airtable 机会：交付设计与范围决策

日期：2026-10-09。状态：根据本次在线调研形成的建议方案；未实施、未发布。

## 决策依据

用户要求直接通过在线调研决策，不以找到访谈对象为执行前提。目标是用一个发布周期交付可信的小团队数据库，先争取新项目，再承接简单 Airtable Base。现有仓库是 alpha，已有 Grid、CSV、角色、历史、REST/MCP，尚无 Form/Kanban，也没有完整 Airtable 迁移器。

一手依据（访问日期均为 2026-10-09）：

- 收购完成：[Airtable，2026-09-04](https://www.airtable.com/newsroom/airtable-joins-bending-spoons)。不据此声称已经涨价。
- [续费前准备迁移的用户](https://www.reddit.com/r/Airtable/comments/1vugy33/seeking_support_airtable_power_user_considering_a/)；[新项目改变选型](https://www.reddit.com/r/Airtable/comments/1vf52bv/airtable_being_bought_by_bending_spoons_news_from/)。同一用户跨版发帖不重复计数。
- [个人用户需要表格数据库，而非更大的应用平台](https://www.reddit.com/r/Airtable/comments/1qvc7xd/airtable_alternative_for_spreadsheetdatabase/)。
- [替代品的操作完成度反馈](https://www.reddit.com/r/Airtable/comments/1wybxsr/could_you_help_an_airtable_lover_to_find_other/)。公开自述仅用于识别问题，不代表迁移率或市场规模；竞品推销回复不算独立验证。
- [Baserow 导入限制](https://baserow.io/user-docs/import-airtable-to-baserow)、[NocoDB 导入限制](https://nocodb.com/docs/product/bases/import-base-from-airtable)。关系、计算、自动化迁移不能以 CSV 替代。

## 分项目与执行顺序

| 顺序 | 独立交付物 | 退出条件 |
| --- | --- | --- |
| A1 | 完整或明确失败的 CSV 导出 | 两个现有入口均可导出超过 10k 的表；快照一致；不再成功返回被截断文件 |
| A2 | 可演练的备份、恢复和发布检查 | DB + 附件在隔离实例恢复并核对；发布前证据记录完整 |
| B | Airtable 基础迁移 | 支持基础字段、附件、关联和来源 ID；预检/报告；重试不重复写；不支持项明确列出 |
| C | 基础录入体验与视图 | 多行粘贴、字段排序、跨页统计；Form 优先于 Kanban |
| D | 获客材料 | 准确的比较页、迁移指南、可复现演示；所有承诺有已发布版本支撑 |

A1、A2 在本次提供逐任务实施计划。B、C、D 是范围已定的后续项目，不是可直接执行的详细计划；必须分别检查相关代码、写接口与测试后执行，不把路线图当工程计划。A1/A2 不足以把 alpha 自动宣布为稳定版。

B 的边界：先做导入新 Base，不覆盖已有业务表；基础字段 + 附件下载 + 两阶段关联重建；公式/Lookup/Rollup 只允许明确标注的静态结果；不迁移自动化、Interface、权限、评论与历史。必须定义凭据生命周期、附件 URL 校验、容量边界、取消/重试与失败清理再开发。不能把陌生附件 URL 直接交给无约束服务端 fetch。

C 的边界：复用既有角色与记录写入语义；公开 Form 是新写入入口，必须独立设计令牌、字段投影、校验与限频；不得把现有只读 share token 直接升级成写权限。

D 的边界：先准备内容与演示，发布外部站点或社区帖子不是本次任务。避免承诺“完全兼容”“无限规模”“已验证节省成本”。

## 全局约束（供计划逐字引用）

- Node >=22；pnpm 10.32.1；PostgreSQL 16；沿用 Next.js 16、tRPC 11、Drizzle、Vitest。
- 单租户自托管；不引入多租户、计费系统、任务队列或新运行时依赖。
- 不改 ADR-0001/0003/0004 的规模、Expression Field 与部署边界。
- 插件不得导入应用的 @/ 路径；通过 CoreServerApi 注入主机能力。
- 所有导出至少要求 viewer 权限；错误不得返回部分文件或泄露数据库信息。
- CSV 是数据交换格式，不是完整备份；附件二进制、权限、历史通过实例备份保存。
- 保留用户已有的 .gitignore 修改与 CLAUDE.md 删除；不恢复、不提交这些变更。
- 仅编写计划不代表已实施、测试通过或发布；执行计划不自动授权推送 tag 或发布镜像。

## A1：导出子项目规格

### 行为

E1：保留 `csv.export({tableId})` 与 `export.exportBase({baseId, tableIds?})`。成功返回所有选定表的全部行，`truncated` 保留兼容字段且恒为 false。

E2：一个请求使用一个 PostgreSQL repeatable-read/read-only 事务，字段、记录和单元格来自同一个快照；表内顺序 `createdAt DESC, id DESC`，字段顺序 `orderIndex ASC, id ASC`。Base 导出的表序 `orderIndex ASC, id ASC`。

E3：单请求串行读取，每页 250 行；每表最多 100,000 行；返回 CSV 原文合计最多 8 MiB；单页数据库原始 JSON 单元格文本最多 16 MiB，超限明确失败；单进程最多 1 个导出，忙时立即失败。阈值是此版本资源预算，不是“无限行”；100,001 行或超过字节预算必须明确失败，不生成可误认为完整的下载。

E4：保留 `csvEscape` 的公式注入中和、字段格式化；空表返回表头。文件名追加 table ID，避免同名表相互覆盖。保留浏览器多文件下载提示。

E5：事务内语句超时 30 秒；全请求在每次页读取前检查 60 秒期限。阻塞中的语句由数据库超时终止，因此墙钟最长可能超过 60 秒；不宣传精确取消。所有失败都释放并发占位。

E6：全表导出不按当前 view 过滤；公开分享访问者不能调用这两个受保护入口。CSV 不承诺关联语义或附件文件可恢复。

### 验收

- 10,001 行、100,000 行、空表可完整组装；100,001 行失败。
- 中文按 UTF-8 字节计算，超预算明确失败；多表共享 8 MiB 预算。
- 无权限不读表数据；传入别的 Base 的 table ID 不导出该表。
- 注入字符串、逗号、换行与双引号保持既有安全语义。
- 真 PostgreSQL 回归覆盖 >10k 行、同时间戳稳定顺序和快照在并发更新下不变。

## A2：备份与发布子项目规格

O1：沿用 Docker Compose web + postgres 与 `./data`。备份前停 web，保持 postgres 运行；备份完成/失败均恢复原先运行的 web 状态。

O2：完整备份包含 custom-format pg_dump、data 目录归档、提交 SHA、版本、UTC 时间和 SHA-256 校验清单。密钥配置另行安全保管，不把 .env 加入仓库或打印到日志。

O3：恢复只在独立目录、独立容器、独立卷及 127.0.0.1:3300 演练；禁止向现有数据库执行 --clean 或覆盖现有 data。不得使用 `docker compose down -v` 清理用户部署。

O4：恢复验证必须覆盖登录、表/记录/单元格数量、附件字节校验和、历史、角色和一次新写入；不能只看 /api/health。

O5：运行现有 format/lint/typecheck/test/build、真实 API e2e、浏览器导出与恢复验收。发布候选版本仍保持 alpha，除非其余稳定性范围另有验收。只记录检查结果；推 tag 和外部发布是独立动作。
