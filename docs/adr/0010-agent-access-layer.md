# ADR-0010：Agent 接入层（API Token + REST/MCP/RSS/Skill 四通道）

**状态**：Accepted

**日期**：2026-10-03

**相关**：ADR-0004（单租户自托管）、ADR-0005（行级 cell 写入契约）、docs/api/agent-access.md、`apps/web/src/server/agent-access/`

## 背景

markpocket 的全部对外能力只有浏览器 UI（tRPC + cookie 会话）。要让 AI agent 与脚本使用实例的数据，需要一个机器友好的接入层。评审时确定的四条通道：

1. **REST API**（`/api/v1`）——脚本与工具链的通用面，附 OpenAPI 3.1 文档（`/api/v1/openapi.json`）
2. **MCP**（`/api/mcp`）——Claude Code / Cursor 等交互式 agent 客户端的原生协议
3. **RSS**（`/feed/{shareToken}`）——只读订阅面
4. **Agent Skill**（`/api/skill`）——给 agent 安装的"使用说明书"文档

用户决策：token 与创建者同权；v1 即全量 CRUD（Base/Table/Field/View/Record 五实体）；MCP 手写最小实现。

## 决策

1. **认证：`api_token` 表 + Bearer token，与用户同权。** token 明文 `mpk_` + 24 字节随机 hex（192-bit），仅在创建响应中出现一次；库里只存 sha256 hex（唯一索引）。解析时哈希后按索引查行，天然常数时间（无逐行比较）；吊销 = `revokedAt` 软删（保留摘要行，杜绝与历史 token 撞库）。**没有 scope 模型**：合成会话 `{ session: { user: { id } } }` 后，每条业务过程内的 `assertRole`/`assertTableRole` 原样执行——token 的权限边界就是创建者的成员关系与角色，不多不少。

2. **复用 tRPC caller，不复制业务逻辑。** `appRouter.createCaller({ session: { user: { id } } })`（`agent-caller.ts`）让 REST 路由和 MCP 工具直接调用现有过程。已验证：没有任何过程或其依赖在过程体内自行调用 `headers()`/`cookies()`。新增的组合语义（带值建记录、整记录更新）收敛在 `records-service.ts`：`record.create` + N×`cell.upsert`，逐 cell 收集错误（`cellErrors`）而非整体失败——记录已存在，"3/4 个 cell 写入成功"比整体回滚对 agent 更有用。单请求 cell 数上限 200（每 cell 一事务，防止单进程部署被巨请求拖死）。

3. **统一 HTTP 边缘（`agent-access/http.ts`）。** 所有 agent 端点过同一道闸：Origin 校验（复用 tRPC 路由规则，提炼为 `http-guards.ts` 的纯函数）→ body 上限（`MAX_API_BODY_BYTES = 1MB`，Content-Length 快路径 + chunked 计流）→ token 解析 → 按 token id 的固定窗口限流（`AGENT_RATE_LIMIT_PER_MIN`，默认 120/分钟，0 = 关闭）。顺序有意为之：body 上限先于认证（未认证请求不能烧内存），限流按已解析 token 计键（伪造 Authorization 头逃不掉）。401 带 `WWW-Authenticate: Bearer`（MCP 客户端的约定）。

4. **MCP 手写最小 streamable HTTP，不引入官方 SDK。** 决定性原因：`@modelcontextprotocol/sdk` peer 依赖 zod 3，本项目全线 zod 4（schema 用 `z.toJSONSchema` 导出，零 shim）。实现为无状态子集：`initialize`（协议版本回显，支持 2024-11-05/2025-03-26/2025-06-18）/ `ping` / `tools/list` / `tools/call` / notifications（202 空体）；GET（SSE 推流）与 DELETE（会话终止）按规范允许返回 405；不支持批量（数组）请求。工具执行失败按规范返回 `isError: true` 的 result（模型可读原因），协议层错误（未知工具/参数不合法）才是 JSON-RPC error。工具集与 REST 面一一对应（21 个），两者走同一 caller——行为与权限不可能漂移。

5. **RSS 挂在 `base_share` 上，不建新表。** 复用 `findLiveShare`/`findSharedView`（从 public-share 路由导出）——过期、视图被删、存储的视图配置不再合法，全部 fail-closed 404，与分享页同一套语义。**只允许 viewId 锁定的分享出 feed**：feed 是无认证拉取面，"整个 base"比任何单一视图的 filter 都宽。视图的 filter/隐藏字段投影生效，但排序固定为创建时间倒序（feed 是"有什么新东西"的面）。XML 转义（五实体 + 剔除 XML 1.0 非法控制字符）与行数/长度截断在纯函数 `rss.ts` 中实现并单测。

6. **Skill 是渲染产物，不是静态文件。** `skill-template.ts` 以请求 origin 插值生成（Docker standalone 镜像不携带源文件树）；端点公开——文档不含数据，token 才是闸门。

## 后果

**正面**

- 四通道共享一套认证、限流、错误封包与业务/权限逻辑；新增通道只是新路由文件
- token 与用户同权使权限模型零新增（无 scope 矩阵要维护、要测试、要解释）
- 零新依赖（MCP 手写 + zod 4 原生 JSON Schema），与"own your complexity"一致
- RSS 复用分享 token：用户已有心智模型（"分享链接 = 只读视图"），feed 是它的另一个投影

**负面**

- token 泄漏即全权（无最小权限选项）——用吊销补救；若未来需要只读/按 base 收窄，`api_token` 要加列，解析路径要加检查
- 合成会话依赖"过程不读 headers()"这一隐式约束；未来某过程若直接调用 `headers()`，agent 通道会在该过程上静默偏离——靠 code review 把关
- 限流器是进程内 Map（同 `createUserConcurrencyLimiter` 的既有取舍）：多副本部署会按副本各自计数
- MCP 是协议子集：没有 SSE 推流、没有会话、不支持批量与 resources/prompts 能力；协议演进（如新必需方法）需要跟进手写实现

## 备选方案

- **官方 MCP SDK**：协议兼容性最有保障，但 zod 3 peer 依赖与本仓库 zod 4 冲突，需要双版本共存 shim；且其传输抽象（session、SSE）对本用例（无状态、单 POST）过重。放弃。
- **token 加 scope 模型（只读开关 / 按 base 绑定）**：更细的权限面，但需要 scope 矩阵的 schema、解析路径检查、UI 与文档全套成本；v1 用户决策为同权。作为未来扩展位（`api_token` 加列 + resolve 时检查）。
- **REST 直接查库而非走 caller**：性能略好，但复制了角色校验与写入语义（cell 归一化、历史、realtime 广播）——两套逻辑必然漂移。放弃。
- **RSS 建独立 feed_token 表**：可独立过期控制，但两个相似 token 表 + 两套失效语义；复用分享 token 让"分享"与"订阅"是同一个授权动作。放弃。
- **RSS 允许未锁视图的 base 级分享（需 tableId 参数）**：表达力更强，但把"全库只读"暴露给无认证 GET 面，超出用户创建分享链接时的预期。放弃。

## 反悔代价

- 换认证模型（如同权 → scope）：`api_token` 加列 + `resolveBearerToken` 加检查 + 迁移，约半天；REST/MCP 路由无需改（权限在过程内收敛）
- 换 MCP 实现为 SDK：`mcp/` 目录整体替换（tools.ts 的工具定义可平移为 SDK schema），路由不动，约 1-2 天 + 依赖治理
- RSS 换独立 token 表：新表 + feed 路由换数据源 + UI 一节，约半天
- 整层移除：删 `server/agent-access/`、`api/v1|mcp|feed|skill` 路由、`token` 路由与 Agents 页 + 一个 drop-table 迁移
