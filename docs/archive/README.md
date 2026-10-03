# 归档文档（archive）

本目录存放**已完成使命**的历史文档：实施计划、过程跟踪、已被 ADR 或现行文档取代的方案。它们只作历史溯源用，不再维护；与现状冲突时以现行文档为准。

现行文档索引：[`../README.md`](../README.md)

| 目录/文件 | 内容 | 归档原因 | 归档时间 |
|---|---|---|---|
| `migration/` | teable → markpocket 全量重写迁移方案（`plan.md`） | 重写已完成（v1.0.0-alpha.1，2026-07）；关键不可逆决策已沉淀为 ADR-0001..0005 | 2026-10-03 |
| `superpowers/` | 16 份 SDD 计划/设计 spec（Phase 4–7、插件系统、字段类型注册表、全产品重设计 A/B/C） | 对应阶段全部实施完毕；设计决策已沉淀为 ADR-0006..0009 与 `docs/redesign/` 设计规范 | 2026-10-03 |
| `redesign/status.md` | Paper & Ink 重设计 8 Phase 进度跟踪 | 重设计已收官（2026-07-03，Phase 6 分享页后作为独立功能实现） | 2026-10-03 |
| `redesign/2026-07-01-paper-ink-plan.md` | Paper & Ink 实施计划 | 同上，实施完成 | 2026-10-03 |

> 注意：**设计规范本身仍在现行区** —— `docs/redesign/2026-07-01-paper-ink-design.md` 是 UI 的现行设计规范（设计 token、密度、边框/阴影规则），新增界面仍须遵循。
>
> 本地（不入库）的历史产物：`archived/teable/`（旧 fork 源码，64MB，已被 .gitignore 排除，仅作迁移期参考，可安全删除）、`.superpowers/sdd/`（SDD 过程产物，824KB，自忽略）。
