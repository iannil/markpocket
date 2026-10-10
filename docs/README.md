# markpocket 文档地图

> 给人、也给 LLM agent 的文档入口。现行文档全部有效并随代码维护；历史文档在 [`archive/`](archive/README.md)。

## 必读顺序（新会话 / 新协作者）

1. [`../CLAUDE.md`](../CLAUDE.md) — 工程事实速查（构建/测试命令、架构布局、约定），LLM 的项目记忆
2. [`../CONTEXT.md`](../CONTEXT.md) — 领域语言表（术语只在这里定义，如"Expression Field 不是 Formula"）
3. [`STATUS.md`](STATUS.md) — 项目全量进展 + 功能矩阵 + 迭代路线（本文档系的"现在时"）
4. [`adr/`](adr/) — 不可逆决策的为什么（改架构前必读相关 ADR 的"反悔代价"节）

## 现行文档

| 文档 | 内容 | 何时读 |
|---|---|---|
| [`STATUS.md`](STATUS.md) | 项目状态全景：功能矩阵、质量基线、已知限制、迭代路线 | 任何任务开始前 |
| [`adr/0001..0015`](adr/) | 架构决策记录（中文，含背景/决策/后果/备选/反悔代价） | 动到对应子系统前 |
| [`api/README.md`](api/README.md) | tRPC API 总览（端到端类型安全；机器通道另见 agent-access） | 改客户端/服务端调用时 |
| [`api/routers.md`](api/routers.md) | 全部 tRPC 路由参考（含 token 路由与 csv 插件命名空间） | 查/加过程时 |
| [`api/agent-access.md`](api/agent-access.md) | Agent 接入层四通道（REST /api/v1、MCP、RSS、Skill） | 做 agent/API 相关工作 |
| [`FORMS.md`](FORMS.md) | Form 配置、发布与匿名提交 | 配置表单 |
| [`KANBAN.md`](KANBAN.md) | Kanban 分页、移动与详情 | 使用看板 |
| [`WEBHOOKS.md`](WEBHOOKS.md) | owner 配置、接收验签/去重、缺口恢复 | 接入自动化 |
| [`release/2026-10-10-p0-p2-evidence.md`](release/2026-10-10-p0-p2-evidence.md) | 实现/fixture/实际浏览器/最终候选证据分界 | 验收与发布前 |
| [`testing.md`](testing.md) | 测试体系：分层、mock 模式、运行方式 | 写任何测试前 |
| [`plugin-development.md`](plugin-development.md) | 插件开发（plugin-sdk、两个扩展点、注入面） | 写插件时 |
| [`redesign/2026-07-01-paper-ink-design.md`](redesign/2026-07-01-paper-ink-design.md) | UI 现行设计规范（Paper & Ink：token、密度、hairline 边框） | 写任何界面 |
| [`UPGRADE.md`](UPGRADE.md) | 版本升级与迁移说明（含 P0–P2 迁移；最终升级验收见证据） | 升级部署 |
| [`AIRTABLE_IMPORT.md`](AIRTABLE_IMPORT.md) | Airtable 导入预览版：准备、字段映射、限制与 journal 清理 | 迁移数据 |
| [`BACKUP.md`](BACKUP.md) | 实例备份、校验与隔离恢复演练 | 备份、恢复或升级前 |
| [`../CHANGELOG.md`](../CHANGELOG.md) | 逐版本变更 | 查"什么时候变的" |

## 归档

[`archive/`](archive/README.md) — 已完成的迁移方案、SDD 计划/spec、重设计进度跟踪。只作历史溯源，不再维护。

## 写作约定

- 文档语言：STATUS/ADR/CONTEXT 为中文，api/ 系列为英文（保持既有惯例）
- 决策进 ADR（含反悔代价），状态进 STATUS，术语进 CONTEXT，三者不互相复制正文
- 文档中的数字（测试数、迁移号、路由数）改动时必须同步 —— STATUS.md §测试基线 与 CLAUDE.md 是仅有的两处允许出现计数的地方
