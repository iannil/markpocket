# Plan 2：Server Router + UI Slot 扩展点（CSV 插件）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 落地 Server Router + UI Slot 两个扩展点，把 CSV 导入导出从 Next REST 路由迁为 `@markpocket/plugin-csv`（tRPC 文本传输 + 客户端 UI Slot），建立「插件即真 npm 包」的 server/client 拆分与核心服务注入模式。

**Architecture（已由 spike 验证）:** SDK 提供一个 tRPC 运行时（`initTRPC.context<PluginContext>().create()`，`PluginContext` 为结构化 `{ session: { user: { id: string } } | null }`）；插件从 SDK import `router / publicProcedure / protectedProcedure`，用自己的实例建 router。该 router 合并进 app 的 `appRouter` 后，client 的 `trpc.csv.*` 输入输出类型完整流通（spike 已用 protected + zod input + `ctx.session.user.id` 验证：0 error，且改错字面量会报错）。核心数据服务（db/schema/queries/fieldTypes）经 `CoreServerApi` 注入，插件不 import `@/`。UI Slot 走客户端注册表 + `<Slot>`，插件按 `./server` / `./client` 子路径导出物理隔离两侧。

**Tech Stack:** TypeScript (ESM, moduleResolution Bundler), pnpm workspace, Vitest, Next.js 16, tRPC 11, Drizzle, zod 4。

## Global Constraints

- Node >=22；ESM；包不经构建（main/types/exports → `src/*.ts`）。
- 第一方插件 `packages/plugin-*`，包名 `@markpocket/plugin-*`，version `0.0.0`，private。
- 测试文件用相对或 workspace 包名导入，**不用 `@/` 别名**。
- 插件**不得** import `@/`；核心服务只能经 `CoreServerApi` 注入或从 `@markpocket/plugin-sdk` 取。
- 不改 ADR-0001~0005（数据模型、row-per-cell、值语义、一致性）。CSV 迁移必须保持与旧 REST 路由**相同的降级语义**（link/attachment/user/expression 字段导入导出时跳过/空）。
- 单引号、2 空格缩进；pre-commit 自动跑 prettier+eslint。
- 提交信息结尾附：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 编译期捆绑：装插件 = 改 `plugins.config.ts`(server) / `plugins.client.ts`(client) + rebuild。

---

### Task 1: SDK tRPC 运行时（`@markpocket/plugin-sdk/trpc`）

**Files:**
- Modify: `packages/plugin-sdk/package.json`（加 `@trpc/server` dep + `./trpc` 子路径导出）
- Create: `packages/plugin-sdk/src/trpc.ts`
- Test: `packages/plugin-sdk/src/trpc.test.ts`

**Interfaces:**
- Produces: from `@markpocket/plugin-sdk/trpc` — `interface PluginContext { session: { user: { id: string } } | null }`; `router` (= `t.router`); `publicProcedure` (= `t.procedure`); `protectedProcedure` (asserts `ctx.session` non-null, narrows to `{ session: { user: { id: string } } }`).

- [ ] **Step 1: package.json 加依赖与子路径导出**

`packages/plugin-sdk/package.json`：在 `exports` 加 `"./trpc": "./src/trpc.ts"`；在（新增）`dependencies` 加 `"@trpc/server": "^11.18.0"`。最终 `exports`：
```json
"exports": { ".": "./src/index.ts", "./trpc": "./src/trpc.ts" }
```

- [ ] **Step 2: `pnpm install`**

Run: `pnpm install` — Expected: `@trpc/server` 链接进 plugin-sdk。

- [ ] **Step 3: 写失败测试 `packages/plugin-sdk/src/trpc.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { protectedProcedure, publicProcedure, router, type PluginContext } from './trpc';

describe('sdk trpc runtime', () => {
  it('builds a router whose public procedure runs via caller', async () => {
    const r = router({ ping: publicProcedure.query(() => 'pong') });
    const caller = r.createCaller({ session: null } satisfies PluginContext);
    expect(await caller.ping()).toBe('pong');
  });

  it('protectedProcedure rejects when session is null', async () => {
    const r = router({ me: protectedProcedure.query(({ ctx }) => ctx.session.user.id) });
    const caller = r.createCaller({ session: null } satisfies PluginContext);
    await expect(caller.me()).rejects.toThrow(/UNAUTHORIZED|Not signed in/);
  });

  it('protectedProcedure exposes session.user.id when present', async () => {
    const r = router({ me: protectedProcedure.query(({ ctx }) => ctx.session.user.id) });
    const caller = r.createCaller({ session: { user: { id: 'u1' } } });
    expect(await caller.me()).toBe('u1');
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm exec vitest run trpc` — Expected: FAIL（`Cannot find module './trpc'`）。

- [ ] **Step 5: 实现 `packages/plugin-sdk/src/trpc.ts`**

```ts
import { initTRPC, TRPCError } from '@trpc/server';

// 结构化插件上下文：app 的真实 session（better-auth）结构上可赋值给它。
export interface PluginContext {
  session: { user: { id: string } } | null;
}

const t = initTRPC.context<PluginContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not signed in' });
  }
  return next({ ctx: { session: ctx.session } });
});
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm exec vitest run trpc` — Expected: PASS（3 用例）。

- [ ] **Step 7: 提交**

```bash
git add packages/plugin-sdk pnpm-lock.yaml
git commit -m "feat(sdk): 插件 tRPC 运行时 —— PluginContext + router/procedure

@markpocket/plugin-sdk/trpc 导出结构化 PluginContext 与 router/public/
protected procedure；插件用它建自有实例的 router，合并进 app appRouter 后
client 类型完整流通（spike 已验证）。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: SDK 的 CoreServerApi / 工厂 / slot 贡献类型

**Files:**
- Modify: `packages/plugin-sdk/src/index.ts`
- Test: `packages/plugin-sdk/src/core-api.test-d.ts`（类型层测试，用 vitest `expectTypeOf`）

**Interfaces:**
- Produces（from `@markpocket/plugin-sdk`）:
  - `interface CoreServerApi { db: unknown; schema: CoreSchema; queries: CoreQueries; fieldTypes: CoreFieldTypes }`（见下，db/schema 用务实宽松类型，见说明）
  - `type ServerRouterFactory<TRouter> = (core: CoreServerApi) => TRouter`
  - `interface UiSlotContribution { slotId: string; Component: unknown }`（client 组件类型在客户端侧收紧）

> **db/schema 类型说明（务实决策）**：`CoreServerApi.db` 类型为 `DrizzleLike`（最小结构：`insert`/`select` 方法签名足够 CSV 用），`schema` 为描述 CSV 用到的 `record/cell/field/table` 表对象的接口。目的是让插件内 drizzle 查询有足够类型而 SDK 不 import app schema。若结构赋值过于繁琐，`db: any` + `schema: any` 是允许的退路——**client 面向的 tRPC I/O 类型不受影响**（那由 Task 1 的运行时保证）。实现者按能编译的最简形态取舍，并在 report 说明选了哪种。

- [ ] **Step 1: 扩展 `packages/plugin-sdk/src/index.ts`（追加，不动已有导出）**

```ts
// --- Server Router 扩展点：核心服务注入 ---

// 最小 drizzle 面（够 CSV 用；宽松以避免 SDK 依赖 app schema）。
export interface DrizzleLike {
  insert: (table: unknown) => {
    values: (v: unknown) => { returning: () => Promise<unknown[]>; execute?: () => Promise<unknown> } & Promise<unknown>;
  };
  select: (fields?: unknown) => any;
}

export interface CoreSchema {
  record: unknown;
  cell: unknown;
  field: unknown;
  table: unknown;
}

export interface CoreQueries {
  listRecordsPivoted: (
    tableId: string,
    opts: { where?: unknown; orderBy?: unknown },
    offset?: number,
    limit?: number,
  ) => Promise<Array<{ id: string; cells: Record<string, unknown> }>>;
}

export interface CoreFieldTypes {
  FieldType: Record<string, string>;
  formatNumberToString: (n: number, opts: { precision?: number }) => string;
  parseStringToNumber: (input: string) => number | null;
}

export interface CoreServerApi {
  db: DrizzleLike;
  schema: CoreSchema;
  queries: CoreQueries;
  fieldTypes: CoreFieldTypes;
}

export type ServerRouterFactory<TRouter> = (core: CoreServerApi) => TRouter;

// --- UI Slot 扩展点（client 组件类型在客户端侧收紧为 React 组件）---
export interface UiSlotContribution {
  slotId: string;
  Component: unknown;
}
```

> 若实现者选择 `db: any`/`schema: any` 退路，则删去 `DrizzleLike`/`CoreSchema` 的结构、用 `db: unknown`/`schema: Record<string, unknown>`，其余不变。

- [ ] **Step 2: 类型测试 `packages/plugin-sdk/src/core-api.test-d.ts`**

```ts
import { expectTypeOf, test } from 'vitest';

import type { CoreServerApi, ServerRouterFactory } from './index';

test('ServerRouterFactory receives CoreServerApi', () => {
  type F = ServerRouterFactory<{ ok: true }>;
  expectTypeOf<F>().parameter(0).toMatchTypeOf<CoreServerApi>();
});

test('CoreServerApi exposes queries.listRecordsPivoted', () => {
  expectTypeOf<CoreServerApi['queries']['listRecordsPivoted']>().toBeFunction();
});
```

- [ ] **Step 3: 跑测试确认通过（类型测试无需先失败）**

Run: `pnpm exec vitest run core-api` — Expected: PASS。
Run: `pnpm exec vitest run` — Expected: 全绿（不回归）。

- [ ] **Step 4: 提交**

```bash
git add packages/plugin-sdk
git commit -m "feat(sdk): CoreServerApi 注入类型 + ServerRouterFactory + UiSlot 贡献

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: app 侧 CoreServerApi 构造（`core-api.ts`）

**Files:**
- Create: `apps/web/src/server/plugins/core-api.ts`
- Test: `apps/web/src/server/plugins/core-api.test.ts`

**Interfaces:**
- Consumes: `CoreServerApi`（Task 2）；`db`（`@/server/db`）；schema（`@/server/db/schema`）；`listRecordsPivoted`（`@/lib/db-queries`）；`FieldType`（`@/lib/field-types`）；`formatNumberToString`/`parseStringToNumber`（`@/lib/format-number`）。
- Produces: `export const coreServerApi: CoreServerApi`。

- [ ] **Step 1: 写失败测试 `core-api.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { coreServerApi } from './core-api';

describe('coreServerApi', () => {
  it('exposes db, schema tables, queries, fieldTypes', () => {
    expect(coreServerApi.db).toBeDefined();
    expect(coreServerApi.schema.record).toBeDefined();
    expect(coreServerApi.schema.cell).toBeDefined();
    expect(coreServerApi.schema.field).toBeDefined();
    expect(coreServerApi.schema.table).toBeDefined();
    expect(typeof coreServerApi.queries.listRecordsPivoted).toBe('function');
    expect(typeof coreServerApi.fieldTypes.parseStringToNumber).toBe('function');
    expect(coreServerApi.fieldTypes.FieldType.Number).toBe('number');
  });
});
```

> 该测试 import `@/server/plugins/core-api`，其传递依赖 `@/server/db` 会尝试建 pg 连接。若 vitest 里 import db 触发连接错误，实现者需在测试用 `vi.mock('@/server/db', ...)` 打桩 db（`{ db: {} }`），并在 report 说明。`@/` 别名在 vitest 中需要 alias 配置——若缺，实现者在 `vitest.config.ts` 加 `resolve.alias { '@': <apps/web/src 绝对路径> }`（用 `new URL`/`fileURLToPath`，禁用 `Date.now`/`Math.random` 无关）。这是本 Task 允许的基础设施改动。

- [ ] **Step 2: 实现 `apps/web/src/server/plugins/core-api.ts`**

```ts
import type { CoreServerApi } from '@markpocket/plugin-sdk';

import { cell, field, record, table } from '@/server/db/schema';
import { db } from '@/server/db';
import { FieldType } from '@/lib/field-types';
import { formatNumberToString, parseStringToNumber } from '@/lib/format-number';
import { listRecordsPivoted } from '@/lib/db-queries';

// app 侧组装注入给插件的核心服务。插件不 import @/，只收此对象。
export const coreServerApi: CoreServerApi = {
  db: db as CoreServerApi['db'],
  schema: { record, cell, field, table },
  queries: { listRecordsPivoted },
  fieldTypes: { FieldType, formatNumberToString, parseStringToNumber },
};
```

- [ ] **Step 3: 跑测试**

Run: `pnpm exec vitest run core-api` — Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web vitest.config.ts
git commit -m "feat(plugins): app 侧 CoreServerApi 构造（注入 db/schema/queries/fieldTypes）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: CSV 插件 server（`@markpocket/plugin-csv/server`）

**Files:**
- Create: `packages/plugin-csv/package.json`
- Create: `packages/plugin-csv/src/csv.ts`（纯函数：parse / serialize，无核心依赖）
- Create: `packages/plugin-csv/src/server.ts`（router 工厂）
- Test: `packages/plugin-csv/src/csv.test.ts`（纯函数单测）

**Interfaces:**
- Consumes: `@markpocket/plugin-sdk/trpc`（`router`/`protectedProcedure`）；`@markpocket/plugin-sdk`（`CoreServerApi`, `ServerRouterFactory`）；`zod`；`drizzle-orm`（`eq`）。
- Produces: default export `ServerRouterFactory<CsvRouter>`，`CsvRouter` = `router({ import: mutation({tableId,csvText}) => {imported:number}, export: query({tableId}) => {csv:string} })`。纯函数 `parseCsv(text): string[][]`、`rowsToCsv(...)`、`cellToCsv(...)`、`csvEscape(...)`。

- [ ] **Step 1: 建包 `packages/plugin-csv/package.json`**

```json
{
  "name": "@markpocket/plugin-csv",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./server": "./src/server.ts",
    "./client": "./src/client.tsx"
  },
  "dependencies": {
    "@markpocket/plugin-sdk": "workspace:*",
    "drizzle-orm": "^0.45.2",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^26.0.1"
  }
}
```

> `./client` 在 Task 7 才建；本 Task 只需 `./server`。exports 先写全无妨（未建文件不影响 server 编译，除非被 import）。若工具报缺文件，实现者可本 Task 先只列 `./server`，Task 7 再补 `./client`。

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: 写失败测试 `packages/plugin-csv/src/csv.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { csvEscape, parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses quoted fields with embedded commas and quotes', () => {
    expect(parseCsv('a,b\n"x,y","he said ""hi"""')).toEqual([
      ['a', 'b'],
      ['x,y', 'he said "hi"'],
    ]);
  });
  it('drops fully-empty rows', () => {
    expect(parseCsv('a,b\n\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('csvEscape', () => {
  it('quotes fields containing comma/quote/newline', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('he "q"')).toBe('"he ""q"""');
    expect(csvEscape('plain')).toBe('plain');
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm exec vitest run csv` — Expected: FAIL（`Cannot find module './csv'`）。

- [ ] **Step 5: 实现 `packages/plugin-csv/src/csv.ts`**

把现有 `apps/web/src/app/api/import/route.ts` 的 `parseCsv` 与 `apps/web/src/app/api/export/route.ts` 的 `csvEscape`/`cellToCsv` **逐字**搬来（改为纯导出函数，无 `@/` 依赖；`cellToCsv` 的 `FieldType` 常量改为参数传入或用字符串字面量比较）。完整代码：

```ts
import type { CoreFieldTypes } from '@markpocket/plugin-sdk';

// —— 逐字来自旧 api/import/route.ts ——
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') {
        cur.push(field);
        field = '';
      } else if (c === '\n') {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = '';
      } else if (c === '\r') {
        /* skip */
      } else field += c;
    }
  }
  if (field || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// —— 逐字来自旧 api/export/route.ts ——
export function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function cellToCsv(
  value: unknown,
  type: string,
  options: Record<string, unknown>,
  ft: CoreFieldTypes,
): string {
  if (value == null) return '';
  switch (type) {
    case ft.FieldType.Number:
      return ft.formatNumberToString(value as number, options as { precision?: number });
    case ft.FieldType.Boolean:
      return value ? 'true' : 'false';
    case ft.FieldType.SingleSelect: {
      const choices = (options.choices as Array<{ id: string; name: string }>) ?? [];
      return choices.find((c) => c.id === value)?.name ?? '';
    }
    case ft.FieldType.MultiSelect: {
      const choices = (options.choices as Array<{ id: string; name: string }>) ?? [];
      const ids = (value as string[]) ?? [];
      return ids
        .map((id) => choices.find((c) => c.id === id)?.name ?? '')
        .filter(Boolean)
        .join('|');
    }
    case ft.FieldType.Link:
    case ft.FieldType.Attachment:
    case ft.FieldType.User:
    case ft.FieldType.Expression:
      return ''; // 降级——与旧 REST 路由一致
    default:
      return String(value);
  }
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm exec vitest run csv` — Expected: PASS（parseCsv + csvEscape 用例）。

- [ ] **Step 7: 实现 `packages/plugin-csv/src/server.ts`（router 工厂）**

把旧 `api/import/route.ts` 的 POST body（colMap 建立 + 逐行插入）与 `api/export/route.ts` 的 GET body（listRecordsPivoted + header + lines）**逐字迁移**为两个 tRPC procedure，`@/` 依赖改为注入的 `core.*`；multipart/GET 参数改为 zod input。完整结构：

```ts
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { CoreServerApi, ServerRouterFactory } from '@markpocket/plugin-sdk';
import { protectedProcedure, router } from '@markpocket/plugin-sdk/trpc';

import { cellToCsv, csvEscape, parseCsv } from './csv';

type SelectOption = { id: string; name: string; color: string };

const csvServer: ServerRouterFactory<ReturnType<typeof buildRouter>> = (core) => buildRouter(core);

function buildRouter(core: CoreServerApi) {
  const { db, schema, queries, fieldTypes } = core;
  const FieldType = fieldTypes.FieldType;
  return router({
    import: protectedProcedure
      .input(z.object({ tableId: z.string(), csvText: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const rows = parseCsv(input.csvText);
        if (rows.length < 2) throw new Error('CSV must have header + data');
        const [headerRow, ...dataRows] = rows;
        const fields = (await db
          .select()
          .from(schema.field)
          .where(eq((schema.field as { tableId: unknown }).tableId, input.tableId))) as Array<{
          id: string;
          name: string;
          type: string;
          options: Record<string, unknown>;
        }>;
        const colMap: Array<{ colIdx: number; field: (typeof fields)[number] }> = [];
        for (let i = 0; i < headerRow!.length; i++) {
          const name = headerRow![i]!.trim().toLowerCase();
          const f = fields.find((fd) => fd.name.toLowerCase() === name);
          if (f) colMap.push({ colIdx: i, field: f });
        }
        let imported = 0;
        for (const row of dataRows) {
          const recId = randomUUID();
          await db
            .insert(schema.record)
            .values({ id: recId, tableId: input.tableId, createdBy: ctx.session.user.id });
          for (const { colIdx, field: f } of colMap) {
            const raw = row[colIdx]?.trim() ?? '';
            if (!raw) continue;
            let value: unknown = raw;
            if (f.type === FieldType.Number) {
              const n = fieldTypes.parseStringToNumber(raw);
              if (n == null) continue;
              value = n;
            } else if (f.type === FieldType.Boolean) {
              value = raw === 'true' || raw === '1';
            } else if (f.type === FieldType.SingleSelect) {
              const choices = (f.options.choices as SelectOption[]) ?? [];
              const match = choices.find((c) => c.name.toLowerCase() === raw.toLowerCase());
              if (!match) continue;
              value = match.id;
            } else if (f.type === FieldType.MultiSelect) {
              const choices = (f.options.choices as SelectOption[]) ?? [];
              const names = raw.split('|').map((s) => s.trim());
              value = names
                .map((n) => choices.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id)
                .filter(Boolean);
              if (!(value as string[]).length) continue;
            } else if (
              f.type === FieldType.Link ||
              f.type === FieldType.Attachment ||
              f.type === FieldType.User ||
              f.type === FieldType.Expression
            ) {
              continue;
            }
            await db
              .insert(schema.cell)
              .values({ id: randomUUID(), recordId: recId, fieldId: f.id, value });
          }
          imported++;
        }
        return { imported };
      }),
    export: protectedProcedure
      .input(z.object({ tableId: z.string() }))
      .query(async ({ input }) => {
        const fields = (await db
          .select()
          .from(schema.field)
          .where(eq((schema.field as { tableId: unknown }).tableId, input.tableId))) as Array<{
          id: string;
          name: string;
          type: string;
          options: Record<string, unknown>;
        }>;
        const records = await queries.listRecordsPivoted(input.tableId, {}, 0, 10000);
        const header = fields.map((f) => csvEscape(f.name)).join(',');
        const lines = records.map((r) =>
          fields.map((f) => csvEscape(cellToCsv(r.cells[f.id], f.type, f.options, fieldTypes))).join(','),
        );
        return { csv: [header, ...lines].join('\n') };
      }),
  });
}

export default csvServer;
```

> 注：`db.select().from(...).where(...)` 与 `db.insert(...).values(...)` 通过 `DrizzleLike` 宽松面调用；`schema.field` 的 `.tableId` 列以 `as` 断言取。若 `DrizzleLike` 类型摩擦过大，实现者可将 `core.db` 在本文件顶部 `as any` 落地并在 report 说明——运行时用真实 drizzle，tRPC I/O 类型不受影响。**export 的 `orderBy(field.orderIndex)` 旧逻辑**：旧 export 对 fields 按 `orderIndex` 排序（`api/export/route.ts` 用了 `.orderBy(field.orderIndex)`）。迁移须保留：在 select 后对 `fields` 按 `orderIndex` 排序（`fields.sort((a,b)=>a.orderIndex-b.orderIndex)`，并把 `orderIndex: number` 加进 fields 类型断言），或在 where 后链 `.orderBy`。实现者确认列名后择一，保证导出列序不变。

- [ ] **Step 8: 跑全量测试**

Run: `pnpm exec vitest run` — Expected: 全绿（新 csv 纯函数测试 + 既有）。server.ts 的 db 逻辑由 Task 5 合并后 + Task 7 浏览器回归覆盖。

- [ ] **Step 9: 提交**

```bash
git add packages/plugin-csv pnpm-lock.yaml
git commit -m "feat(plugin-csv): CSV 导入导出 tRPC router 工厂 + 纯解析函数

parseCsv/csvEscape/cellToCsv 逐字迁自旧 REST 路由并单测；server.ts 用
SDK procedure + 注入 core 构 import(mutation)/export(query)，保持 link/
attachment/user/expression 降级语义与列序不变。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 静态合并 + 启动校验 + 删 REST 路由

**Files:**
- Modify: `apps/web/src/plugins.config.ts`（加 `pluginRouters`）
- Modify: `apps/web/src/server/trpc/router.ts`（合并 pluginRouters）
- Modify: `apps/web/package.json`（加 `@markpocket/plugin-csv` dep）
- Create: `apps/web/src/server/plugins/validate.test.ts`
- Delete: `apps/web/src/app/api/import/route.ts`, `apps/web/src/app/api/export/route.ts`

**Interfaces:**
- Consumes: `@markpocket/plugin-csv/server`（default factory）；`coreServerApi`（Task 3）。
- Produces: `plugins.config.ts` 具名导出 `pluginRouters` (`{ csv: <CsvRouter> } as const`)；`appRouter` 类型含 `csv`。

- [ ] **Step 1: apps/web 加 csv 依赖 + `pnpm install`**

`apps/web/package.json` dependencies 加 `"@markpocket/plugin-csv": "workspace:*"`；`pnpm install`。

- [ ] **Step 2: `plugins.config.ts` 加 pluginRouters**

在现有 `plugins.config.ts` 追加（保留 `plugins` 数组）：
```ts
import csvServer from '@markpocket/plugin-csv/server';
import { coreServerApi } from '@/server/plugins/core-api';

// 声明了 tRPC router 的插件在此静态合并 —— 唯一手工维护处。
export const pluginRouters = {
  csv: csvServer(coreServerApi),
} as const;
```

- [ ] **Step 3: `router.ts` 合并**

```ts
import { pluginRouters } from '@/plugins.config';
// ...既有 core router import 不变...

export const appRouter = router({
  auth: authRouter,
  workspace: workspaceRouter,
  base: baseRouter,
  table: tableRouter,
  view: viewRouter,
  field: fieldRouter,
  record: recordRouter,
  cell: cellRouter,
  history: historyRouter,
  share: shareRouter,
  member: memberRouter,
  ...pluginRouters,
});
```

- [ ] **Step 4: 启动校验测试 `apps/web/src/server/plugins/validate.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { pluginRouters } from '@/plugins.config';

// 契约：客户端 trpc.csv.* 依赖 csv 出现在合并后的 pluginRouters。
describe('pluginRouters', () => {
  it('exposes the csv namespace', () => {
    expect(Object.keys(pluginRouters)).toContain('csv');
  });
});
```
> 需 vitest `@/` alias（Task 3 已加）。若 import `plugins.config` 触发 db 连接，用 Task 3 的同款 `vi.mock('@/server/db')`。

- [ ] **Step 5: 删两个 REST 路由**

```bash
git rm apps/web/src/app/api/import/route.ts apps/web/src/app/api/export/route.ts
```

- [ ] **Step 6: 校验**

Run: `grep -rn "api/import\|api/export" apps/web/src` — Expected: 仅剩 Task 7 待改的 settings/general 的 export `<a>`（本 Task 结束时它仍指旧 URL——**Task 7 改**；本 Task 先不动它则导出暂时 404，可接受，因 Task 5/7 连续做）。**为避免中间态破坏**：本 Task Step 6 同时把 settings/general 里 `href={`/api/export?...`}` 那行临时改为 `disabled`/占位，Task 7 再换成 `<Slot>`。实现者执行此临时改动并在 report 说明。
Run: `pnpm --filter @markpocket/web typecheck` — Expected: exit 0（client `trpc.csv` 类型可解析）。
Run: `pnpm exec vitest run validate` — Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(plugins): appRouter 静态合并 csv 插件 router + 删 CSV REST 路由

plugins.config 构 pluginRouters.csv=csvServer(coreServerApi)，router.ts
展开合并 → client AppRouter 含 csv；删除 api/import、api/export。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 客户端 UI Slot 基础设施

**Files:**
- Create: `apps/web/src/lib/plugins/ui-slot-client.tsx`（client 注册表 + `registerSlot` + `<Slot>`）
- Create: `apps/web/src/plugins.client.ts`（client bootstrap）
- Modify: `apps/web/src/app/layout.tsx`（在 provider 树 import 触发 bootstrap）
- Test: `apps/web/src/lib/plugins/ui-slot-client.test.tsx`

**Interfaces:**
- Produces:
  - `registerSlot(slotId: string, Component: ComponentType<{ ctx?: unknown }>): void`
  - `<Slot id={string} ctx?={unknown} />` — 渲染所有注册到该 slotId 的组件
- Consumes: `plugins.client.ts` 从 `@markpocket/plugin-csv/client`（Task 7 建）注册；本 Task 先建空 bootstrap（无插件），Task 7 接线 csv。

- [ ] **Step 1: 写失败测试 `ui-slot-client.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { registerSlot, Slot } from './ui-slot-client';

describe('ui slot client', () => {
  it('renders components registered under a slot id', () => {
    registerSlot('demo', () => <div>hello-slot</div>);
    render(<Slot id="demo" />);
    expect(screen.getByText('hello-slot')).toBeDefined();
  });

  it('renders nothing for an unknown slot id', () => {
    const { container } = render(<Slot id="empty" />);
    expect(container.textContent).toBe('');
  });
});
```
> 需 `@testing-library/react` + jsdom。实现者加 devDep `@testing-library/react`、`jsdom`，并在 `vitest.config.ts` 给该测试用 `environment: 'jsdom'`（或文件顶 `// @vitest-environment jsdom`）。这是本 Task 允许的测试基础设施改动。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run ui-slot-client` — Expected: FAIL。

- [ ] **Step 3: 实现 `apps/web/src/lib/plugins/ui-slot-client.tsx`**

```tsx
'use client';

import type { ComponentType } from 'react';

type SlotComponent = ComponentType<{ ctx?: unknown }>;

const slots = new Map<string, SlotComponent[]>();

export function registerSlot(slotId: string, Component: SlotComponent): void {
  const list = slots.get(slotId) ?? [];
  list.push(Component);
  slots.set(slotId, list);
}

export function Slot({ id, ctx }: { id: string; ctx?: unknown }) {
  const list = slots.get(id) ?? [];
  return (
    <>
      {list.map((C, i) => (
        <C key={i} ctx={ctx} />
      ))}
    </>
  );
}
```

- [ ] **Step 4: 建 client bootstrap `apps/web/src/plugins.client.ts`**

```ts
// 客户端插件贡献注册点。装带 UI 的插件 = 在此 import 其 /client 并 registerSlot。
// Task 7 接入 csv；本 Task 先留空骨架（import 即触发注册）。
export {};
```

- [ ] **Step 5: 在 layout 触发 bootstrap**

`apps/web/src/app/layout.tsx` 顶部加副作用 import：`import '@/plugins.client';`（放在其它 import 之后）。

- [ ] **Step 6: 跑测试**

Run: `pnpm exec vitest run ui-slot-client` — Expected: PASS。
Run: `pnpm --filter @markpocket/web typecheck` — Expected: exit 0。

- [ ] **Step 7: 提交**

```bash
git add apps/web vitest.config.ts pnpm-lock.yaml
git commit -m "feat(plugins): 客户端 UI Slot 注册表 + <Slot> + client bootstrap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: CSV client slot + settings 迁移 + 回归

**Files:**
- Create: `packages/plugin-csv/src/client.tsx`
- Modify: `apps/web/src/plugins.client.ts`（注册 csv slot）
- Modify: `apps/web/src/app/bases/[baseId]/settings/general/page.tsx`（用 `<Slot>` 替换 Export 区块）

**Interfaces:**
- Consumes: `registerSlot`（Task 6，从 `@/lib/plugins/ui-slot-client` —— 但插件不 import `@/`！见下）；`trpc`（client）。
- Produces: `@markpocket/plugin-csv/client` default export `{ slotId: 'table-tools', Component }`。

> **关键约束**：插件不 import `@/`。故 csv `/client` **不**直接调 app 的 `registerSlot`；而是 default-export 一个 `UiSlotContribution`（`{ slotId, Component }`），由 app 的 `plugins.client.ts` import 后调 `registerSlot`。同理插件的 client 组件要用 `trpc.csv.*`——app 的 `trpc` 实例在 `@/lib/trpc/client`，插件不能 import。**解法**：组件通过 props/context 接收，或 app 在注册时注入 trpc hooks。**本 Task 采用**：csv client 组件接收 `ctx`（含 app 传入的 `tables` 列表与回调），实际的 trpc 调用放在 **app 侧薄封装**——即 `plugins.client.ts` 里定义调用 `trpc.csv` 的小组件并 registerSlot。若这样 csv `/client` 变得很薄（只有展示），可接受；把 import/export 的 trpc 交互写在 app 的 plugins.client 里。实现者按此就近取舍并在 report 说明最终形态（目标：核心 settings 页不 import csv；csv 的 UI 经 slot 出现）。

- [ ] **Step 1: 实现 csv client 展示组件 `packages/plugin-csv/src/client.tsx`**

一个纯展示组件，接收 `ctx: { tables: {id,string}[]; onExport(tableId): void; onImport(tableId, file): void }`，渲染每个 table 的「download / import」控件。完整代码（示例，实现者按 ctx 形状定稿）：

```tsx
import type { ComponentType } from 'react';

type Ctx = {
  tables: Array<{ id: string; name: string }>;
  onExport: (tableId: string) => void;
  onImport: (tableId: string, file: File) => void;
};

const Component: ComponentType<{ ctx?: unknown }> = ({ ctx }) => {
  const c = ctx as Ctx;
  return (
    <ul className="border-t border-border">
      {c.tables.map((t) => (
        <li
          key={t.id}
          className="flex items-center justify-between rounded border-b border-border px-2 py-2.5 hover:bg-muted"
        >
          <span className="text-sm">{t.name}</span>
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <button type="button" className="hover:text-foreground" onClick={() => c.onExport(t.id)}>
              download →
            </button>
            <label className="cursor-pointer hover:text-foreground">
              import
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && c.onImport(t.id, e.target.files[0])}
              />
            </label>
          </span>
        </li>
      ))}
    </ul>
  );
};

export default { slotId: 'table-tools', Component };
```

- [ ] **Step 2: app 侧接线 `apps/web/src/plugins.client.ts`**

```ts
'use client';

import csvClient from '@markpocket/plugin-csv/client';
import { registerSlot } from '@/lib/plugins/ui-slot-client';

// csv 的 UI 经 slot 挂载；trpc 交互（导出下载 / 导入）在 app 侧封装后由 ctx 注入。
registerSlot(csvClient.slotId, csvClient.Component);
```

- [ ] **Step 3: settings/general 用 `<Slot>` 替换 Export 区块**

把 `<section>Export (CSV) ... </section>` 整块换为：
```tsx
<section>
  <h2 className="mb-2 text-sm font-semibold">Tables (CSV)</h2>
  <Slot
    id="table-tools"
    ctx={{
      tables: tables.data ?? [],
      onExport: async (tableId: string) => {
        const { csv } = await utils.client.csv.export.query({ tableId });
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${tableId}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
      onImport: async (tableId: string, file: File) => {
        const csvText = await file.text();
        const { imported } = await importMut.mutateAsync({ tableId, csvText });
        toast.success(`Imported ${imported} rows`);
        void utils.table.list.invalidate({ baseId });
      },
    }}
  />
</section>
```
并在组件顶部加 `import { Slot } from '@/lib/plugins/ui-slot-client';` 与 `const importMut = trpc.csv.import.useMutation();`。`utils.client.csv.export.query` 用 tRPC vanilla client（`trpc.useUtils().client`）。实现者确认 `utils.client` 可用；若否，用 `trpc.csv.export.useQuery` 的 `refetch` 或加一个 `useQuery(..., { enabled:false })` 再 `refetch`。

- [ ] **Step 4: typecheck + 全量测试**

Run: `pnpm --filter @markpocket/web typecheck` — Expected: exit 0。
Run: `pnpm exec vitest run` — Expected: 全绿。

- [ ] **Step 5: 浏览器回归（需 dev + Postgres）**

启动 `pnpm --filter @markpocket/web dev` + Postgres。进某 base 的 Settings → General：(1) 点某表 download，确认下载到与旧导出一致的 CSV（列序、降级字段为空）；(2) 用一个 header 匹配字段名的 CSV import，确认 toast「Imported N rows」且 Grid 出现新记录。
Expected: 导出/导入行为与旧 REST 路由等价。

- [ ] **Step 6: 提交**

```bash
git add packages/plugin-csv apps/web
git commit -m "feat(plugin-csv): CSV UI 经 UI Slot 挂载 + settings 迁移

csv/client 导出 UiSlotContribution，plugins.client 注册进 table-tools slot；
settings/general 用 <Slot> 替换内联 Export，导出走 trpc.csv.export 文本 +
Blob 下载，导入走 trpc.csv.import。核心 settings 页不再 import csv。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: ADR-0008 CoreServerApi 注入 + server/client 包拆分

**Files:**
- Create: `docs/adr/0008-plugin-server-router-injection.md`

- [ ] **Step 1: 写 ADR-0008**

按仓库 ADR 体例记录：(1) SDK 提供 tRPC 运行时（结构化 PluginContext），插件用自有实例建 router，合并进 appRouter 后 client 类型流通（spike 验证）；(2) CoreServerApi 工厂注入 db/schema/queries/fieldTypes，插件不 import `@/`；(3) server/client 子路径导出物理隔离；(4) 静态合并点 `pluginRouters` + 契约（声明 router 的插件须在 pluginRouters）；(5) 备选：抽 `@markpocket/core` 大包（否决，违增量）、共享 tRPC 实例需 app 改 Context（本方案用结构化 context 免此改）。反悔代价低。

- [ ] **Step 2: 提交**

```bash
git add docs/adr/0008-plugin-server-router-injection.md
git commit -m "docs(adr): ADR-0008 CoreServerApi 注入 + server/client 包拆分

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage（对 `2026-07-09-plugin-csv-server-router-design.md`）**：
- §1 决策（工厂注入 / tRPC 文本 / UI Slot 成对 / Event 推迟 / server-client 拆分）→ Task 1–7 全覆盖；Event 明确不建。✅
- §2.1 CoreServerApi 注入 → Task 2（类型）+ Task 3（构造）+ Task 4（工厂消费）。✅
- §2.2 静态合并 + 启动校验 → Task 5（pluginRouters + router.ts + validate.test）。✅
- §2.3 客户端 UI Slot → Task 6（注册表/`<Slot>`/bootstrap）+ Task 7（csv slot + 迁移）。✅
- §2.4 迁移与删除 → Task 5（删 REST）+ Task 7（settings 迁移）。✅
- §3 包布局 → Task 4/6/7 落地 `plugin-csv/{server,client,csv}`、`core-api`、`plugins.config/client`、`slot`。✅
- §4 抽出顺序 → Task 顺序一致。✅
- §5 风险（tRPC 注入类型）→ 已由 spike 消解，Task 1 采纳结论；db/schema 宽松类型退路在 Task 2/4 明示。✅

**Placeholder scan**：无 TBD/TODO。Task 4/7 对「逐字迁移」给出完整代码块与来源文件+改动点；Task 2/4 的类型退路显式写明由实现者取舍并 report，非占位。✅

**Type consistency**：`PluginContext`（Task 1）↔ 结构化 session；`CoreServerApi`（Task 2）↔ `coreServerApi`（Task 3）↔ `csvServer` 消费（Task 4）↔ `pluginRouters.csv`（Task 5）；`UiSlotContribution { slotId, Component }`（Task 2）↔ csv `/client` default（Task 7）↔ `registerSlot`（Task 6）。一致。✅

**已知偏差**：db/schema 若走 `any` 退路，插件内 drizzle 查询失去列级类型——client 面向 tRPC I/O 类型不受影响（Task 1 运行时保证）。Task 5 中间态（导出暂 404）由 Step 6 临时 disable + Task 7 修复消解。
