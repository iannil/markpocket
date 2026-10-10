# Airtable Migration Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有导入预览变成可对账、可真实验证、可回退安装的候选交付。

**Architecture:** 保留现有 importer、凭据生命周期和限制。新增展示层、只读 live 验收入口与本地安装/恢复证据，不发布版本。

**Tech Stack:** Node >=22, pnpm 10.32.1, PostgreSQL 16, Next.js 16, React 19, tRPC 11, Drizzle, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-10-airtable-p0-p2.md` — M1–M4。执行者先读规范和本计划；新签名以本计划 Interfaces 为准。

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

本计划可在 foundation 后独立执行。M3 的凭据缺失是唯一外部前置，不能拖延 G/P/K/I；不得自动搜索用户秘密文件获取 PAT。现有导入已实现，不扩大预算、不增加同步。

### Task 1: 导入结果对账与预算展示

**Files:**

- Create: `apps/web/src/components/airtable-import/import-report.tsx` — 可读结果
- Create: `apps/web/src/components/airtable-import/import-report.test.tsx` — 摘要与安全输出
- Modify: `apps/web/src/app/bases/import-airtable/page.tsx` — 挂接结果组件
- Modify: `apps/web/src/app/bases/import-airtable/page.test.tsx` — 预览与恢复
- Create: `apps/web/src/lib/airtable-import-limits.ts` — 可被客户端导入的纯预算常量
- Modify: `apps/web/src/server/imports/airtable/client.ts` — 复用预算常量
- Modify: `docs/AIRTABLE_IMPORT.md` — 对账与预算说明

**Interfaces:**

- Consumes: 既有 `ImportReport` 与 `Preflight`。
- Produces: `ImportReportView({report}:{report:ImportReport}):React.JSX.Element`；`AIRTABLE_LIMITS` 保持 client.ts 现有键名和值，移到纯模块后 re-export。

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import {ImportReportView} from './import-report';
afterEach(cleanup);
it('shows converted fields and table counts without claiming live calculations',()=>{
 render(<ImportReportView report={{requestId:'request',sourceBaseId:'appSource',baseId:'target',records:2,cells:4,attachments:1,attachmentBytes:12,tables:[{sourceId:'src',targetId:'dst',name:'People',records:2}],issues:[{tableId:'src',tableName:'People',fieldId:'f',fieldName:'Total',kind:'snapshot',message:'Static result'}]}}/>);
 expect(screen.getByText('People')).toBeTruthy();
 expect(screen.getByText('Static snapshots')).toBeTruthy();
 expect(screen.getByText('Total')).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run apps/web/src/components/airtable-import/import-report.test.tsx apps/web/src/app/bases/import-airtable/page.test.tsx apps/web/src/server/imports/airtable/client.test.ts
```

Expected: FAIL：新接口不存在或新断言不满足；不得把数据库未连接、测试 skip 或无测试匹配当作 RED。

- [ ] **Step 3: Implement the tested behavior in small edits**

- [ ] **Edit 1:** 组件显示总记录/单元格/已复制附件数及字节、每表 source/target ID 和行数、两类 issues。所有源名称使用 React 文本节点，不 dangerouslySetInnerHTML；仅通过 target baseId 构造本地链接；原 JSON 下载调用保持不动。

```tsx
export function ImportReportView({report}:{report:ImportReport}) {
 return <section aria-label="Import reconciliation">
  <p>{report.records} records · {report.cells} cells · {report.attachments} attachments</p>
  <table><thead><tr><th>Table</th><th>Records</th><th>Source</th><th>Target</th></tr></thead>
   <tbody>{report.tables.map(t=><tr key={t.sourceId}><td>{t.name}</td><td>{t.records}</td><td>{t.sourceId}</td><td>{t.targetId}</td></tr>)}</tbody>
  </table>
  {(['snapshot','skip'] as const).map(kind=><section key={kind}>
   <h3>{kind==='snapshot'?'Static snapshots':'Skipped fields'}</h3>
   <ul>{report.issues.filter(i=>i.kind===kind).map(i=><li key={`${i.tableId}:${i.fieldId}`}>{i.fieldName}: {i.message}</li>)}</ul>
  </section>)}
 </section>;
}
```

- [ ] **Edit 2:** 增加 attachmentBytes 的 IEC 格式化和静态字段说明 `These values will not recalculate.`。预览页从纯常量列出 M2 所有限制；表/字段数显示 schema 已知数值，records/cells/files/bytes/deadline 标记 Checked during import。绝不额外遍历全部源记录称作快速预检。刷新恢复完成状态同样渲染组件。

- [ ] **Step 4: Verify the deliverable**

```bash
pnpm exec vitest run apps/web/src/components/airtable-import/import-report.test.tsx apps/web/src/app/bases/import-airtable/page.test.tsx apps/web/src/server/imports/airtable/client.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit this deliverable**

```bash
git add -- apps/web/src/components/airtable-import/import-report.tsx apps/web/src/components/airtable-import/import-report.test.tsx apps/web/src/app/bases/import-airtable/page.tsx apps/web/src/app/bases/import-airtable/page.test.tsx apps/web/src/lib/airtable-import-limits.ts apps/web/src/server/imports/airtable/client.ts docs/AIRTABLE_IMPORT.md
git diff --cached --check
git commit -m "feat: add readable Airtable import reconciliation"
```

### Task 2: 只读真实 Airtable 验收与精确差异比较

**Files:**

- Create: `apps/web/src/server/imports/airtable/reconcile.ts` — 集合和字节对账
- Create: `apps/web/src/server/imports/airtable/reconcile.test.ts` — 错误报告不泄漏源内容
- Create: `apps/web/src/server/imports/airtable/live.pg.test.ts` — 真实源端到端
- Modify: `docs/AIRTABLE_IMPORT.md` — live fixture 和运行要求

**Interfaces:**

- Consumes: `createAirtableSource()`、`createImportService`、`ImportReport`、schema source metadata。
- Produces: `assertIdSetEqual(expected:string[],actual:string[]):void`，错误仅显示缺失/多余计数；`sha256(bytes:Uint8Array):string`；live suite 环境 `AIRTABLE_LIVE_TEST=1`, `AIRTABLE_TEST_BASE_ID`, `AIRTABLE_TEST_PAT`。

- [ ] **Step 1: Write the failing test**

```ts
import {it,expect} from 'vitest';
import {assertIdSetEqual,sha256} from './reconcile';
it('detects duplicate and missing IDs even when counts match',()=>{
 expect(()=>assertIdSetEqual(['a','b'],['a','a'])).toThrow();
 expect(()=>assertIdSetEqual(['a','b'],['b','a'])).not.toThrow();
 expect(sha256(Buffer.from('a'))).not.toBe(sha256(Buffer.from('b')));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run apps/web/src/server/imports/airtable/reconcile.test.ts
```

Expected: FAIL：新接口不存在或新断言不满足；不得把数据库未连接、测试 skip 或无测试匹配当作 RED。

- [ ] **Step 3: Implement the tested behavior in small edits**

```ts
import {createHash} from 'node:crypto';
export const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export function assertIdSetEqual(expected:string[],actual:string[]) {
 const a=new Set(actual), e=new Set(expected);
 const missing=[...e].filter(id=>!a.has(id)).length;
 const extra=[...a].filter(id=>!e.has(id)).length;
 if(a.size!==actual.length || e.size!==expected.length || missing || extra)
   throw Error(`Record reconciliation failed: missing=${missing}, extra=${extra}, duplicates=${actual.length-a.size}`);
}
```

- [ ] **Edit 1:** live test 基于既有 acceptance.pg.test.ts 的 fixture 生命周期，但 `source:()=>createAirtableSource()` 不替换 network。环境 gate 未开默认 skip；gate=1 缺 Base/PAT 必须 throw，不 skip。要求使用专门静止测试 Base：People 至少 101 行、Teams 至少 1 行、一个跨表 link、两种 single-select、一 true 一 false/缺省 checkbox、一个含已知内容的附件、一个 formula、一个 unsupported button。先用真实 schema 按 source type 找字段，契约不满足 fail。

- [ ] **Edit 2:** 运行顺序：读取 schema/preflight→源 records 全量采样（预算内）→service.startImport→按 report.tables targetId 读取 DB。以 sourceRecordId 元数据定位 ID 列，逐表 assertIdSetEqual；用来源 ID 映射检查所有链接；比对源选择名称映射 target option ID、checkbox 缺省 false；源附件 `source.attachment(url,signal)` bytes 与 target storageKey 文件 bytes 的 sha256 相等；核对 snapshot/skip 报告；相同 requestId 再调用返回原 baseId。再读一次源 ID 和字段值哈希检测源在运行中变化，变化则验收无效，不判 importer 成功。

```ts
const enabled=process.env.AIRTABLE_LIVE_TEST==='1';
describe.skipIf(!enabled)('live Airtable',()=>{
 it('requires explicit credentials',()=>{
  expect(process.env.AIRTABLE_TEST_BASE_ID).toMatch(/^app/);
  expect(Boolean(process.env.AIRTABLE_TEST_PAT)).toBe(true);
 });
});
```

- [ ] **Edit 3:** 在同一 live.pg.test.ts 增加真实源到 DB 的集合与幂等主路径，补充以上字段/附件断言后作为最终验收；下面主路径不能被 credentials-only 用例替代：

```ts
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {eq} from 'drizzle-orm';
import {withDbFixture} from '../../testing/pg-fixture';
import {db} from '../../db';
import * as s from '../../db/schema';
import {createAirtableSource} from './client';
import {createImportService} from './service';
import {createImporter} from './importer';
import {assertIdSetEqual} from './reconcile';

it.skipIf(process.env.AIRTABLE_LIVE_TEST!=='1')('imports live source ID sets and replays its receipt',async()=>withDbFixture(async f=>{
 const token=process.env.AIRTABLE_TEST_PAT,sourceBaseId=process.env.AIRTABLE_TEST_BASE_ID;
 if(!token || !sourceBaseId)throw Error('Live fixture credentials required');
 const dir=await mkdtemp(join(tmpdir(),'markpocket-live-'));
 const oldUploads=process.env.UPLOAD_DIR;
 process.env.UPLOAD_DIR=join(dir,'uploads');
 let targetBaseId:string|undefined;
 try {
  const [ownerBase]=await db.select().from(s.base).where(eq(s.base.id,f.baseId));
  const source=createAirtableSource();
  const service=createImportService({source:()=>createAirtableSource(),importer:createImporter({workspaceId:ownerBase!.workspaceId,journalDir:join(dir,'journal')})});
  const preview=await service.preflightImport(f.userId,sourceBaseId,token);
  const expected=new Map<string,string[]>();
  const signal=AbortSignal.timeout(120000);
  for(const t of preview.tables) {
   const ids:string[]=[];
   for await(const page of source.records(sourceBaseId,t.sourceId,token,signal))ids.push(...page.map(r=>r.id));
   expected.set(t.sourceId,ids);
  }
  const input={requestId:randomUUID(),sourceBaseId,token,name:'Live acceptance',schemaHash:preview.schemaHash,acceptLosses:true};
  const report=await service.startImport(f.userId,input);targetBaseId=report.baseId;
  for(const t of report.tables) {
   const fields=await db.select().from(s.field).where(eq(s.field.tableId,t.targetId));
   const sourceIdField=fields.find(x=>(x.options as {sourceRecordId?:boolean}).sourceRecordId);
   if(!sourceIdField)throw Error('Missing source ID field');
   const cells=await db.select().from(s.cell).where(eq(s.cell.fieldId,sourceIdField.id));
   assertIdSetEqual(expected.get(t.sourceId)!,cells.map(c=>String(c.value)));
  }
  expect((await service.startImport(f.userId,{...input,token:''})).baseId).toBe(report.baseId);
 } finally {
  if(targetBaseId)await db.delete(s.base).where(eq(s.base.id,targetBaseId));
  if(oldUploads===undefined)delete process.env.UPLOAD_DIR;else process.env.UPLOAD_DIR=oldUploads;
  await rm(dir,{recursive:true,force:true});
 }
}),180000);
```

- [ ] **Edit 4:** 实现完整端到端用例时将上述检查加入同一个隔离 fixture 的 try/finally，追踪创建的目标 baseId/附件目录后仅删除这些资源；不在 assertion 中打印源对象/PAT/URL，不 snapshot 凭据。对外网络失败记录失败阶段与错误码，不把真实运行改成 mock 重跑来宣称通过。文档保留 preview，只有 live 成功和 M4 完成才可在候选说明中移除“未验证”。

- [ ] **Step 4: Verify the deliverable**

```bash
pnpm exec vitest run apps/web/src/server/imports/airtable/reconcile.test.ts
```

Expected: PASS。额外执行 `AIRTABLE_LIVE_TEST=1 P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/imports/airtable/live.pg.test.ts`。未提供凭据记录 blocked，继续其他任务。

- [ ] **Step 5: Commit this deliverable**

```bash
git add -- apps/web/src/server/imports/airtable/reconcile.ts apps/web/src/server/imports/airtable/reconcile.test.ts apps/web/src/server/imports/airtable/live.pg.test.ts docs/AIRTABLE_IMPORT.md
git diff --cached --check
git commit -m "test: add opt-in live Airtable reconciliation"
```

### Task 3: 固定候选镜像安装升级与旧快照恢复

**Files:**

- Modify: `docs/UPGRADE.md` — 新迁移清单与回退步骤
- Modify: `docs/BACKUP.md` — 表单/Webhook key 备份要求
- Create: `docs/release/2026-10-10-p0-p2-evidence.md` — 实际命令和证据

**Interfaces:**

- Consumes: 现有 `scripts/backup-instance.sh`、`Dockerfile`、`docker-compose.yml`、旧恢复 evidence。
- Produces: 可复现候选安装/升级/恢复记录；不产生外部 release。

- [ ] **Step 1: Write the failing test**

先建立验收断言表，填写前必须实际观测：

```text
Fresh: /api/health = HTTP 200; pending migration count = 0
Upgrade: original record IDs and attachment SHA256 unchanged
Restore: old image + pre-upgrade DB + matching uploads => original IDs/SHA256 unchanged
Negative: missing webhook key => delivery disabled; pending deliveries retained
```

此任务是运维验收，不为文档编写无意义单元测试；首次失败就是候选不能交付的证据。

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run apps/web/src/server/imports/airtable/reconcile.test.ts
```

Expected: 先执行上面的 Fresh/Upgrade/Restore 运维断言；RED 是任意恢复校验失败。下方命令仅验证对账工具，不替代镜像验收。

- [ ] **Step 3: Implement the tested behavior in small edits**

- [ ] **Edit 1:** 从总计划专用 PG 与临时 compose project 操作，不碰现有端口 7420/7419/7400。先记录起点 `git rev-parse HEAD` 和本地旧镜像 ID；旧镜像未存在时从起点受控 checkout 构建，不用网络不明 latest。candidate 在全量实现后复跑，记录实际 SHA。

```bash
git rev-parse HEAD
docker build -t markpocket:p0p2-candidate .
docker image inspect markpocket:p0p2-candidate --format '{{.Id}}'
```

- [ ] **Edit 2:** 按已有 BACKUP.md 的准确参数调用 backup-instance.sh，备份 DB 与附件（冻结写入），同时离线保管 WEBHOOK_ENCRYPTION_KEY。恢复到新的专用 DB/目录，不能覆盖原实例；旧版本回退必须配同版本 schema 快照，不执行不存在的 down migration。新数据/表单提交在备份后发生会在快照恢复时丢失，操作说明明确恢复点。

- [ ] **Edit 3:** M4 第一次可验收导入候选；所有 F/P/I 迁移完成后总计划最终门槛再次验收最终候选。evidence 按“命令、退出码、记录集合、附件哈希、版本、未运行项”写实际值；不能先填 PASS。更新 UPGRADE 的实际生成迁移编号。

- [ ] **Step 4: Verify the deliverable**

```bash
pnpm exec vitest run apps/web/src/server/imports/airtable/reconcile.test.ts
```

Expected: PASS。完成运维四项断言及后续总计划最终候选复验；所有 evidence 如实记录。

- [ ] **Step 5: Commit this deliverable**

```bash
git add -- docs/UPGRADE.md docs/BACKUP.md docs/release/2026-10-10-p0-p2-evidence.md
git diff --cached --check
git commit -m "docs: record candidate installation and recovery evidence"
```

## Completion Gate

- [ ] 对照 Spec 的本节逐条核验，并记录证据到 `docs/release/2026-10-10-p0-p2-evidence.md` 对应子项目；不得把未运行的检查写成通过。
- [ ] 更新 `docs/STATUS.md`、`CHANGELOG.md` 与本计划直接关联的用户文档；区分已实现、fixture 验证、live 验证、已发布。
- [ ] 运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`；包含数据库变更时运行本计划 PG 测试并确认没有跳过。
- [ ] 仅 stage 本次变更；提交文档与生成迁移时列出真实生成路径。用户已有修改保持不动。
