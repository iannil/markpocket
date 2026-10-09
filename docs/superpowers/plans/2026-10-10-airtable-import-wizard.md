# Airtable Import Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 登录用户通过预检页面将小型 Airtable Base 的基础字段、附件和关联导入新 Base，并获得可重试、可取消的明确结果。

**Architecture:** 安全且有预算的 Airtable source client + 纯字段映射 + 原子DB importer/local-file journal + protected tRPC + React向导。完成回执提供幂等性，进程状态仅用于短时进度/取消；不引入队列。

**Tech Stack:** Next16/tRPC11/Drizzle/Vitest、Node原生HTTPS/DNS、PostgreSQL16、本地storage plugin。

**Spec:** `docs/superpowers/specs/2026-10-10-airtable-import-wizard.md`

## Global Constraints

- Node >=22；pnpm 10.32.1；PostgreSQL 16；沿用 Next.js 16、tRPC 11、Drizzle、Vitest。
- 单租户自托管；不引入多租户、计费系统、任务队列或新运行时依赖。
- 不改 ADR-0001/0003/0004 的规模、Expression Field 与部署边界。
- 插件不得导入应用的 @/ 路径；通过 CoreServerApi 注入主机能力。
- 所有导出至少要求 viewer 权限；错误不得返回部分文件或泄露数据库信息。
- CSV 是数据交换格式，不是完整备份；附件二进制、权限、历史通过实例备份保存。
- 保留用户已有的 .gitignore 修改与 CLAUDE.md 删除；不恢复、不提交这些变更。
- 仅编写计划不代表已实施、测试通过或发布；执行计划不自动授权推送 tag 或发布镜像。

---

## 文件结构与共享契约

`apps/web/src/server/imports/airtable/` 集中source类型、网络边界、映射、journal、事务和生命周期。每文件单一责任，避免把整个实现堆在router。新字段使用现有FieldType值；选择ID/关联ID/附件ID遵循已有UI格式。

```ts
export type ImportIssue = { tableId: string; fieldId: string; kind: 'snapshot' | 'skip'; message: string };
export type ImportReport = {
  requestId: string; sourceBaseId: string; baseId: string;
  tables: { sourceId: string; targetId: string; name: string; records: number }[];
  records: number; cells: number; attachments: number; attachmentBytes: number;
  issues: ImportIssue[];
};
export type ImportInput = {
  requestId: string; sourceBaseId: string; token: string; name: string;
  schemaHash: string; acceptLosses: boolean;
};
export type ImportProgress = { phase: 'schema' | 'records' | 'attachments' | 'writing'; records: number; attachments: number };
```

client/model task自行定义并导出严格的AirtableSchema/AirtableRecord/Preflight类型，report以上命名固定。source interface由Task1导出供Task2依赖注入，不把测试网络开关加入生产输入：

```ts
export interface AirtableSource {
  schema(baseId: string, token: string, signal: AbortSignal): Promise<AirtableSchema>;
  records(baseId: string, tableId: string, token: string, signal: AbortSignal): AsyncIterable<AirtableRecord[]>;
  attachment(url: string, signal: AbortSignal): Promise<Buffer>;
}
```

## Task 1：安全source client和纯映射

**Files:** 新建 `apps/web/src/server/imports/airtable/types.ts`, `network.ts`, `client.ts`, `mapping.ts`，相应 `*.test.ts`（可为清晰边界拆分limits/errors文件）。

**Interfaces:** consumes源API schema/records；produces AirtableSource、`preflight(schema): Preflight`（含schemaHash,tables,issues）、field/value mapping helpers及上面的共享类型。

- [ ] Step 1：先写网络与映射失败测试。fixture至少包含两个表（tblPeople/tblTeams）、选择选项、关联、附件、checkbox omittedfalse、formula结果。URL用 `https://v5.airtableusercontent.com/file`；攻击cases至少如下，使用resolver/transport注入，不发真实外网请求。

```ts
it.each(['http://v5.airtableusercontent.com/a', 'https://airtableusercontent.com.evil.test/a',
 'https://user:pass@v5.airtableusercontent.com/a', 'https://127.0.0.1/a',
 'https://v5.airtableusercontent.com:444/a'])('rejects URL %s', async url => {
  await expect(validateAttachmentUrl(url)).rejects.toThrow();
});
// Separate injected resolver tests: 127.0.0.1, 10.0.0.1, 169.254.169.254,
// ::1, ::ffff:127.0.0.1, fc00::1, fe80::1, multicast/reserved; mixed public/private fails.
```

- [ ] Step 2：运行 `pnpm exec vitest run apps/web/src/server/imports/airtable` 确认缺实现失败。实现Node HTTPS固定地址lookup、TLS hostname、boundedstream、abort/deadline、redirect拒绝；API域名固定、PAT只发API、附件无Authorization。只在network层允许测试注入resolver/request，运行时接口不允许调用方传URLhost。
- [ ] Step 3：实现schema严格解析、records分页（offset去重、recordID重复拒绝、字段ID键）、共享预算及速率/重试。所有上游异常转换成安全错误码/消息，禁止把body/URL/token带入cause日志。真正累计流字节，不只看声明长度。创建source实例时绑定全程120秒signal/预算；默认每页100、API间隔250ms、429重试1次等待30秒、5xx重试2次。
- [ ] Step 4：实现纯preflight/hash/映射。所有规格类型有明确表；options单选/多选choices最多200、name100、ID64、颜色映射成已有合法palette默认色；关联要求targetTable在schema内。静态计算字段追加snapshot标记，复杂结果JSON.stringify；未知字段返回skip issue。来源列命名不冲突。返回前校验records的非空值，遇unknownchoice、danglinglink或invaliddate/number明确失败。
- [ ] Step 5：补充真实意义测试：101条两页、有重复offset/record、限额恰好及超1、metadata超限、分块附件超限、重试耗尽/取消、token未转发/未出现在错误、choice名称→ID、false保留、空表、sourceid、schemahash变化。
- [ ] Step 6：运行focused tests + web typecheck + changed-files lint/format，提交 `feat: add bounded Airtable source and mapping`。报告精确列出exports及fixtures，供Task2使用。

## Task 2：原子导入、回执与文件恢复

**Files:** 新建 `apps/web/src/server/imports/airtable/importer.ts`, `journal.ts`, `service.ts`, `importer.pg.test.ts`, `journal.test.ts`, `service.test.ts`；修改 `apps/web/src/server/db/schema.ts`；生成现有drizzle目录中的新迁移及snapshot；新建 `apps/web/scripts/cleanup-airtable-imports.ts`。

**Interfaces:** consumes Task1 AirtableSource/preflight/映射；produces：

```ts
export function preflightImport(userId: string, sourceBaseId: string, token: string): Promise<Preflight>;
export function startImport(userId: string, input: ImportInput): Promise<ImportReport>;
export function importStatus(userId: string, requestId: string): Promise<
 { status: 'running'; progress: ImportProgress } | { status: 'complete'; report: ImportReport } | { status: 'not-running' }>;
export function cancelImport(userId: string, requestId: string): Promise<{ cancelled: boolean }>;
```

- [ ] Step 1：写PG用例（仅 `IMPORT_PG_TEST=1`加载db），使用独立fixture user和defaultworkspace。执行同一requestId两次断言只有一个目标Base，第二次无需source/PAT；并发同key也只有一个。测试rollback不留Base/records/receipt；所有query限定fixtureIDs，禁止清库。
- [ ] Step 2：新增receipt schema（UUID requestId PK、userId text、sourceBaseId text、baseId text FK cascade、report jsonb、createdAt），用 `pnpm db:generate` 生成真实迁移，不手写既有snapshot。测试环境先migrate再验证。
- [ ] Step 3：实现下载/校验→DB事务两阶段。先查本用户回执，避免成功重试重复网络；activeMap单进程槽无token。schemaHash不符或issues未确认拒绝。20tables/100fields/10000records/100000cells/16MiB records/200attachments/10MiB each/64MiB total按spec执行。复用localProvider，不导入plugins barrel造成循环。
- [ ] Step 4：事务锁requestId、再查receipt；创建Base+owner、tables+gridviews+fields、来源列、全部recordIDs，后写cells/link/attachmentmetadata；每批250并检查signal。schema options保留source IDs；空checkbox按false语义处理。插入receipt与data原子提交。aftercommit只发布一次basechange，通知失败不得把已成功导入报失败。
- [ ] Step 5：实现journal先于put，权限0700/0600、合法随机storagekeys、取消/普通错误清理；commit结果未知时先查receipt再决定是否清理，数据库仍不可用时保留journal并给可执行恢复指引。cleanup脚本只操作专属journals，逐个advisorylock查receipt，保留已提交附件。文件读取不能跟随恶意symlink/路径；损坏journal报错不擅自删除。报告测试覆盖进程残留模拟、remove失败、提交不确定与恢复保护。
- [ ] Step 6：生命周期测试验证其他用户不能status/cancel/获取回执；slot在成功/错误/abort释放，deadline覆盖网络和写入；取消提交边界返回真实已完成状态。错误message不泄露DB或token。
- [ ] Step 7：真实PG两表关联+本地临时附件校验、sourceID列、幂等重试、rollback及journal cleanup通过；focused单测/typecheck/lint/format通过后提交 `feat: import Airtable bases atomically with recovery receipts`。

## Task 3：受保护接口与页面向导

**Files:** 新建 `apps/web/src/server/trpc/routers/airtable-import.ts` 及测试；修改 `apps/web/src/server/trpc/router.ts`；新建 `apps/web/src/app/bases/import-airtable/page.tsx`（组件可拆到同目录）；修改现有Workspace列表页及空态入口；新增页面交互测试。

**Interfaces:** consumes Task2 functions；produces protected `airtableImport.preflight/start/status/cancel` 和 `/bases/import-airtable`，沿用已有trpc hook/auth/错误展示。

- [ ] Step 1：router测试验证protected身份转发、UUID/baseId/token/name/hash格式与长度（token最多1024/name64），status/cancel不可传userId。预检和start必须mutation避免PAT进入GET URL；只由ctx.session获取user。
- [ ] Step 2：实现router薄层，无网络/DB逻辑复制；status只读query。所有返回报告不含token或附件下载URL。普通DB异常不得泄露到用户。
- [ ] Step 3：写页面测试：预检之前无法start；issues未确认无法start；请求携带当前hash/requestId；运行可cancel；成功清token显示Base链接；错误清token，同requestId重试；刷新只恢复requestId，无PAT持久化。按照现有testing-library依赖mock trpc边界测试交互，不断言内部实现细节。
- [ ] Step 4：页面用password input、form methodpost及clientstate，显示scope指导、容量、快照限制、静态/跳过列表；创建按钮明确新Base。真实phase/count轮询status，无假的百分比。完成显示counts/issues及report JSON下载，取消显示待确认状态，只有server报告complete才显示成功。
- [ ] Step 5：从Workspace正常/空态添加入口；不可让动态 `/bases/[baseId]` 路由误解析；登录门禁与现有layout一致。检查键盘提交、错误提示、loadingdisabled和取消不被主mutation disabled一起禁用。
- [ ] Step 6：focused router/page tests、typecheck/lint/format通过后提交 `feat: add Airtable import wizard`。

## Task 4：隔离验收与迁移指南

**Files:** 新建 `docs/AIRTABLE_IMPORT.md`, `docs/release/2026-10-10-airtable-import-evidence.md`；修改 README双语、docs/README、STATUS、CHANGELOG；可按实际发现修正实现。

**Interfaces:** consumes完整向导/迁移服务；produces可复查证据和用户指南，不发布。

- [ ] Step 1：启动独立PG16/独立本地storage，不复用dev7400的数据；migrate验证receipt结构。用可控Source依赖注入完成真库两表/101rows/选择/false/跨表关联/附件、retry/cancel/权限/journal测试。生产sourceclient不能有用户可控endpoint/fixture开关。
- [ ] Step 2：真实浏览器验证入口、输入、preflight错误、unsupported确认、loading/cancel、结果链接、报告下载；成功路径可使用测试harness注入source，但明确标注为fixture验证。无真实PAT时“真实Airtable端到端迁移未验证”必须出现于最终报告，不构造外网通过证据。
- [ ] Step 3：指南写PAT最小scopes+单Base授权、源端停写、容量、字段映射表、静态值/跳过项、取消/重试/requestId、journal恢复命令及仅localstorage支持；禁止宣称完全兼容/稳定版。明确PAT不持久化，反向代理日志须避免记录请求体。
- [ ] Step 4：运行 `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `env -u DATABASE_URL pnpm test`, 带buildplaceholderenv的 `pnpm build`；真库test单独执行并记录counts。只在新增schema迁移后的独立实例跑现有APIe2e。记录实际结果和未验证范围。
- [ ] Step 5：停止仅本任务测试实例，保留证据。提交 `docs: document and verify Airtable import wizard`，不合并/推送/发布。

## 自检

网络与凭据→Task1/3；字段及来源ID→Task1/2；关联附件→Task2；重试/取消/清理→Task2/3；页面向导→Task3；真实PG与浏览器/限制披露→Task4。所有共享接口均在本文或Task1定义，Task1报告必须提供后续所需的精确mapping API。本计划不扩展C/D。
