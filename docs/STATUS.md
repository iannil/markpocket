# markpocket 项目状态

> **最后更新**：2026-10-10（foundation、Grid、Form、Kanban、受限 Token 与 Webhook 已实现，未发布；最终候选验收待完成）
> 本文档是项目的**现在时**：功能矩阵、质量基线、已知限制、迭代路线。给 LLM agent 的使用说明——执行任何迭代前先通读本文；改架构前先读对应 ADR（§3）；每完成一个迭代回来更新对应小节。
> 逐版本变更见 `CHANGELOG.md`；术语定义见 `../../CONTEXT.md`；文档索引见 `README.md`。

---

## 1. 项目定位（一句话边界）

markpocket 是**单租户自托管**的小团队数据库（Airtable 替代品）：Base → Table → Field / Record / View + 实时协作 + cell 级历史 + CSV 进出 + Agent 接入，**一个 Docker 容器**跑完。从 teable fork 全量重写而来（迁移方案见 `archive/migration/`）。

刻意不做（v1 边界，见 ADR-0001/0003/0004）：多租户/SaaS、百万行性能、OT/CRDT、公式 DSL 依赖图、Lookup/Rollup、Calendar/Gantt、AI/聊天/评论、原生 SQL 暴露。

## 2. 当前状态总览

Airtable P0–P2 已实现：原子 cell writer/七天幂等收据、Grid 粘贴/跨页键盘/字段排序/SQL 全量分组计数、Form 发布与匿名提交、Kanban 独立列分页/移动/详情、Token 当前权限与 scope 交集、Webhook 加密配置/事务 outbox/签名 worker/owner 管理。隔离 PostgreSQL 与组件验证见[证据](release/2026-10-10-p0-p2-evidence.md)。controller 已完成实际浏览器 Grid/Form/Kanban/详情/Token 检查及受限 REST/MCP HTTP fixture；原生 OS clipboard 仍未确认。Webhook 仅用注入 transport，未联系外部接收器。最终同源多人/重连/Form 远端配置、最终候选 fresh/upgrade/restore/缺 key 运行验收仍待完成。真实 Airtable PAT 未提供，live-source 导入仍未验收。本次没有发布或部署。

| 维度 | 状态 |
|---|---|
| 版本 | `1.0.0-alpha.1`（未发 tagged release，master 视作 unstable） |
| v1 核心功能 | **全部完成**（Phase 0–7 + 两轮安全加固 + Agent 接入层） |
| Paper & Ink 重设计 | **收官**（2026-07-03）；设计规范仍是现行 UI 标准（`redesign/2026-07-01-paper-ink-design.md`） |
| 技术栈 | Next.js 16 (App Router) + tRPC v11 + Drizzle + Postgres 16 + ws；Dev 打包器 Rspack（Turbopack 内存泄漏） |
| 部署 | 单 Docker Compose（web + postgres，多阶段镜像）；启动迁移内置于 `server.ts`（pg advisory lock）；dev 拆 `next dev` + 独立 realtime 网关 |
| 插件系统 | plugin-sdk + plugin-csv + plugin-storage-local（ADR-0006..0009） |
| 测试基线 | 旧 550/54 基线已过时；I3 阶段完整 PG-opt-in suite 为 3,457 passed / 13 separately gated skipped，非最终 I6 基线；最终全 gate 由 controller 运行并记录证据 |
| CI | `ci.yml`：format→lint→typecheck→test→build + **e2e job**（真实 Postgres + 生产构建 + API 场景）；`release.yml` 在 `v*` tag 先 verify 再发镜像并做启动冒烟；dependabot 周更 |
| 许可证 | AGPL-3.0 |

## 3. 架构决策索引（ADR 一句话表）

| ADR | 决策 | 反悔代价量级 |
|---|---|---|
| [0001](adr/0001-single-postgres-json-row-storage.md) | 单 Postgres + JSON-row 存储，表设计 <10 万行 | 高（存储模型） |
| [0002](adr/0002-soft-realtime-lww.md) | 软实时：WS 广播 + Last-Write-Wins，无 OT/CRDT | 中 |
| [0003](adr/0003-expression-field-not-formula-dsl.md) | Expression Field：写时求值、单 record 作用域、无依赖图 | 中 |
| [0004](adr/0004-single-tenant-self-hosted.md) | 单租户自托管，一容器一团队 | 高（产品形态） |
| [0005](adr/0005-row-per-cell-query-integrity-contract.md) | 行级 cell 写入契约（empty=DELETE、error=reject） | 中 |
| [0006](adr/0006-plugin-extension-points.md) | 插件扩展点（storage / fieldType 两个真实消费方） | 低 |
| [0007](adr/0007-plugin-loader-and-registries.md) | 插件加载器 + 注册表 | 低 |
| [0008](adr/0008-plugin-server-router-injection.md) | 插件可注入 tRPC 路由（走 CoreServerApi + 角色校验） | 低 |
| [0009](adr/0009-field-type-registry.md) | 字段类型注册表（服务端语义在 Contribution，客户端只有 UI 元数据） | 中 |
| [0010](adr/0010-agent-access-layer.md) | Agent 接入层：REST/MCP/RSS/Skill 四通道复用 tRPC caller；Token 现受 0014 scope 约束 | 低（通道各自独立可拆） |
| [0011](adr/0011-atomic-record-writes.md) | 原子写入与七天幂等收据 | 中 |
| [0012](adr/0012-public-forms.md) | 公开提交 capability、配置绑定与匿名审计 | 中 |
| [0013](adr/0013-kanban-views.md) | Kanban 独立列分页/计数、复用 cell writer | 低 |
| [0014](adr/0014-scoped-agent-tokens.md) | Token Base/access/expiry 与当前角色取交集 | 中 |
| [0015](adr/0015-webhook-outbox.md) | PostgreSQL outbox、加密签名与 owner 恢复 | 中 |

## 4. 功能矩阵（含代码锚点）

状态：✅ 完成 · 🔶 部分/受限 · ⬜ 未做（schema 留位）

| 功能 | 状态 | 主要代码 | 备注 |
|---|---|---|---|
| Base/Table/Field/Record CRUD | ✅ | `server/trpc/routers/{base,table,field,record,cell}.ts` | 全部带角色校验 |
| Grid 视图（filter/sort/group/列宽/隐藏列） | ✅ | `lib/view-query.ts`、`lib/view-ast.ts`、`components/view-config/` | 编译为 SQL 片段 |
| Form 视图 | ✅ | `components/forms/`、`app/forms/[token]/`、`server/forms/` | 本地实现；fixture + controller 浏览器验证；未发布，同源远端配置验证待完成 |
| Kanban 视图 | ✅ | `components/kanban/`、`components/records/` | 本地实现，独立列 50 卡分页；详情浏览器已验证；同源多人运行验收待完成，未发布；见 [说明](KANBAN.md) |
| Gallery 视图 | ⬜ | schema `view.type` 留位 | v2 候选（§9） |
| 字段类型（10 种） | ✅ | `server/plugins/builtin-fields/` | 10 个 Contribution + parity 测试 |
| Expression 字段（写时物化 + 回填） | ✅ | `lib/expression-eval.ts`、`server/expression.ts` | 手写求值器，无第三方公式库 |
| 实时协作（WS + LISTEN/NOTIFY + presence + LWW） | ✅ | `server/realtime/`、`realtime-server.ts` | dev 拆进程，prod 单进程 |
| Cell 级历史 | ✅ | `cell_history` 表、`routers/history.ts` | append-only，base/table 级浏览 |
| 公开分享（只读单视图页） | ✅ | `routers/{share,public-share}.ts`、`app/share/[token]/` | 视图级隔离 + 隐藏字段投影，fail-closed |
| 邀请（48h token、email 匹配） | ✅ | `routers/invite.ts` | 角色上限 editor/viewer |
| 成员与角色（owner/editor/viewer） | ✅ | `lib/roles.ts`、`base_member` 表 | rank 比较，最后 owner 保护 |
| CSV 导入/导出 | ✅ | `packages/plugin-csv/` | 导入 50k 行上限 + 表达式物化；导出在预算内完整返回，每表 ≤100,000 行、每请求 ≤8 MiB，超限失败；CSV 非实例备份；注入中和 |
| Airtable Base 导入 | 🧪 预览版 | `apps/web/src/server/imports/airtable/`、`/bases/import-airtable` | 新建 Base；受控 fixture 与独立 PG 已验证，真实 Airtable PAT 端到端尚未验证；仅 local storage；见 [`AIRTABLE_IMPORT.md`](AIRTABLE_IMPORT.md) |
| 附件上传/下载 | ✅ | `app/api/{upload,files}/`、`packages/plugin-storage-local/` | MIME 白名单 + ACL + 配额；compose `./data` 卷 |
| 鉴权 | ✅ | `server/auth.ts`（better-auth 密码 + 可选 OIDC） | `DISABLE_SIGNUP` 可关注册 |
| 大表分页 + 虚拟滚动 | ✅ | `use-paged-records.ts`、`@tanstack/react-virtual` | 行高 32px |
| **Agent 接入层** | ✅ | `server/agent-access/`、`app/api/{v1,mcp,skill}/`、`app/feed/` | 见 §5 |
| API Token 管理 UI | ✅ | `settings/agent/page.tsx`、`routers/token.ts` | 一次性展示 + 吊销确认 |
| 分组统计 | ✅ | `record.groupCounts`、`lib/view-query.ts` | SQL 全量计数，已加载/总数分开显示 |
| Webhook | ✅ | `routers/webhook.ts`、`server/webhooks/` | owner 管理、加密/签名、事务 outbox；注入 transport 验证，未发布 |

## 5. Agent 接入层（2026-10-03 合入，ADR-0010）

四条机器通道共享一套 Bearer token（`api_token` 表，sha256 摘要存储，**scope 与创建者当前权限的交集**——新 UI 默认当前 Base/read/30 天，旧 token 保留 all/write，降级或移除立即约束后续请求）：

| 通道 | 端点 | 入口代码 |
|---|---|---|
| REST（全量 CRUD + OpenAPI） | `/api/v1/**`、`/api/v1/openapi.json` | `app/api/v1/**/route.ts` |
| MCP（手写 streamable HTTP，21 工具） | `/api/mcp` | `server/agent-access/mcp/` |
| RSS（view 锁定分享的投影） | `/feed/{shareToken}` | `app/feed/[token]/route.ts`、`agent-access/rss.ts` |
| Agent Skill（可安装文档） | `/api/skill` | `agent-access/skill-template.ts` |

- 统一边缘 `agent-access/http.ts`：Origin 校验 → 1MB body 上限（先于认证）→ token 解析 → 每 token 120 req/min 限流（`AGENT_RATE_LIMIT_PER_MIN`，0 关闭）→ 统一错误封包；401 带 `WWW-Authenticate: Bearer`。
- 组合写语义（`records-service.ts`）：create-with-cells / update-cells 逐 cell 收集 `cellErrors`，单请求 ≤200 cells。
- 完整参考：[`api/agent-access.md`](api/agent-access.md)。

## 6. 安全基线（两轮加固 + agent 层，2026-10）

全部读接口有角色校验（viewer 起）；写接口校验 record/field/table 归属一致性；公开分享按视图级隔离 fail-closed（getTables 只返回分享视图的表、隐藏字段数据投影、视图删除即失效）；WS 频道按成员鉴权 + Origin 校验 + 心跳 + 5 分钟成员复验/踢出/订阅限频；附件上传按 MIME 白名单、下载强制 attachment + nosniff + CSP；CSV 导出中和公式注入；storage key 严格校验拒绝路径穿越；cell 值 256KB 上限；view options zod 结构校验（深度/节点数/字节数）；登录回调拒绝协议相对跳转；最后 owner 不可降级/移除；镜像不内置 `BETTER_AUTH_SECRET` 且生产启动强制校验强度；agent 通道限流 + token 只存摘要 + 非 TRPC 错误一律脱敏 500。

## 7. 测试与质量

| 层 | 数量 | 运行 |
|---|---|---|
| vitest 单元 + 集成 | 历史 550/54 已废弃；最终计数待 controller 全 gate | `pnpm test`；PG 需显式 opt-in 隔离数据库 |
| 类型测试 | 2 文件（`*.test-d.ts`） | 同上 |
| API e2e（YAML） | 6 文件 / 56 用例 + 3 env-gated 跳过 | `pnpm test:e2e-api`（需实例运行） |
| 浏览器 e2e（YAML 场景） | 7 场景 | 手动：agent-browser 技能驱动 `tests/e2e/browser/`（未进 CI） |

约定：测试与被测代码同目录；tRPC 集成测试走 createCaller + mock DB（模式见 `testing.md`）；e2e runner 支持 tRPC/auth/通用 `METHOD /path` + Bearer + 断言路径 `$ref`（约定见 `tests/e2e/README.md`）。

## 8. 已知限制（精确清单）

UI/交互：
1. OS clipboard 原生粘贴未由自动化验证；ClipboardEvent + 实际 HTTP 同体重试已验证。
2. 最终同源多人实时、重连与 Form 远端配置验收待完成；不能用跨端口 dev Origin 拒绝代替通过。
3. 待最终 review 分流：操作符标签显示原始 gte；快速切换操作符再编辑值可能使用旧 options；窄屏详情弹窗隐式 grid 行拉伸。未在 I6 顺带修改。
4. viewer 首帧布局等未单独重验的旧 UI 观察不宣称已修复；写操作仍有服务端门禁。

数据语义：
5. 混排 TZ-aware instant 与 naive 日期仍可能按字符串排序。
6. 附件 cell 的跨 Base 引用归属限制未在本轮扩展。
7. Webhook 暂停/溢出/disabled 停止采集，存在真实缺口；需要 owner 全量对账后恢复。交付至少一次，接收方持久去重。

测试/架构：
8. 真实 Airtable PAT 未提供；导入 fixture 不等于 live-source 证明。最终镜像升级/恢复/缺 key 验收仍待执行，已有 M3 准备不是通过。
9. 新增事务与 CSV outbox 路径有真库回归；未覆盖的旧 SQL 路径不宣称全面验收。CSV 故障注入日志及 Vitest experimental 提示仍待最终 review 分流。
10. Agent 限流为进程内计数；单租户部署下不提供多副本共享计数。
11. MCP 为无状态协议子集，无 SSE 推流/会话/批量。

## 9. 迭代路线（候选，按价值排序）

本轮先完成最终同源浏览器、全 gate 与候选镜像 fresh/upgrade/restore/缺 key 验收，再决定发布。真实 Airtable 导入等待受授权测试 PAT。Grid 全量计数/粘贴/翻页/字段排序、Form、Kanban、Token scope 和 Webhook 已实现，不再列为未来功能。

后续候选：feed ETag/Last-Modified 缓存、剩余 UI/旧 SQL 回归、Gallery、S3 storage adapter、Excel/JSON 插件。Lookup/Rollup 若启动需先评估对当前单记录 Expression 边界的改变。

明确不做：多租户（0004）、OT/CRDT（0002）、公式依赖图（0003）、百万行（0001）。

## 10. 文档地图

见 [`README.md`](README.md)。历史文档（teable 迁移方案、SDD 计划与 spec、Paper & Ink 进度跟踪）已归档至 [`archive/`](archive/README.md)，只作溯源，不随代码维护。
