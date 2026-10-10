# Atomic Record Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为粘贴和公共表单提供可回滚、可重试且保留历史的写入入口。

**Architecture:** 抽出既有 cell 事务内逻辑，不改变旧 upsert 响应。新增有界批量写和持久收据；匿名 Form 通过内部 service 使用相同写入语义。

**Tech Stack:** Node >=22, pnpm 10.32.1, PostgreSQL 16, Next.js 16, React 19, tRPC 11, Drizzle, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-10-airtable-p0-p2.md` — F1–F3。执行者先读规范和本计划；新签名以本计划 Interfaces 为准。

## Global Constraints

- Node >=22；pnpm 10.32.1；PostgreSQL 16；沿用 Next.js 16、React 19、tRPC 11、Drizzle、Vitest 3。
- 单租户自托管；一个应用进程加 PostgreSQL；不引入 Redis、外部队列、额外常驻服务或新的运行时依赖。
- 保持 ADR-0001/0003/0004：表设计小于 100,000 行；Expression Field 单记录作用域；不增加 Lookup/Rollup、公式依赖图或多租户。
- 写操作沿用 ADR-0005：empty 删除 cell、非法值拒绝、每次实际改值记录历史、Expression 在同事务物化；实时通知在提交后发送。
- 基于现行 Paper & Ink 设计；界面文案使用英文；不显示未交付的视图类型；支持键盘与窄屏。
- API 与 UI 均执行成员权限；公开表单仅授予提交能力，不授予读取记录、附件或成员的能力。
- 不保存 Airtable PAT；不输出凭据、完整 Webhook URL 查询参数或签名密钥到日志与报告。
- 保留用户现有 .gitignore、CLAUDE.md 删除和 apps/web/next-env.d.ts 修改；不得使用 git add . 或恢复这些改动。
- 新子系统必须随实现提交 ADR；数据库迁移使用 pnpm db:generate，不手改已应用迁移或猜测迁移编号。
- 每个子项目独立提交；不推送分支、创建发布 tag、发布镜像或部署外部服务。

---

## File Structure and Dependencies

先执行本计划。`server/records/` 只负责事务写入，`server/testing/` 只在测试导入。现有 `cell.ts` 很长，本次仅抽写入主体，不重构全项目。PG 测试统一 `P0_P2_PG_TEST=1`；未设置视为 skip，不是验收通过。

### Task 1: 建立隔离 PG 契约测试与写入 ADR

**Files:**

- Create: `apps/web/src/server/testing/pg-fixture.ts` — PG fixture
- Create: `apps/web/src/server/testing/pg-fixture.test.ts` — 隔离与权限断言
- Create: `docs/adr/0011-atomic-record-writes.md` — 锁定写入契约

**Interfaces:**

- Consumes: `appRouter.createCaller(Context)`、既有 schema。
- Produces: `withDbFixture<T>(run:(fixture)=>Promise<T>):Promise<T>`，完整 fixture 类型在实现代码中。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { withDbFixture } from './pg-fixture';
describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('isolated fixture', () => {
  it('gives an owner and a viewer distinct permissions', async () => {
    await withDbFixture(async f => {
      expect((await f.caller.record.list({ tableId: f.tableId })).total).toBe(0);
      await expect(f.viewer.record.create({ tableId: f.tableId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/testing/pg-fixture.test.ts
```

Expected: FAIL：新接口不存在或新断言不满足；不得把数据库未连接、测试 skip 或无测试匹配当作 RED。

- [ ] **Step 3: Implement the tested behavior in small edits**

- [ ] **Edit 1:** 创建 `server/testing/pg-fixture.ts`，所有新 PG 测试复用，禁止 mock 数据库：

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { appRouter } from '../trpc/router';
import type { Context } from '../trpc/init';
export async function withDbFixture<T>(run: (f: {
  userId: string; viewerId: string; baseId: string; tableId: string;
  textId: string; numberId: string;
  caller: ReturnType<typeof appRouter.createCaller>;
  viewer: ReturnType<typeof appRouter.createCaller>;
}) => Promise<T>): Promise<T> {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://invalid/invalid');
  if (!url.pathname.startsWith('/markpocket_p0p2_')) throw Error('Isolated database required');
  const userId = randomUUID(), viewerId = randomUUID(), workspaceId = randomUUID();
  const baseId = randomUUID(), tableId = randomUUID(), textId = randomUUID(), numberId = randomUUID();
  const caller = (id: string) => appRouter.createCaller({ session: { user: { id } } } as Context);
  try {
    await db.insert(s.user).values([userId, viewerId].map(id => ({id, name: 'Plan fixture', email: `${id}@example.test`})));
    await db.insert(s.workspace).values({ id: workspaceId, name: 'Plan fixture' });
    await db.insert(s.base).values({ id: baseId, workspaceId, name: 'Plan fixture', createdBy: userId });
    await db.insert(s.baseMember).values([{baseId,userId,role:'owner'}, {baseId,userId:viewerId,role:'viewer'}]);
    await db.insert(s.table).values({ id: tableId, baseId, name: 'Plan fixture' });
    await db.insert(s.field).values([{id:textId,tableId,name:'Name',type:'text'}, {id:numberId,tableId,name:'Amount',type:'number'}]);
    return await run({userId,viewerId,baseId,tableId,textId,numberId,caller:caller(userId),viewer:caller(viewerId)});
  } finally {
    await db.delete(s.base).where(eq(s.base.id,baseId));
    await db.delete(s.workspace).where(eq(s.workspace.id,workspaceId));
    await db.delete(s.user).where(eq(s.user.id,userId));
    await db.delete(s.user).where(eq(s.user.id,viewerId));
  }
}
```

- [ ] **Edit 2:** 新公共写入子系统 ADR `0011-atomic-record-writes.md` 记录 F1–F3 的事务、锁、收据、匿名 actor 和预算决定。Fixture 建立/清理只碰随机命名资源；后续新增无 FK 的收据要在 fixture finally 中按 actorKey 清理。独立 PG 的启动/连接命令见总计划，不能对现有开发 DB 运行破坏性测试。

- [ ] **Step 4: Verify the deliverable**

```bash
P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/testing/pg-fixture.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit this deliverable**

```bash
git add -- apps/web/src/server/testing/pg-fixture.ts apps/web/src/server/testing/pg-fixture.test.ts docs/adr/0011-atomic-record-writes.md
git diff --cached --check
git commit -m "test: add isolated record workflow fixtures"
```

### Task 2: 抽取事务内单格写入，保持现有 upsert 行为

**Files:**

- Create: `apps/web/src/server/records/write-cell.ts` — 归属、引用、cell/history 写入
- Modify: `apps/web/src/server/trpc/routers/cell.ts` — 委托事务 helper
- Modify: `apps/web/src/server/expression.ts` — 允许匿名 actor
- Create: `apps/web/src/server/records/write-cell.pg.test.ts` — 历史与回滚测试

**Interfaces:**

- Consumes: `DbTx` from `server/expression.ts`、`normalizeCellValue(type,options,raw)`。
- Produces: `writeCellInTransaction(tx:DbTx,input:{recordId:string;fieldId:string;value:unknown;actorId:string|null;recompute?:boolean}):Promise<{normalized:Exclude<NormalizedCell,{error:string}>;overwroteRecentBy:{userId:string}|null;recomputed:RecomputedCell[]}>`；`assertCellValueReferable` 移入同文件私有实现。

- [ ] **Step 1: Write the failing test**

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '../db';
import { withDbFixture } from '../testing/pg-fixture';
import { writeCellInTransaction } from './write-cell';
import { record, cell, cellHistory } from '../db/schema';
import { eq } from 'drizzle-orm';
describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('atomic cell', () => {
  it('rolls back value and history together', async () => withDbFixture(async f => {
    const id=randomUUID(), value=randomUUID();
    await db.insert(record).values({id,tableId:f.tableId});
    await expect(db.transaction(async tx => {
      await writeCellInTransaction(tx,{recordId:id,fieldId:f.textId,value,actorId:null});
      throw Error('abort');
    })).rejects.toThrow('abort');
    expect(await db.select().from(cell).where(eq(cell.recordId,id))).toHaveLength(0);
    expect(await db.select().from(cellHistory).where(eq(cellHistory.newValue,value))).toHaveLength(0);
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/records/write-cell.pg.test.ts apps/web/src/server/trpc/routers/field-record-cell.test.ts apps/web/src/server/trpc/routers/field-validation.test.ts
```

Expected: FAIL：新接口不存在或新断言不满足；不得把数据库未连接、测试 skip 或无测试匹配当作 RED。

- [ ] **Step 3: Implement the tested behavior in small edits**

- [ ] **Edit 1:** 将 `cell.ts` 的 `assertCellValueReferable` 与 `db.transaction(async (tx)=>...)` 内部值写入主体整体移动，保留 FOR SHARE 引用验证、历史、recent overwrite 语义，但统一改为 record row lock 在 cell advisory lock 之前，以匹配批量写并避免 AB-BA 死锁。helper 内自己读取 field/record 并检查同表；角色门禁保留在 router，不让匿名表单依赖伪造用户会话。抽取后 upsert 的事务调用为：

```ts
const result = await mapBusyToConflict(db.transaction(tx =>
  writeCellInTransaction(tx, {
    recordId: input.recordId, fieldId: input.fieldId,
    value: input.value, actorId: ctx.session.user.id,
  })
));
void publishTableChange(fld.tableId, ctx.session.user.id);
return { ...result.normalized, overwroteRecentBy:result.overwroteRecentBy, recomputed:result.recomputed };
```

- [ ] **Edit 2:** helper 将原 `ctx.session.user.id` 替换为 `input.actorId`；`recentOverwriteBy` 对 actorId=null 不执行“同用户”排除。拒绝 expression 字段直接写。recompute 默认 true；false 时返回空 recomputed，由批量调用者每行最后一次 materialize。`expression.ts` 的 writeExpressionCell / materializeExpressionsForRecord / backfillExpressionField 中 actor 参数统一 `string|null`，保留现有 string 调用兼容。禁止从 helper 单独开事务或发送通知。

- [ ] **Edit 3:** 补充已有 cell router suites：清空 cell 仍保留 history、非法外表 record/附件拒绝、并发单格+批量同 record 无死锁、并发删除不给死 link、表达式返回保持一致。以原 `field-record-cell.test.ts` 和 `field-validation.test.ts` 作为回归，不能删除旧断言适配重构。

- [ ] **Step 4: Verify the deliverable**

```bash
P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/records/write-cell.pg.test.ts apps/web/src/server/trpc/routers/field-record-cell.test.ts apps/web/src/server/trpc/routers/field-validation.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit this deliverable**

```bash
git add -- apps/web/src/server/records/write-cell.ts apps/web/src/server/trpc/routers/cell.ts apps/web/src/server/expression.ts apps/web/src/server/records/write-cell.pg.test.ts
git diff --cached --check
git commit -m "refactor: share transactional cell writes"
```

### Task 3: 有界原子批量写、收据与受保护路由

**Files:**

- Create: `apps/web/src/server/records/write-batch.ts` — 批量服务与校验
- Create: `apps/web/src/server/records/write-batch.pg.test.ts` — 回滚与重复提交
- Modify: `apps/web/src/server/db/schema.ts` — writeReceipt
- Modify: `apps/web/src/server/trpc/routers/record.ts` — writeBatch mutation
- Modify: `apps/web/src/server/testing/pg-fixture.ts` — 清理收据

**Interfaces:**

- Consumes: `writeCellInTransaction`、`withDbFixture`。
- Produces: `BatchInput={tableId:string;requestId:string;rows:{recordId?:string;cells:Record<string,unknown>}[]}`；`BatchResult={recordIds:string[];created:number;updated:number}`；`writeBatchInTransaction(tx:DbTx,actor:{key:string;userId:string|null},input:BatchInput):Promise<BatchResult>`；`writeBatch(userId:string,input:BatchInput):Promise<BatchResult>`。
- Router: `record.writeBatch(BatchInput):BatchResult`。Form 只调用 transaction 版本。

- [ ] **Step 1: Write the failing test**

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { withDbFixture } from '../testing/pg-fixture';
describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('batch writes', () => {
  it('rejects the entire batch then safely replays successful creates',async()=>withDbFixture(async f=>{
    await expect(f.caller.record.writeBatch({tableId:f.tableId,requestId:randomUUID(),rows:[
      {cells:{[f.textId]:'valid'}},{cells:{[f.numberId]:'not-a-number'}}
    ]})).rejects.toMatchObject({code:'BAD_REQUEST'});
    expect((await f.caller.record.list({tableId:f.tableId})).total).toBe(0);
    const input={tableId:f.tableId,requestId:randomUUID(),rows:[{cells:{[f.textId]:'one'}}]};
    const [a,b]=await Promise.all([f.caller.record.writeBatch(input),f.caller.record.writeBatch(input)]);
    expect(a).toEqual(b);
    expect((await f.caller.record.list({tableId:f.tableId})).total).toBe(1);
    await expect(f.caller.record.writeBatch({...input,rows:[{cells:{[f.textId]:'two'}}]})).rejects.toMatchObject({code:'CONFLICT'});
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/records/write-batch.pg.test.ts
```

Expected: FAIL：新接口不存在或新断言不满足；不得把数据库未连接、测试 skip 或无测试匹配当作 RED。

- [ ] **Step 3: Implement the tested behavior in small edits**

- [ ] **Edit 1:** Schema：`write_receipt` 包含 actorKey text、requestId uuid 联合主键、bodyHash text、result jsonb、createdAt timestamptz defaultNow；createdAt index。生成迁移并把实际文件和 meta 变更逐个加入提交。

```ts
export const batchInputSchema = z.object({
  tableId:z.string().min(1), requestId:z.string().uuid(),
  rows:z.array(z.object({recordId:z.string().min(1).optional(),cells:z.record(z.string(),z.unknown())})).min(1).max(100),
}).superRefine((v,ctx)=>{
  if(v.rows.reduce((n,r)=>n+Object.keys(r.cells).length,0)>500 || Buffer.byteLength(JSON.stringify(v),'utf8')>1048576)
    ctx.addIssue({code:'custom',message:'Paste exceeds the batch limit'});
});
```

- [ ] **Edit 2:** 在 transaction helper 内先验证 schema，规范化 rows 中 cells 的 key 排序后 SHA256（不排序 rows），锁 `write-receipt:<actor.key>:<requestId>`；查询 existing，bodyHash 不等抛 CONFLICT，相同返回 result。按 recordId 排序锁定所有现有 records，再稳定 fieldId 排序调用 helper(recompute:false)。禁止重复 recordId，field 空集合创建允许但仍算行预算。创建 rows 的返回顺序保持输入顺序，不能返回排序后顺序。每行末尾调用 materializeExpressionsForRecord(tx,tableId,recordId,actor.userId)，写 result 收据同事务提交。

```ts
export async function writeBatch(userId:string,input:BatchInput):Promise<BatchResult> {
  await assertTableRole(input.tableId,userId,'editor');
  const result=await mapBusyToConflict(db.transaction(async tx=>{
    await tx.execute(sql`select set_config('statement_timeout','30000',true)`);
    return writeBatchInTransaction(tx,{key:`user:${userId}`,userId},input);
  }));
  void publishTableChange(input.tableId,userId);
  return result;
}
```

- [ ] **Edit 3:** `recordRouter.writeBatch` 用 batchInputSchema 和 ctx.session.user.id 调用该函数。语义错误映射 BAD_REQUEST，资源未知 NOT_FOUND，不返回 SQL。每个写入口以小批量 DELETE 清理自身 actorKey 下超过 7 天的收据（最多 100 条），不删除仍保留的幂等窗口。增加 501 cells、101 rows、1MiB、多字节、viewer、错表、同请求并发以及表达式最后结果测试。

```bash
pnpm db:generate
pnpm db:migrate
```

- [ ] **Edit 4:** 执行 migration 前确认 DATABASE_URL 是总计划专用实例。

- [ ] **Step 4: Verify the deliverable**

```bash
P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/records/write-batch.pg.test.ts
```

Expected: PASS。完成后旧 REST createRecordWithCells 仍保留 cellErrors 部分成功协议；不更改其公开契约。

- [ ] **Step 5: Commit this deliverable**

```bash
git add -- apps/web/src/server/records/write-batch.ts apps/web/src/server/records/write-batch.pg.test.ts apps/web/src/server/db/schema.ts apps/web/src/server/trpc/routers/record.ts apps/web/src/server/testing/pg-fixture.ts
git diff --cached --check
git commit -m "feat: add atomic idempotent record batches"
```

## Completion Gate

- [ ] 对照 Spec 的本节逐条核验，并记录证据到 `docs/release/2026-10-10-p0-p2-evidence.md` 对应子项目；不得把未运行的检查写成通过。
- [ ] 更新 `docs/STATUS.md`、`CHANGELOG.md` 与本计划直接关联的用户文档；区分已实现、fixture 验证、live 验证、已发布。
- [ ] 运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`；包含数据库变更时运行本计划 PG 测试并确认没有跳过。
- [ ] 仅 stage 本次变更；提交文档与生成迁移时列出真实生成路径。用户已有修改保持不动。
