# markpocket 测试体系

## 快速开始

```bash
pnpm test                       # 普通测试（PG 默认跳过；最终候选计数见 release evidence）
pnpm test -- --run src/foo.test.ts   # 单文件
pnpm --filter @markpocket/web typecheck  # 类型检查
pnpm test:e2e-api               # API E2E（需实例运行，见 tests/e2e/README.md）
```

## 测试目录

### 核心单元测试（纯逻辑，无 DB）

| 文件 | 覆盖 |
|------|------|
| `apps/web/src/lib/expression-eval.test.ts` | evaluateExpression / extractDependsOn |
| `apps/web/src/lib/view-query.test.ts` | compileFilter / compileSort / applyGroup（含 SQL 文本真实断言、深度守卫） |
| `apps/web/src/lib/roles.test.ts` | 角色真值表：owner/editor/viewer × 读写门槛 × 非成员 × baseIdFromTable 命中/未命中（22 用例） |
| `apps/web/src/lib/view-ast.test.ts` | view options zod 结构校验（深度/节点数/字节数） |
| `apps/web/src/lib/format.test.ts` / `initials.test.ts` | 共享格式化/首字母模块 |
| `apps/web/src/server/expression.test.ts` | 服务端表达式物化 |
| `apps/web/src/server/realtime/gateway.test.ts` | realtime 网关：鉴权、订阅限频、频道上限、心跳、慢消费者背压（10 用例） |
| `apps/web/src/lib/http-guards.test.ts` | body 上限/流式计数、并发限流器、文件名截断、Disposition、安全回调、Origin 校验 |
| `apps/web/src/server/agent-access/*.test.ts` | token 生命周期、限流、错误映射、records-service 组合语义、RSS 转义、Skill 渲染 |
| `apps/web/src/server/agent-access/mcp/server.test.ts` + `app/api/mcp/route.test.ts` | MCP 握手/工具分发/错误分级/HTTP 边缘 |
| `apps/web/src/app/api/v1/**/route.test.ts` + `app/feed/[token]/route.test.ts` | REST 路由守卫（401/403/413/分页校验）与 feed fail-closed 语义 |
| `apps/web/src/server/plugins/*` | 字段值语义 parity、loader、registry、validate |
| `packages/plugin-csv` / `plugin-sdk` / `plugin-storage-local` | 各包自带单测（含 CSV 注入、BOM、路径穿越） |

### tRPC 集成测试（createCaller + mock DB）

| 文件 | 覆盖 |
|------|------|
| `auth.test.ts` | getSession |
| `base.test.ts` | list/get/create/rename/delete + 权限 |
| `table.test.ts` | CRUD + 默认视图 + 权限 |
| `view.test.ts` | CRUD + filter/sort/group + 权限 |
| `field-record-cell.test.ts` | field/record/cell + 权限 + link 值存在性 + LWW 冲突信号 |
| `field-validation.test.ts` | 字段 options 校验 |
| `share-member-invite.test.ts` | share/member/invite + 权限 |
| `public-share.test.ts` | 公开端点（视图级隔离） |
| `token.test.ts` | API token 创建/一次性展示/列表脱敏/吊销 |
| `export.test.ts` | CSV 导出组装（排序、截断、注入中和） |

### E2E 场景（YAML）

- `tests/e2e/api/` — API 场景，`node tests/run-api-tests.cjs` 执行（已进 CI 的 e2e job；语法未知的 assert 会直接报错，不会静默通过；`$env:`/`requires_env` 等约定见 `tests/e2e/README.md`）
- `tests/e2e/browser/` — agent-browser 浏览器场景 YAML（未进 CI，由 agent 技能手动驱动；曾经配套的 `run-browser-e2e.sh` 已删除——其内嵌断言早已与 YAML 场景脱节）

## tRPC 集成测试的 mock 模式

### 1. mockQuery 链式 thenable

```ts
const chain = mockQuery([]);
vi.mock('@/server/db', () => ({
  db: { select: vi.fn(() => chain), insert: vi.fn(() => chain),
         update: vi.fn(() => chain), delete: vi.fn(() => chain),
         transaction: vi.fn((cb: any) => cb(chain)) },
  sql: { notify: vi.fn().mockResolvedValue(undefined) },
}));
```

### 2. mockRoles 隔离（关键）

```ts
const rolesMock = vi.hoisted(() => ({
  assertRole: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/roles', () => rolesMock);

// permission 测试后必须恢复：
rolesMock.assertRole = vi.fn().mockRejectedValue(new Error('FORBIDDEN'));
await expect(...).rejects.toThrow('FORBIDDEN');
rolesMock.assertRole = vi.fn().mockResolvedValue(undefined);
```

### 3. 其他必须 mock 的模块

- `@/realtime/publish` — publishTableChange / publishBaseChange
- `@/lib/db-queries` — ensureDefaultWorkspace
- `@/lib/expression-eval` — evaluateExpression
- `@/server/plugins/field-value` — normalizeCellValue / parseOptions

## 原则

- 测试与被测代码同目录（`*.test.ts`）
- 每次 commit 前跑 `pnpm test`
- 新 router 必须带集成测试
- permission 测试前后显式恢复 mock
## P0–P2 isolation and acceptance

Real PostgreSQL suites require `P0_P2_PG_TEST=1` and an explicitly supplied dedicated `DATABASE_URL` whose database name starts `markpocket_p0p2_`. Never target an existing instance. Run the relevant `*.pg.test.ts` with `pnpm exec vitest run`; a skipped suite is not acceptance evidence. Webhook tests scope worker/cleanup to their owned subscription and inject transport; they never start a production sender or contact a receiver. Management tests cover actual locks, current owner roles, lease invalidation, retry, overflow recovery and redacted projections.

The former 550-test baseline is historical. Subsystem test results and actual controller browser/HTTP checks are recorded in [P0–P2 evidence](release/2026-10-10-p0-p2-evidence.md); final full-suite, production build, same-origin realtime and image recovery checks remain pending until the controller records their results. Expected CSV fault-injection logs and the Vitest experimental typecheck notice are not evidence of a new application failure, nor have they been silently removed. Live Airtable source verification needs an authorized PAT.
