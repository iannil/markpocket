# markpocket 测试体系

## 快速开始

```bash
pnpm test                       # 全部测试（~110 个，<1s）
pnpm test -- --run src/foo.test.ts   # 单文件
pnpm --filter @markpocket/web typecheck  # 类型检查
```

## 测试目录

### 核心单元测试（纯逻辑，无 DB）

| 文件 | 覆盖 |
|------|------|
| `apps/web/src/lib/expression-eval.test.ts` | evaluateExpression / extractDependsOn |
| `apps/web/src/lib/view-query.test.ts` | compileFilter / compileSort / applyGroup |
| `apps/web/src/lib/roles.test.ts` | baseIdFromTable |

### tRPC 集成测试（createCaller + mock DB）

| 文件 | 覆盖 |
|------|-------|
| `auth.test.ts` | getSession |
| `base.test.ts` | list/get/create/rename/delete + 权限 |
| `table.test.ts` | CRUD + 默认视图 + 权限 |
| `view.test.ts` | CRUD + filter/sort/group + 权限 |
| `field-record-cell.test.ts` | field/record/cell + 权限 |
| `share-member-invite.test.ts` | share/member/invite + 权限 |
| `public-share.test.ts` | 公开端点 |

### E2E 场景（YAML）

- `tests/e2e/api/` — API 场景，`run-api-tests.cjs` 可执行
- `tests/e2e/browser/` — agent-browser 浏览器场景

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