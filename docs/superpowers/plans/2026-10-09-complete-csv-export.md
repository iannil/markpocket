# Complete CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 两个 CSV 导出入口对预算内的数据完整导出，超预算明确失败，消除 10k 行截断。

**Architecture:** plugin-csv 提供纯 CSV 组装器；应用层用只读快照事务读取字段和分页记录。两个 tRPC 入口共享应用导出服务，插件通过 CoreServerApi 接入；不增加 HTTP 路由、表或后台任务。

**Tech Stack:** Node >=22、pnpm 10.32.1、TypeScript、tRPC 11、Drizzle/PostgreSQL 16、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-09-airtable-opportunity-design.md`，A1/E1–E6；执行时同时阅读该文件。

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

## 文件结构与执行约定

工作目录：仓库根目录。没有发现仓库内 AGENTS.md；`CLAUDE.md` 当前已被用户删除，不以文档地图中对它的引用为由恢复。执行前重新检查工作树。

| 文件 | 责任 |
| --- | --- |
| `packages/plugin-csv/src/export.ts`（新建） | 无 DB 的分页 CSV 组装、字节/行数预算 |
| `packages/plugin-csv/src/export.test.ts`（新建） | 完整性、预算与注入回归 |
| `packages/plugin-csv/package.json` | 新增 `./export` 子路径 |
| `apps/web/src/server/exports/csv.ts`（新建） | 快照、查询、鉴权、并发、错误映射 |
| `apps/web/src/server/exports/csv.pg.test.ts`（新建） | 显式启用的真库回归 |
| `packages/plugin-sdk/src/index.ts` | 主机导出能力契约 |
| `packages/plugin-sdk/src/core-api.test-d.ts` | 契约类型回归 |
| `apps/web/src/server/plugins/core-api.ts` | 主机能力注入 |
| `packages/plugin-csv/src/server.ts`、`server.test.ts` | 单表入口接线、鉴权回归 |
| `apps/web/src/server/trpc/routers/export.ts`、`export.test.ts` | Base 入口接线、参数传递回归 |
| `apps/web/src/app/bases/[baseId]/settings/export/page.tsx` | 去截断提示，说明导出范围与预算 |
| `apps/web/src/app/bases/[baseId]/settings/general/page.tsx` | 单表导出成功提示与错误展示 |
| `.github/workflows/ci.yml` | 在已有真库 e2e job 中启用 PG 回归 |
| `docs/STATUS.md`、`docs/api/routers.md`、`docs/adr/0008-plugin-server-router-injection.md`、`CHANGELOG.md` | 新行为、限制与注入契约 |

先读 `docs/testing.md`、ADR-0005/0008、`packages/plugin-csv/src/csv.ts`、`apps/web/src/server/db/schema.ts`。不修改 CSV 导入，也不修改通用 `listRecordsPivoted`。代码步骤按给定块落盘；每个测试用例与接线修改单独执行，不把一个 Task 当单个 5 分钟动作。

## Task 1：可完整组装且有预算的 CSV 编码器

**Files:** 新建 `packages/plugin-csv/src/export.ts`、`export.test.ts`；修改 `packages/plugin-csv/package.json` 的 exports。

**Interfaces:**
- Consumes: 现有 `csvEscape(string): string`、`cellToCsv(value,type,options,CoreFieldTypes): string`。
- Produces: `collectCsv(fields, readPage, fieldTypes, budget): Promise<{csv:string; exported:number}>`；`CsvBudgetError`；`ExportField`；`ExportRow`；`ExportBudget`，定义如下。

- [ ] **Step 1：写失败测试。** 新建测试文件，所有 helper 在本文件定义。

```ts
import { describe, expect, it } from 'vitest';
import type { CoreFieldTypes } from '@markpocket/plugin-sdk';
import { collectCsv, CsvBudgetError } from './export';

const ft: CoreFieldTypes = {
  FieldType: { Text: 'text' },
  formatNumberToString: String,
  parseStringToNumber: Number,
  normalizeCellValue: () => ({ empty: true }),
};
const fields = [{ id: 'f', name: 'Name', type: 'text', options: {} }];
const budget = () => ({ remainingBytes: 8 * 1024 * 1024 });
function source(n: number) {
  return async (offset: number, limit: number) =>
    Array.from({ length: Math.max(0, Math.min(limit, n - offset)) }, (_, i) => ({
      cells: { f: `row-${offset + i}` },
    }));
}

describe('complete CSV', () => {
  it.each([0, 10001, 100000])('exports all %i records', async (n) => {
    const result = await collectCsv(fields, source(n), ft, budget());
    expect(result.exported).toBe(n);
    expect(result.csv.split('\n')).toHaveLength(n + 1);
    if (n) expect(result.csv.endsWith(`row-${n - 1}`)).toBe(true);
  });
  it('rejects 100001 records without returning a file', async () => {
    await expect(collectCsv(fields, source(100001), ft, budget()))
      .rejects.toBeInstanceOf(CsvBudgetError);
  });
  it('counts UTF-8 bytes including separators and header', async () => {
    const read = async (offset: number) => offset ? [] : [{ cells: { f: '中' } }];
    const exact = { remainingBytes: Buffer.byteLength('Name\n中') };
    expect((await collectCsv(fields, read, ft, exact)).csv).toBe('Name\n中');
    expect(exact.remainingBytes).toBe(0);
    await expect(collectCsv(fields, read, ft, { remainingBytes: 7 }))
      .rejects.toBeInstanceOf(CsvBudgetError);
  });
  it('shares the byte budget across tables', async () => {
    const shared = { remainingBytes: 7 };
    await collectCsv(fields, source(0), ft, shared);
    await expect(collectCsv(fields, source(0), ft, shared))
      .rejects.toBeInstanceOf(CsvBudgetError);
  });
  it('retains formula guarding and quote escaping', async () => {
    const read = async (offset: number) => offset ? [] : [
      { cells: { f: '=1+1' } }, { cells: { f: 'a,"b"\nc' } },
    ];
    const result = await collectCsv(fields, read, ft, budget());
    expect(result.csv).toBe('Name\n\'=1+1\n"a,""b""\nc"');
  });
});
```

- [ ] **Step 2：验证 RED。** `pnpm exec vitest run packages/plugin-csv/src/export.test.ts`；预期缺少 `./export`。
- [ ] **Step 3：新增类型、错误类和实现。** 不复制 `csvEscape` 的实现。

```ts
import type { CoreFieldTypes } from '@markpocket/plugin-sdk';
import { cellToCsv, csvEscape } from './csv';

export type ExportField = {
  id: string; name: string; type: string; options: Record<string, unknown>;
};
export type ExportRow = { cells: Record<string, unknown> };
export type ExportBudget = { remainingBytes: number };
export class CsvBudgetError extends Error {}

export async function collectCsv(
  fields: ExportField[],
  readPage: (offset: number, limit: number) => Promise<ExportRow[]>,
  fieldTypes: CoreFieldTypes,
  budget: ExportBudget,
): Promise<{ csv: string; exported: number }> {
  const lines: string[] = [];
  function append(line: string) {
    const bytes = Buffer.byteLength(line, 'utf8') + (lines.length ? 1 : 0);
    if (bytes > budget.remainingBytes) {
      throw new CsvBudgetError('CSV export exceeds 8 MiB. Export fewer tables or use an instance backup.');
    }
    budget.remainingBytes -= bytes;
    lines.push(line);
  }
  append(fields.map((f) => csvEscape(f.name)).join(','));
  let exported = 0;
  for (;;) {
    const rows = await readPage(exported, 250);
    if (exported + rows.length > 100000) {
      throw new CsvBudgetError('CSV export exceeds 100,000 records in one table. Use an instance backup.');
    }
    for (const row of rows) {
      append(fields.map((f) => csvEscape(cellToCsv(
        row.cells[f.id], f.type, f.options, fieldTypes,
      ))).join(','));
    }
    exported += rows.length;
    if (rows.length < 250) break;
  }
  return { csv: lines.join('\n'), exported };
}
```

- [ ] **Step 4：添加 package 子路径。** 在 exports 中追加 `"./export": "./src/export.ts"`。
- [ ] **Step 5：验证 GREEN。** 执行该单测、`pnpm --filter @markpocket/plugin-csv typecheck`、`pnpm test`。已有 CSV 格式化测试必须保持通过。
- [ ] **Step 6：格式化并提交本任务文件。**

```bash
pnpm exec prettier --write packages/plugin-csv/src/export.ts packages/plugin-csv/src/export.test.ts packages/plugin-csv/package.json
git add packages/plugin-csv/src/export.ts packages/plugin-csv/src/export.test.ts packages/plugin-csv/package.json
git commit -m "feat: add complete bounded CSV assembly"
```

## Task 2：快照读取服务与真库完整性回归

**Files:** 新建 `apps/web/src/server/exports/csv.ts`、`csv.pg.test.ts`；修改 `.github/workflows/ci.yml`。

**Interfaces:**
- Consumes: Task 1 的 `collectCsv`；现有 `db`、`assertRole`、`assertTableRole`、`FieldType`、格式化函数与字段归一化函数。
- Produces: `exportTableCsv(tableId:string,userId:string): Promise<{csv:string;exported:number;truncated:false}>`；`exportBaseCsv(baseId:string,userId:string,tableIds?:string[]):Promise<CsvFile[]>`；`readCsvFiles(tx:ExportTx,tables:ExportTable[]):Promise<CsvFile[]>`。后一个只供主机内部/真库回归使用，不向 HTTP 直接暴露。

- [ ] **Step 1：写真库 RED 用例。** 新文件内容如下。只有 `EXPORT_PG_TEST=1` 才导入数据库；测试在事务中创建自己的 workspace/base/table，不清空现有表。

```ts
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

it.skipIf(process.env.EXPORT_PG_TEST !== '1')('exports 10001 rows with stable ties from PostgreSQL', async () => {
  const { db } = await import('../db');
  const s = await import('../db/schema');
  const { readCsvFiles } = await import('./csv');
  const id = randomUUID();
  const rollback = new Error('fixture rollback');
  try {
    await db.transaction(async (tx) => {
      await tx.insert(s.workspace).values({ id, name: 'export-test' });
      await tx.insert(s.base).values({ id, workspaceId: id, name: 'export-test' });
      await tx.insert(s.table).values({ id, baseId: id, name: 'Test' });
      await tx.insert(s.field).values({ id, tableId: id, name: 'Name', type: 'text' });
      const now = new Date('2026-01-01T00:00:00Z');
      for (let start = 0; start < 10001; start += 250) {
        const rows = Array.from({ length: Math.min(250, 10001 - start) }, (_, i) => ({
          id: `${id}-${String(start + i).padStart(5, '0')}`, tableId: id, createdAt: now,
        }));
        await tx.insert(s.record).values(rows);
        await tx.insert(s.cell).values(rows.map((r) => ({
          id: randomUUID(), recordId: r.id, fieldId: id, value: r.id,
        })));
      }
      const [file] = await readCsvFiles(tx, [{ id, name: 'Test' }]);
      expect(file!.total).toBe(10001);
      expect(file!.truncated).toBe(false);
      const lines = file!.csv.split('\n');
      expect(lines).toHaveLength(10002);
      expect(new Set(lines.slice(1)).size).toBe(10001);
      expect(lines[1]).toBe(`${id}-10000`);
      expect(lines.at(-1)).toBe(`${id}-00000`);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}, 60000);
```

- [ ] **Step 2：在专用测试数据库验证 RED。** 本地使用独立 PG16 实例和该实例的 `DATABASE_URL`，先 `pnpm db:migrate`，再 `EXPORT_PG_TEST=1 pnpm exec vitest run apps/web/src/server/exports/csv.pg.test.ts`。预期缺少 `./csv`。未配置真库时不能把 skipped 当通过。
- [ ] **Step 3：实现服务的快照读取部分。** 新建 `csv.ts`，以下代码与下一步骤在同一个文件。

```ts
import { asc, desc, eq, inArray, sql as querySql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { collectCsv, CsvBudgetError } from '@markpocket/plugin-csv/export';
import { FieldType } from '@/lib/field-types';
import { formatNumberToString, parseStringToNumber } from '@/lib/format-number';
import { assertRole, assertTableRole } from '@/lib/roles';
import { normalizeCellValue } from '@/server/plugins/field-value';
import { db } from '@/server/db';
import { cell, field, record, table } from '@/server/db/schema';

export type ExportTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ExportTable = { id: string; name: string };
export type CsvFile = {
  tableId: string; name: string; csv: string; truncated: false; total: number;
};
const ft = { FieldType, formatNumberToString, parseStringToNumber, normalizeCellValue };

export async function readCsvFiles(tx: ExportTx, tables: ExportTable[]): Promise<CsvFile[]> {
  const deadline = Date.now() + 60000;
  const budget = { remainingBytes: 8 * 1024 * 1024 };
  const files: CsvFile[] = [];
  for (const t of tables) {
    const fields = await tx.select().from(field).where(eq(field.tableId, t.id))
      .orderBy(asc(field.orderIndex), asc(field.id));
    const exportFields = fields.map((f) => ({ ...f, options: f.options as Record<string, unknown> }));
    const result = await collectCsv(exportFields, async (offset, limit) => {
      if (Date.now() >= deadline) throw new TRPCError({
        code: 'TIMEOUT', message: 'CSV export timed out. Export fewer tables or use an instance backup.',
      });
      const rows = await tx.select({ id: record.id }).from(record)
        .where(eq(record.tableId, t.id))
        .orderBy(desc(record.createdAt), desc(record.id)).limit(limit).offset(offset);
      if (!rows.length) return [];
      const values = await tx.select().from(cell)
        .where(inArray(cell.recordId, rows.map((r) => r.id)));
      const pivot = new Map<string, Record<string, unknown>>();
      for (const value of values) {
        const cells = pivot.get(value.recordId) ?? {};
        cells[value.fieldId] = value.value;
        pivot.set(value.recordId, cells);
      }
      return rows.map((r) => ({ cells: pivot.get(r.id) ?? {} }));
    }, ft, budget);
    const safeName = t.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'table';
    const safeId = t.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    files.push({ tableId: t.id, name: `${safeName}-${safeId}.csv`,
      csv: result.csv, total: result.exported, truncated: false });
  }
  return files;
}
```

- [ ] **Step 4：实现并发预算与两个鉴权包装器。** 追加到同一文件。

```ts
let active = false;
async function snapshot(tables: (tx: ExportTx) => Promise<ExportTable[]>) {
  if (active) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Another CSV export is running. Retry shortly.' });
  active = true;
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(querySql`set local statement_timeout = '30s'`);
      return readCsvFiles(tx, await tables(tx));
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  } catch (error) {
    if (error instanceof CsvBudgetError) throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: error.message });
    if (error instanceof TRPCError) throw error;
    console.error('CSV export failed', error);
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'CSV export failed. No files were exported.' });
  } finally {
    active = false;
  }
}

export async function exportTableCsv(tableId: string, userId: string) {
  await assertTableRole(tableId, userId, 'viewer');
  const [file] = await snapshot((tx) => tx.select({ id: table.id, name: table.name })
    .from(table).where(eq(table.id, tableId)));
  if (!file) throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found' });
  return { csv: file.csv, exported: file.total, truncated: false as const };
}

export async function exportBaseCsv(baseId: string, userId: string, tableIds?: string[]) {
  await assertRole(baseId, userId, 'viewer');
  return snapshot(async (tx) => {
    const rows = await tx.select({ id: table.id, name: table.name }).from(table)
      .where(eq(table.baseId, baseId)).orderBy(asc(table.orderIndex), asc(table.id));
    return rows.filter((row) => !tableIds || tableIds.includes(row.id));
  });
}
```

- [ ] **Step 5：增加快照隔离回归。** 在 `csv.pg.test.ts` 追加以下用例。它创建并删除唯一 ID 的测试记录；只对专用测试库运行。事务中先读取字段建立快照，再由另一连接更改单元格，确认导出仍为旧值。

```ts
it.skipIf(process.env.EXPORT_PG_TEST !== '1')('retains a snapshot while another connection updates a cell', async () => {
  const { db } = await import('../db');
  const s = await import('../db/schema');
  const { eq } = await import('drizzle-orm');
  const { readCsvFiles } = await import('./csv');
  const id = randomUUID();
  try {
    await db.insert(s.workspace).values({ id, name: 'snapshot-test' });
    await db.insert(s.base).values({ id, workspaceId: id, name: 'snapshot-test' });
    await db.insert(s.table).values({ id, baseId: id, name: 'Test' });
    await db.insert(s.field).values({ id, tableId: id, name: 'Name', type: 'text' });
    await db.insert(s.record).values({ id, tableId: id });
    await db.insert(s.cell).values({ id, recordId: id, fieldId: id, value: 'before' });
    await db.transaction(async (tx) => {
      await tx.select().from(s.field).where(eq(s.field.id, id));
      await db.update(s.cell).set({ value: 'after' }).where(eq(s.cell.id, id));
      const [file] = await readCsvFiles(tx, [{ id, name: 'Test' }]);
      expect(file!.csv).toBe('Name\nbefore');
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  } finally {
    await db.delete(s.base).where(eq(s.base.id, id));
    await db.delete(s.workspace).where(eq(s.workspace.id, id));
  }
}, 60000);
```

- [ ] **Step 6：在 CI 真库 job 运行。** 在现有 `API e2e tests` step 后增加：

```yaml
      - name: CSV export PostgreSQL regressions
        run: pnpm exec vitest run apps/web/src/server/exports/csv.pg.test.ts
        env:
          EXPORT_PG_TEST: '1'
```

- [ ] **Step 7：运行 GREEN、类型检查与提交。**

```bash
EXPORT_PG_TEST=1 pnpm exec vitest run apps/web/src/server/exports/csv.pg.test.ts
pnpm typecheck
pnpm test
pnpm exec prettier --write apps/web/src/server/exports/csv.ts apps/web/src/server/exports/csv.pg.test.ts .github/workflows/ci.yml
git add apps/web/src/server/exports/csv.ts apps/web/src/server/exports/csv.pg.test.ts .github/workflows/ci.yml
git commit -m "feat: export CSV from a bounded database snapshot"
```

## Task 3：接通两个现有入口并维护插件契约

**Files:** 修改 SDK `index.ts`、`core-api.test-d.ts`；应用 `server/plugins/core-api.ts`；两个导出 router 及现有测试文件。

**Interfaces:**
- Consumes: Task 2 的 `exportTableCsv`、`exportBaseCsv`。
- Produces: `CoreServerApi.exports.tableCsv(tableId,userId)`；保留原有 HTTP/tRPC 方法名和成功响应字段。

- [ ] **Step 1：写 Base 入口 RED 测试。** 用以下内容替换 `routers/export.test.ts`。CSV 组装验证已经移到 Task 1；真库验证在 Task 2。

```ts
import { beforeEach, expect, it, vi } from 'vitest';
import { session } from './__test-utils';
const mocks = vi.hoisted(() => ({ exportBaseCsv: vi.fn() }));
vi.mock('@/server/exports/csv', () => mocks);
import { exportRouter } from './export';
beforeEach(() => vi.resetAllMocks());
it('forwards the selected tables and authenticated user to the export service', async () => {
  const files = [{ tableId: 't1', name: 'Test-t1.csv', csv: 'Name', total: 0, truncated: false }];
  mocks.exportBaseCsv.mockResolvedValue(files);
  expect(await exportRouter.createCaller(session()).exportBase({ baseId: 'b1', tableIds: ['t1'] })).toEqual(files);
  expect(mocks.exportBaseCsv).toHaveBeenCalledWith('b1', 'u1', ['t1']);
});
it('does not turn a service failure into partial files', async () => {
  mocks.exportBaseCsv.mockRejectedValue(new Error('export rejected'));
  await expect(exportRouter.createCaller(session()).exportBase({ baseId: 'b1' })).rejects.toThrow('export rejected');
});
```

- [ ] **Step 2：验证 RED。** `pnpm exec vitest run apps/web/src/server/trpc/routers/export.test.ts`。
- [ ] **Step 3：替换 Base router 实现。**

```ts
import { z } from 'zod';
import { exportBaseCsv } from '@/server/exports/csv';
import { protectedProcedure, router } from '../init';
export const exportRouter = router({
  exportBase: protectedProcedure
    .input(z.object({ baseId: z.string(), tableIds: z.array(z.string()).optional() }))
    .query(({ ctx, input }) => exportBaseCsv(input.baseId, ctx.session.user.id, input.tableIds)),
});
```

- [ ] **Step 4：添加 SDK 契约及类型断言。** 在 `CoreServerApi` 中添加必需的 `exports`；内部所有 host 在编译时显式实现，不用可选能力悄悄降级回截断逻辑。

```ts
// packages/plugin-sdk/src/index.ts，CoreServerApi 新属性
exports: {
  tableCsv(tableId: string, userId: string): Promise<{
    csv: string; exported: number; truncated: false;
  }>;
};
```

```ts
// packages/plugin-sdk/src/core-api.test-d.ts 追加
 test('CSV export preserves complete-only response contract', () => {
  expectTypeOf<CoreServerApi['exports']['tableCsv']>().parameters.toEqualTypeOf<[string, string]>();
  expectTypeOf<CoreServerApi['exports']['tableCsv']>().returns.toEqualTypeOf<Promise<{
    csv: string; exported: number; truncated: false;
  }>>();
});
```

- [ ] **Step 5：接入主机与插件。** 在应用 `core-api.ts` 添加 import 与对象属性；插件 `server.ts` 只替换 export 过程，保留 import 过程原样。

```ts
// apps/web/src/server/plugins/core-api.ts
import { exportTableCsv } from '@/server/exports/csv';
// coreServerApi 对象的新属性：
exports: { tableCsv: exportTableCsv },
```

```ts
// packages/plugin-csv/src/server.ts，替换 export 属性
export: protectedProcedure
  .input(z.object({ tableId: z.string() }))
  .query(({ ctx, input }) => core.exports.tableCsv(input.tableId, ctx.session.user.id)),
```

删除 `EXPORT_LIMIT` 和仅旧 export 使用的 `cellToCsv/csvEscape` import。`auth` 等 import 路径仍供导入使用，不删。

- [ ] **Step 6：调整插件 host fixture，验证调用参数。** `server.test.ts` 的 fakeCore 内增加下面的返回 spy；原有 import 用例不变。原 export 测试替换为调用注入能力的测试。

```ts
// fakeCore 的 core 对象新属性：
exports: {
  tableCsv: vi.fn().mockResolvedValue({ csv: 'Name\nAlice', exported: 1, truncated: false }),
},
```

```ts
it('delegates complete export with caller identity', async () => {
  const { core } = fakeCore([]);
  const result = await callerFor(core).export({ tableId: 't1' });
  expect(core.exports.tableCsv).toHaveBeenCalledWith('t1', 'u1');
  expect(result).toEqual({ csv: 'Name\nAlice', exported: 1, truncated: false });
});
```

已核对现有 `callerFor` 固定用户 ID 为 `u1`。仓库内只有应用 `coreServerApi` 和此 `fakeCore` 构造该接口；两处均在本任务接线。保留 fixture 已有的类型转换，不新增 `as any` 掩盖契约缺失。

- [ ] **Step 7：对服务鉴权与表选择补回归。** 在 PG 文件追加以下用例，使用唯一 fixture，不触碰别人的数据。覆盖原 router 测试移走后的真实权限门禁。

```ts
it.skipIf(process.env.EXPORT_PG_TEST !== '1')('gates both exports and excludes unselected or foreign tables', async () => {
  const { db } = await import('../db');
  const s = await import('../db/schema');
  const { eq } = await import('drizzle-orm');
  const { exportBaseCsv, exportTableCsv } = await import('./csv');
  const id = randomUUID();
  try {
    await db.insert(s.workspace).values({ id, name: 'auth-test' });
    await db.insert(s.base).values({ id, workspaceId: id, name: 'auth-test' });
    await db.insert(s.table).values({ id, baseId: id, name: 'Test' });
    await expect(exportBaseCsv(id, 'outsider')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(exportTableCsv(id, 'outsider')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db.insert(s.baseMember).values({ baseId: id, userId: id, role: 'viewer' });
    expect(await exportBaseCsv(id, id, ['foreign-table'])).toEqual([]);
    expect(await exportBaseCsv(id, id, [])).toEqual([]);
    expect(await exportTableCsv(id, id)).toMatchObject({ exported: 0, truncated: false });
  } finally {
    await db.delete(s.base).where(eq(s.base.id, id));
    await db.delete(s.workspace).where(eq(s.workspace.id, id));
  }
}, 60000);
```

- [ ] **Step 8：验证与提交。** `pnpm test`、`pnpm typecheck`、上述 PG 测试全部通过后，仅 stage 此任务文件。

```bash
git add packages/plugin-sdk/src/index.ts packages/plugin-sdk/src/core-api.test-d.ts apps/web/src/server/plugins/core-api.ts packages/plugin-csv/src/server.ts packages/plugin-csv/src/server.test.ts apps/web/src/server/trpc/routers/export.ts apps/web/src/server/trpc/routers/export.test.ts apps/web/src/server/exports/csv.pg.test.ts
git commit -m "refactor: share complete CSV export across both entry points"
```

## Task 4：用户提示、文档与端到端验收

**Files:** 修改两个 settings 页面、`docs/STATUS.md`、`docs/api/routers.md`、ADR-0008、`CHANGELOG.md`。

**Interfaces:** Consumes 两个原方法的完整成功响应；Produces 用户可理解的成功/失败提示。保留已有下载与 catch/finally 流程。

- [ ] **Step 1：修改 Base 页面说明。** 替换导出段落内容为下列文案；删掉 `const truncated` 与截断分支，仅保留 `if (downloaded > 1)` 的浏览器提示。

```tsx
<p className="text-sm text-muted-foreground">
  Export every record in the selected tables as CSV. Current view filters do not apply.
  Each request supports up to 100,000 records per table and 8 MiB of CSV data.
  CSV does not include attachment files, permissions, or history; use an instance backup to preserve them.
</p>
```

- [ ] **Step 2：修改 General 页面成功提示。** 解构只保留 `{ csv, exported }`；删除 `if (truncated)` 分支，下载后执行：

```ts
toast.success(`Exported ${exported} records`);
```

- [ ] **Step 3：更新四处事实文档。** STATUS 的 CSV 行改为“导出预算内完整返回；每表 ≤100,000 行，每请求 ≤8 MiB，超限失败；CSV 非实例备份”；routers 文档保留入参和输出字段，说明 `truncated: false`；ADR-0008 追加“2026-10 完整导出通过 CoreServerApi.exports.tableCsv 复用只读快照服务”；CHANGELOG 的 Unreleased 增加两入口不再截断、共享预算及兼容字段。不要更新版本号、测试总数或发布日期为未经实际运行的值。
- [ ] **Step 4：浏览器验收。** 在一次性测试实例创建 viewer 与 owner，使用 10,001 行有编号的表；两入口下载均检查最后一行、总行数和唯一编号；选择两表验证两次下载提示。将字节超限 fixture 导出，确认只出现明确错误、不出现下载。用非成员账号请求确认拒绝；公开只读分享页面不新增导出能力。
- [ ] **Step 5：资源与失败验收。** 在真库测试实例使用 100,000 行 × 10 个短文本字段，记录响应时间与 `docker stats --no-stream`；单进程 1 GiB 配置不得 OOM。导出处理中第二请求应为 `TOO_MANY_REQUESTS`；制造数据库语句超时后下一次小表导出能成功。不能以提高内存配置掩盖预算问题；若此配置失败，降低页大小并复跑受影响测试。8 MiB 是输出预算，单页单元格与 JSON 序列化也有额外内存，不宣称严格 8 MiB 内存上限。
- [ ] **Step 6：运行发布前检查。**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e-api
EXPORT_PG_TEST=1 pnpm exec vitest run apps/web/src/server/exports/csv.pg.test.ts
```

build/API e2e 环境按 `tests/e2e/README.md` 设置。依赖服务未运行时记录“未执行”，不得记为通过。

- [ ] **Step 7：提交准确文档与 UI。**

```bash
git add 'apps/web/src/app/bases/[baseId]/settings/export/page.tsx' 'apps/web/src/app/bases/[baseId]/settings/general/page.tsx' docs/STATUS.md docs/api/routers.md docs/adr/0008-plugin-server-router-injection.md CHANGELOG.md
git commit -m "docs: explain complete CSV exports and backup boundaries"
```

## 自检覆盖

E1→Task 1/3；E2→Task 2；E3→Task 1/2/4；E4→Task 1/2/4；E5→Task 2/4；E6→Task 3/4。A2 实例备份在独立计划，不以 CSV 代替。导入、Form、Kanban 和获客页面不在本计划中。
