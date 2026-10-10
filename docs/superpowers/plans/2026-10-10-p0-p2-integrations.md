# Scoped Tokens and Reliable Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付按 Base/读写/有效期约束的 Token，以及可观测、可重试的有限 Webhook 自动化。

**Architecture:** Token 在共享请求作用域执行能力交集。Webhook 使用 PostgreSQL 事务 outbox 和同进程 worker，通知只含记录 ID，消费者用受限 API 拉取内容。

**Tech Stack:** Node >=22, pnpm 10.32.1, PostgreSQL 16, Next.js 16, React 19, tRPC 11, Drizzle, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-10-airtable-p0-p2.md` — I1–I8。执行者先读规范和本计划；新签名以本计划 Interfaces 为准。

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

依赖 foundation/forms/kanban 的最终 schema，但 token 部分可独立验收。ADR-0015 是允许 PostgreSQL outbox 的明确新设计；仍不引入外部队列。每次 schema 改动生成新迁移；不要所有任务预先占用编号。代码块是核心实现，所有额外边界按每个 task 的文字契约实现。

### Task 1: Token 范围模型与持久化

**Files:**

- Modify: `apps/web/src/server/db/schema.ts` — access/baseId token 字段
- Modify: `apps/web/src/server/agent-access/tokens.ts` — mint/resolve 范围与到期边界
- Modify: `apps/web/src/server/trpc/routers/token.ts` — 创建与展示选项
- Create: `apps/web/src/server/agent-access/scope.ts` — 请求作用域/纯能力门禁
- Create: `apps/web/src/server/agent-access/scope.test.ts` — 范围交集
- Modify: `apps/web/src/server/agent-access/tokens.test.ts` — 过期边界
- Create: `docs/adr/0014-scoped-agent-tokens.md` — 能力模型

**Interfaces:**

- Consumes: ResolvedToken、assertRole 现行角色。
- Produces: `TokenScope={tokenId:string;userId:string;baseId:string|null;access:"read"|"write"}`；`runWithTokenScope<T>(scope:TokenScope,fn:()=>T):T`、`currentTokenScope():TokenScope|undefined`、`assertTokenCapability(baseId:string,minRole:Role):void`；ResolvedToken 扩展 baseId/access。
- `createApiToken(userId,name,options?:{baseId:string|null;access:"read"|"write";expiresAt:Date|null})`；省略参数仅兼容旧测试/调用为 write/all，UI 不省略。

- [ ] **Step 1: Write the failing test**

```ts
import {expect,it} from 'vitest';
import {runWithTokenScope,assertTokenCapability,currentTokenScope} from './scope';
it('intersects base and write constraints without leaking across requests',async()=>{
 const a={tokenId:'t',userId:'u',baseId:'a',access:'read' as const};
 await runWithTokenScope(a,async()=>{
  expect(()=>assertTokenCapability('a','viewer')).not.toThrow();
  expect(()=>assertTokenCapability('a','editor')).toThrow();
  expect(()=>assertTokenCapability('b','viewer')).toThrow();
  await Promise.resolve();
  expect(currentTokenScope()?.baseId).toBe('a');
 });
 expect(currentTokenScope()).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run apps/web/src/server/agent-access/scope.test.ts apps/web/src/server/agent-access/tokens.test.ts apps/web/src/server/trpc/routers/token.test.ts
```

Expected: FAIL：新接口不存在或新断言不满足；不得把数据库未连接、测试 skip 或无测试匹配当作 RED。

- [ ] **Step 3: Implement the tested behavior in small edits**

```ts
import {AsyncLocalStorage} from 'node:async_hooks';
import {TRPCError} from '@trpc/server';
import type {Role} from '@/lib/roles';
export type TokenScope={tokenId:string;userId:string;baseId:string|null;access:'read'|'write'};
const scopes=new AsyncLocalStorage<TokenScope>();
export const currentTokenScope=()=>scopes.getStore();
export const runWithTokenScope=<T>(scope:TokenScope,fn:()=>T):T=>scopes.run(scope,fn);
export function assertTokenCapability(baseId:string,minRole:Role):void {
 const s=currentTokenScope();
 if(!s) return;
 if((s.baseId!==null && s.baseId!==baseId) || (s.access==='read' && minRole!=='viewer'))
  throw new TRPCError({code:'FORBIDDEN',message:'Token does not allow this operation'});
}
```

- [ ] **Edit 1:** apiToken.access text NOT NULL default write，apiToken.baseId nullable FK base ON DELETE CASCADE（不能 SET NULL，否则删除限定 Base 会扩大 token）。expiresAt 已存在不重复加列。create input `{name,baseId:z.string().nullable(),access:z.enum(['read','write']),expiresInDays:z.number().int().min(1).max(365).nullable()}`；保留旧 API 省略字段行为但页面明确默认 read/current Base/30 天。限定 Base mint 前 assertRole viewer，write 需 editor；all-token 不授予新成员权限。resolve 选择新字段，expiresAt.getTime()<=Date.now() 返回 null。

- [ ] **Edit 2:** 生成迁移并验证旧 token access=write/baseId=null；list 返回 access/baseId/expiresAt，不包含 tokenHash；create 全 secret 仍只返回一次。scope 模块 runtime 不导入 roles，只用 import type，避免循环依赖。

- [ ] **Step 4: Verify the deliverable**

```bash
pnpm exec vitest run apps/web/src/server/agent-access/scope.test.ts apps/web/src/server/agent-access/tokens.test.ts apps/web/src/server/trpc/routers/token.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit this deliverable**

```bash
git add -- apps/web/src/server/db/schema.ts apps/web/src/server/agent-access/tokens.ts apps/web/src/server/trpc/routers/token.ts apps/web/src/server/agent-access/scope.ts apps/web/src/server/agent-access/scope.test.ts apps/web/src/server/agent-access/tokens.test.ts docs/adr/0014-scoped-agent-tokens.md
git diff --cached --check
git commit -m "feat: persist scoped expiring agent tokens"
```

### Task 2: REST/MCP 全路径能力门禁与 Token 设置页

**Files:**

- Modify: `apps/web/src/server/agent-access/http.ts` — runWithTokenScope 包裹整个 handler
- Modify: `apps/web/src/lib/roles.ts` — assertRole 能力交集
- Modify: `apps/web/src/server/trpc/init.ts` — token caller allowlist
- Modify: `apps/web/src/server/trpc/routers/base.ts` — 列表范围与 create 限制
- Create: `apps/web/src/server/agent-access/policy.ts` — 公开 procedure allowlist
- Create: `apps/web/src/server/agent-access/scoped-access.pg.test.ts` — REST/MCP 防绕过
- Modify: `apps/web/src/app/bases/[baseId]/settings/agent/page.tsx` — scope/期限 UI
- Modify: `apps/web/src/server/agent-access/skill-template.ts` — 文档强调 scope
- Modify: `docs/api/agent-access.md` — 迁移兼容行为

**Interfaces:**

- Consumes: currentTokenScope/assertTokenCapability；原 handleAgentRequest 和 MCP_TOOLS。
- Produces: `assertAgentProcedure(path:string,type:"query"|"mutation"|"subscription"):void`；REST/MCP JSON 错误沿用旧格式。

- [ ] **Step 1: Write the failing test**

```ts
import {describe,it,expect} from 'vitest';
import {withDbFixture} from '../testing/pg-fixture';
import {runWithTokenScope} from './scope';
import {getRecord} from './records-service';
import {MCP_TOOL_BY_NAME} from './mcp/tools';
describe.skipIf(process.env.P0_P2_PG_TEST!=='1')('scoped access',()=>{
 it('blocks direct reads, tRPC writes and MCP writes outside capability',async()=>withDbFixture(async f=>{
  const other=await f.caller.base.create({name:'Other'});
  try {
   const t=await f.caller.table.create({baseId:other.id,name:'Other'});
   const r=await f.caller.record.create({tableId:t.id});
   await runWithTokenScope({tokenId:'test',userId:f.userId,baseId:f.baseId,access:'read'},async()=>{
    expect((await f.caller.base.list()).map(b=>b.id)).toEqual([f.baseId]);
    await expect(getRecord(f.userId,r.id)).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(f.caller.token.create({name:'escape'})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(MCP_TOOL_BY_NAME.get('create_record')!.execute({caller:f.caller,userId:f.userId},{tableId:f.tableId})).rejects.toMatchObject({code:'FORBIDDEN'});
   });
  } finally {await f.caller.base.delete({id:other.id});}
 }));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/agent-access/scoped-access.pg.test.ts apps/web/src/server/agent-access/http.test.ts apps/web/src/server/agent-access/mcp/server.test.ts
```

Expected: FAIL：新接口不存在或新断言不满足；不得把数据库未连接、测试 skip 或无测试匹配当作 RED。

- [ ] **Step 3: Implement the tested behavior in small edits**

- [ ] **Edit 1:** http.ts 在 token resolution 后用 `return await runWithTokenScope(resolved,()=>handler({...}))`，必须 await 保留错误捕获。roles.assertRole 先 assertTokenCapability，再原成员角色校验。HTTP method 不能用作 read-only 判断：MCP 的读工具也走 POST。

```ts
const READ=new Set(['base.list','base.get','table.list','table.get','field.list','view.list','record.list','record.get','record.groupCounts','record.kanbanPage']);
const WRITE=new Set(['base.create','base.rename','base.delete','table.create','table.rename','table.delete','field.create','field.rename','field.updateOptions','field.delete','view.create','view.rename','view.updateOptions','view.delete','record.create','record.delete','cell.upsert']);
export function assertAgentProcedure(path:string,type:'query'|'mutation'|'subscription') {
 const s=currentTokenScope(); if(!s) return;
 if(!READ.has(path) && !WRITE.has(path)) throw new TRPCError({code:'FORBIDDEN',message:'Procedure is not available to API tokens'});
 if(s.access==='read' && type!=='query') throw new TRPCError({code:'FORBIDDEN',message:'Read-only token'});
 if(s.baseId!==null && path==='base.create') throw new TRPCError({code:'FORBIDDEN',message:'Token is bound to a base'});
}
```

- [ ] **Edit 2:** protectedProcedure 中调用 assertAgentProcedure(path,type)，不更改 session 类型。base.list WHERE 增 scope.baseId 过滤；base.create 双重门禁。records-service.getRecord 已调用 assertTableRole，故不能遗漏 async scope 包裹。对另一个 userId 传入 scope 情况 assertRole 增 `scope.userId!==userId` 拒绝，防服务内部身份混用。

- [ ] **Edit 3:** 为每个现有 REST route 与 MCP tool 建立表驱动 allow/deny 矩阵：same/other Base × read/write × owner/editor/viewer × expired/revoked；尤其 combined update_view/update_field 和 direct get_record。新增 allowlist 路径必须伴随 scope 测试。Token UI 显示 Current base/All accessible bases，Read/Read & write，有效期天数或显式 Never expires；旧 tokens 清楚标示 All bases · Read & write，不能静默降权。

- [ ] **Edit 4:** RSS 和 Skill 不使用 bearer 时继续其已有只读权限边界，不能把 API token 作为 share token 接受。

- [ ] **Step 4: Verify the deliverable**

```bash
P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/agent-access/scoped-access.pg.test.ts apps/web/src/server/agent-access/http.test.ts apps/web/src/server/agent-access/mcp/server.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit this deliverable**

```bash
git add -- apps/web/src/server/agent-access/http.ts apps/web/src/lib/roles.ts apps/web/src/server/trpc/init.ts apps/web/src/server/trpc/routers/base.ts apps/web/src/server/agent-access/policy.ts apps/web/src/server/agent-access/scoped-access.pg.test.ts 'apps/web/src/app/bases/[baseId]/settings/agent/page.tsx' apps/web/src/server/agent-access/skill-template.ts docs/api/agent-access.md
git diff --cached --check
git commit -m "feat: enforce token scope across REST and MCP"
```

### Task 3: Webhook 凭据、目标校验与配置模型

**Files:**

- Create: `apps/web/src/server/webhooks/crypto.ts` — AES-GCM 和 HMAC
- Create: `apps/web/src/server/webhooks/crypto.test.ts` — 篡改/错误 key/签名
- Create: `apps/web/src/server/webhooks/transport.ts` — 受控 DNS/TLS POST
- Create: `apps/web/src/server/webhooks/transport.test.ts` — SSRF/redirect/body cap
- Modify: `apps/web/src/server/db/schema.ts` — webhookSubscription
- Create: `apps/web/src/server/webhooks/subscriptions.ts` — owner 管理服务
- Create: `docs/adr/0015-webhook-outbox.md` — 事务触发器/worker/溢出契约

**Interfaces:**

- Consumes: `isPublicAddress` 从 Airtable network 只读复用，不放宽其域名校验。
- Produces: `encryptSecret(secret:string,key:Buffer):string`、`decryptSecret(ciphertext:string,key:Buffer):string`、`signWebhook(secret:string,timestamp:string,body:string):string`；`postWebhook(url:string,body:string,headers:Record<string,string>,signal:AbortSignal):Promise<{status:number}>`；`createSubscription(userId:string,input:{tableId:string;url:string;events:("record.changed"|"record.deleted")[]}):Promise<{id:string;secret:string}>`。

- [ ] **Step 1: Write the failing test**

```ts
import {randomBytes,createHmac} from 'node:crypto';
import {it,expect} from 'vitest';
import {encryptSecret,decryptSecret,signWebhook} from './crypto';
it('authenticates ciphertext and signs the exact delivered bytes',()=>{
 const key=randomBytes(32), encoded=encryptSecret('secret',key);
 expect(decryptSecret(encoded,key)).toBe('secret');
 expect(()=>decryptSecret(encoded,randomBytes(32))).toThrow();
 expect(signWebhook('secret','10','{}')).toBe(createHmac('sha256','secret').update('10.{}').digest('hex'));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run apps/web/src/server/webhooks/crypto.test.ts apps/web/src/server/webhooks/transport.test.ts
```

Expected: FAIL：新接口不存在或新断言不满足；不得把数据库未连接、测试 skip 或无测试匹配当作 RED。

- [ ] **Step 3: Implement the tested behavior in small edits**

- [ ] **Edit 1:** crypto.ts 使用 node:crypto，AES-256-GCM nonce=randomBytes(12)，编码 `v1.<iv base64>.<tag base64>.<ciphertext base64>`；key 长度严格 32，tag 16，解密错误统一脱敏。env key 只从 WEBHOOK_ENCRYPTION_KEY base64 解码且验证 canonical 字符串；缺 key 返回 feature disabled，不 fall back 会话 secret。

```ts
export function encryptSecret(secret:string,key:Buffer):string {
 if(key.length!==32) throw Error('Webhook encryption key unavailable');
 const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);
 const body=Buffer.concat([c.update(secret,'utf8'),c.final()]);
 return ['v1',iv.toString('base64'),c.getAuthTag().toString('base64'),body.toString('base64')].join('.');
}
export const signWebhook=(secret:string,timestamp:string,body:string)=>
 createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');
```

- [ ] **Edit 2:** Schema webhook_subscription：id uuid、tableId FK cascade、createdBy text、url text、events jsonb、secretCiphertext text、state text(active/paused/overflow/disabled)、createdAt/updatedAt、overflowAt nullable。table index。创建 owner 门禁、每表最多5（表级 advisory锁内计数）、URL HTTPS443 无userinfo/hash 长度≤2048，事件集合非空去重。密钥 randomBytes(32).toString('hex')，只返创建/轮换；更新 URL 创建新订阅，旧订阅显式停用。

- [ ] **Edit 3:** transport 采用 node:https.request，lookup 回调固定解析到的公网地址、servername/Host 使用原域名；DNS 所有地址均 public 才接受；每次发送重验，禁止原生 fetch 重解析绕过；5 秒 AbortSignal、64KiB 响应上限，超限 destroy。返回 status，完全不跟随 Location。允许查询参数但日志只能 origin/path，不输出 query/userinfo。支持依赖注入 resolver/request 在测试，不提供 production endpoint 让用户注入 IP。案例：127.0.0.1、::1、IPv4-mapped IPv6、metadata 地址、DNS mixed、rebind、https→http redirect 全拒绝；公开站点 204 成功。

- [ ] **Step 4: Verify the deliverable**

```bash
pnpm exec vitest run apps/web/src/server/webhooks/crypto.test.ts apps/web/src/server/webhooks/transport.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit this deliverable**

```bash
git add -- apps/web/src/server/webhooks/crypto.ts apps/web/src/server/webhooks/crypto.test.ts apps/web/src/server/webhooks/transport.ts apps/web/src/server/webhooks/transport.test.ts apps/web/src/server/db/schema.ts apps/web/src/server/webhooks/subscriptions.ts docs/adr/0015-webhook-outbox.md
git diff --cached --check
git commit -m "feat: add secure webhook configuration primitives"
```

### Task 4: 事务 outbox 覆盖所有记录写入

**Files:**

- Modify: `apps/web/src/server/db/schema.ts` — webhookDelivery
- Create: `apps/web/src/server/webhooks/outbox.sql` — 新生成迁移追加的 trigger 源
- Create: `apps/web/src/server/webhooks/outbox.pg.test.ts` — 提交/回滚/合并/溢出
- Modify: `docs/adr/0015-webhook-outbox.md` — 触发器覆盖与容量

**Interfaces:**

- Consumes: webhookSubscription。
- Produces: `webhook_delivery`：id uuid(eventId)、subscriptionId FK cascade、transactionId bigint、baseId/tableId/recordId text、eventType、occurredAt、state(pending/leased/succeeded/dead)、attempts、nextAttemptAt、leaseUntil、leaseToken uuid、lastStatus integer、lastError text；unique(subscriptionId,transactionId,recordId)。记录 ID 无 FK（删除事件要保留）。

- [ ] **Step 1: Write the failing test**

```ts
import {describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {eq,sql} from 'drizzle-orm';
import {db} from '../db';
import {webhookDelivery} from '../db/schema';
import {withDbFixture} from '../testing/pg-fixture';
import {createSubscription} from './subscriptions';
describe.skipIf(process.env.P0_P2_PG_TEST!=='1')('outbox',()=>{
 it('rolls back events with the business transaction',async()=>withDbFixture(async f=>{
  const previous=process.env.WEBHOOK_ENCRYPTION_KEY;
  process.env.WEBHOOK_ENCRYPTION_KEY=randomBytes(32).toString('base64');
  try {
   const sub=await createSubscription(f.userId,{tableId:f.tableId,url:'https://example.com/hook',events:['record.changed','record.deleted']});
   await expect(db.transaction(async tx=>{
    await tx.execute(sql`insert into record(id,table_id) values ('rollback-record',${f.tableId})`);
    throw Error('rollback');
   })).rejects.toThrow('rollback');
   expect(await db.select().from(webhookDelivery).where(eq(webhookDelivery.subscriptionId,sub.id))).toHaveLength(0);
  }finally {if(previous===undefined)delete process.env.WEBHOOK_ENCRYPTION_KEY;else process.env.WEBHOOK_ENCRYPTION_KEY=previous;}
 }));
});
```

另一个用例直接 tx 写 record+两个 cells，断言只一条 changed；同事务删 record 后最终 type 为 deleted。

- [ ] **Step 2: Run test to verify it fails**

```bash
P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/webhooks/outbox.pg.test.ts
```

Expected: FAIL：新接口不存在或新断言不满足；不得把数据库未连接、测试 skip 或无测试匹配当作 RED。

- [ ] **Step 3: Implement the tested behavior in small edits**

- [ ] **Edit 1:** 生成 Drizzle table/index 迁移后，在本次新迁移中追加 outbox.sql 原文，提交源与迁移，禁止修改旧迁移。delivery.nextAttemptAt 默认 now；state/attempts 默认 pending/0。触发器函数为 AFTER INSERT OR UPDATE OR DELETE ON record 和 cell，采用行级、同事务：

```sql
CREATE FUNCTION markpocket_record_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid text; tid text; bid text; kind text; sub record; queued bigint;
BEGIN
 IF TG_TABLE_NAME='record' THEN
  IF TG_OP='DELETE' THEN rid:=OLD.id; tid:=OLD.table_id; kind:='record.deleted';
  ELSE rid:=NEW.id; tid:=NEW.table_id; kind:='record.changed'; END IF;
 ELSE
  IF TG_OP='DELETE' THEN rid:=OLD.record_id; ELSE rid:=NEW.record_id; END IF;
  SELECT table_id INTO tid FROM record WHERE id=rid;
  kind:='record.changed';
 END IF;
 SELECT base_id INTO bid FROM "table" WHERE id=tid;
 IF bid IS NOT NULL THEN
  FOR sub IN SELECT * FROM webhook_subscription WHERE table_id=tid AND state='active' ORDER BY id FOR UPDATE LOOP
   IF sub.events @> jsonb_build_array(kind) THEN
    SELECT count(*) INTO queued FROM webhook_delivery WHERE subscription_id=sub.id AND state IN ('pending','leased');
    IF queued>=10000 AND NOT EXISTS(SELECT 1 FROM webhook_delivery WHERE subscription_id=sub.id AND transaction_id=txid_current() AND record_id=rid) THEN
     UPDATE webhook_subscription SET state='overflow',overflow_at=now() WHERE id=sub.id;
    ELSE
     INSERT INTO webhook_delivery(id,subscription_id,transaction_id,base_id,table_id,record_id,event_type,occurred_at)
     VALUES(gen_random_uuid(),sub.id,txid_current(),bid,tid,rid,kind,now())
     ON CONFLICT(subscription_id,transaction_id,record_id) DO UPDATE
      SET event_type=CASE WHEN excluded.event_type='record.deleted' THEN 'record.deleted' ELSE webhook_delivery.event_type END;
    END IF;
   END IF;
  END LOOP;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER record_outbox AFTER INSERT OR UPDATE OR DELETE ON record FOR EACH ROW EXECUTE FUNCTION markpocket_record_outbox();
CREATE TRIGGER cell_outbox AFTER INSERT OR UPDATE OR DELETE ON cell FOR EACH ROW EXECUTE FUNCTION markpocket_record_outbox();
```

- [ ] **Edit 2:** SQL 订阅仅 changed、事务先创建后删除时需剔除这个事务的 changed delivery（消费者不应收到已删除记录的 changed）；仅 deleted 订阅则创建不收集，删除加入。实现该修正：record DELETE 时对同 tx/rid 且未订阅 deleted 的已有 changed delivery 删除，再按 deleted 订阅入队。跨事务 changed 随后 deleted 仍分别交付且不保证顺序，消费者拉取遇 404 应按已删除处理。

- [ ] **Edit 3:** cell cascade 没 parent 时不产生事件；Base/Table 删除 endpoint FK 使对应 pending 丢弃，不试图对已删除订阅投递。锁 subscription 按 id 排序，SQL deadlock 映射既有 retryable conflict；并发大批量写测试确认无静默丢失。测试 direct SQL、F batch、旧 cell.upsert、CSV/import 写入都触发，不使用 publishTableChange 当 outbox 来源。

- [ ] **Edit 4:** 溢出验收先插入10000 pending，再业务写成功但订阅变 overflow，新事件未入队，页面将显示 gap；终态数据不计容量。记录 payload 不含任何 cells、字段值或凭据。

- [ ] **Step 4: Verify the deliverable**

```bash
P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/webhooks/outbox.pg.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit this deliverable**

```bash
git add -- apps/web/src/server/db/schema.ts apps/web/src/server/webhooks/outbox.sql apps/web/src/server/webhooks/outbox.pg.test.ts docs/adr/0015-webhook-outbox.md
git diff --cached --check
git commit -m "feat: persist transactional record webhook events"
```

### Task 5: 租约 worker、签名投递与生命周期

**Files:**

- Create: `apps/web/src/server/webhooks/worker.ts` — claim/send/ack/retry/cleanup
- Create: `apps/web/src/server/webhooks/worker.test.ts` — 时钟/重试/签名
- Create: `apps/web/src/server/webhooks/worker.pg.test.ts` — 租约与崩溃恢复
- Modify: `apps/web/src/server.ts` — 生产启动关闭 worker
- Create: `apps/web/scripts/webhooks-once.ts` — 开发单次受控 drain
- Modify: `.env.example` — WEBHOOK_ENCRYPTION_KEY 文档
- Modify: `docker-compose.yml` — pass-through key

**Interfaces:**

- Consumes: outbox、postWebhook/signWebhook/decryptSecret、成员 owner 查询。
- Produces: `retryDelayMs(attempt:number):number|null`、`runWebhookBatch():Promise<{claimed:number;succeeded:number;failed:number}>`、`startWebhookWorker():{stop():Promise<void>}`；无外部 queue。

- [ ] **Step 1: Write the failing test**

```ts
import {it,expect} from 'vitest';
import {retryDelayMs} from './worker';
it('stops after five total attempts',()=>{
 expect([1,2,3,4,5].map(retryDelayMs)).toEqual([1000,10000,60000,300000,null]);
});
```

PG 测试设置一条过期 lease，两个 worker 并发 claim：同一轮只有一个取得新 leaseToken；旧 token ack 的 UPDATE 影响 0 行。进程发送成功后未 ack 模拟，lease 到期后会重发同一个 eventId。

- [ ] **Step 2: Run test to verify it fails**

```bash
P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/webhooks/worker.test.ts apps/web/src/server/webhooks/worker.pg.test.ts
```

Expected: FAIL：新接口不存在或新断言不满足；不得把数据库未连接、测试 skip 或无测试匹配当作 RED。

- [ ] **Step 3: Implement the tested behavior in small edits**

- [ ] **Edit 1:** claim SQL 在短事务中运行；每轮最多20条，但每次只 claim 2条并等待两条发送/ack后再 claim，最多10轮，避免排队超过30秒租约；按 next_attempt_at,id，JOIN active subscription，未过期 leased 不可取。重取过期 lease 不得提前增加 attempt 两次，每次 actual send 记一次（claim 时增加，崩溃也算一次尝试）。5 次耗尽的失联 lease 置 dead。

```sql
WITH picked AS (
 SELECT d.id FROM webhook_delivery d JOIN webhook_subscription s ON s.id=d.subscription_id
 WHERE s.state='active' AND d.attempts<5 AND
 ((d.state='pending' AND d.next_attempt_at<=now()) OR (d.state='leased' AND d.lease_until<now()))
 ORDER BY d.next_attempt_at,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 2
)
UPDATE webhook_delivery d SET state='leased',lease_until=now()+interval '30 seconds',
 lease_token=gen_random_uuid(),attempts=d.attempts+1
FROM picked WHERE d.id=picked.id RETURNING d.*;
```

- [ ] **Edit 2:** payload 在 event row 基础上固定 JSON.stringify({eventId:id,type:eventType,baseId,tableId,recordId,occurredAt:ISO})，重试 eventId 不变。每次发送先重查 active/owner 和 leaseToken，再解密当前 secret；timestamp 为当前秒字符串。请求头 X-MarkPocket-Event=id、X-MarkPocket-Timestamp=timestamp、X-MarkPocket-Signature='sha256='+signWebhook(...)。最多并发2，分批 Promise.all 两个。

```ts
export function retryDelayMs(attempt:number):number|null {
 return [1000,10000,60000,300000][attempt-1] ?? null;
}
```

- [ ] **Edit 3:** 2xx ack succeeded；408/429/5xx/network 在 attempts<5 时回 pending+delay，否则 dead；3xx/其他4xx dead。ack UPDATE 必须 WHERE id AND lease_token AND state='leased'，不让过期 worker 覆盖新结果。lastError 只枚举 network/timeout/unsafe_target/http_status，不保存 response body 或完整 URL。

- [ ] **Edit 4:** 生产 start 在 migration 后执行，使用 setTimeout 串行调度每秒，不 setInterval 叠加；timer.unref。stop 先停止 claim，abort active transport，等待 promises settle，之后 server.ts 才 sql.end；最多5秒请求不会无限拖延。没有 env key 或 key 不匹配时停发/标 disabled，pending 保留；重新配置 key 后 owner 才恢复。dev `webhooks-once.ts` 只 import runWebhookBatch，一次运行后 sql.end，不常驻。

- [ ] **Edit 5:** 清理每分钟删除 succeeded/dead 且 age>7天的最多1000行，保留 overflow 标记直到 owner 明确确认。按 actorKey 清理 write_receipt 可继续由 F 写入口完成，不在 webhook worker 中引入无关任务。

- [ ] **Step 4: Verify the deliverable**

```bash
P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/webhooks/worker.test.ts apps/web/src/server/webhooks/worker.pg.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit this deliverable**

```bash
git add -- apps/web/src/server/webhooks/worker.ts apps/web/src/server/webhooks/worker.test.ts apps/web/src/server/webhooks/worker.pg.test.ts apps/web/src/server.ts apps/web/scripts/webhooks-once.ts .env.example docker-compose.yml
git diff --cached --check
git commit -m "feat: deliver signed webhooks with durable retries"
```

### Task 6: Webhook 管理界面、失败重试与接收示例

**Files:**

- Create: `apps/web/src/server/trpc/routers/webhook.ts` — owner 配置/轮换/暂停/重试
- Modify: `apps/web/src/server/trpc/router.ts` — 注册 webhook
- Create: `apps/web/src/server/trpc/routers/webhook.pg.test.ts` — owner 限制与单条 retry
- Create: `apps/web/src/components/webhooks/webhook-settings.tsx` — endpoint 状态/日志
- Create: `apps/web/src/components/webhooks/webhook-settings.test.tsx` — overflow/disabled 明确提示
- Modify: `apps/web/src/app/bases/[baseId]/settings/agent/page.tsx` — 挂接 webhook 管理
- Create: `docs/WEBHOOKS.md` — 签名验签/幂等/缺口/重试
- Modify: `docs/api/agent-access.md` — 受限 REST 自动化范例

**Interfaces:**

- Consumes: createSubscription、crypto、outbox/worker。
- Produces: router webhook `{list({tableId}),create({tableId,url,events}),pause({id}),resume({id,acknowledgeGap:boolean}),rotate({id}):{secret:string},remove({id}),deliveries({id,offset,limit}),retry({deliveryId}):{ok:true}}`；list never secret，deliveries最多50/页。

- [ ] **Step 1: Write the failing test**

```ts
import {describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {withDbFixture} from '../../testing/pg-fixture';
describe.skipIf(process.env.P0_P2_PG_TEST!=='1')('webhook management',()=>{
 it('does not expose owner capabilities to a viewer',async()=>withDbFixture(async f=>{
  await expect(f.viewer.webhook.list({tableId:f.tableId})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(f.viewer.webhook.create({tableId:f.tableId,url:'https://example.com/hook',events:['record.changed']})).rejects.toMatchObject({code:'FORBIDDEN'});
 }));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/trpc/routers/webhook.pg.test.ts apps/web/src/components/webhooks/webhook-settings.test.tsx
```

Expected: FAIL：新接口不存在或新断言不满足；不得把数据库未连接、测试 skip 或无测试匹配当作 RED。

- [ ] **Step 3: Implement the tested behavior in small edits**

- [ ] **Edit 1:** 所有 procedure 先解析 endpoint 所属 table，再 assertTableRole(owner)，不存在与外部资源都不透露 URL/secret。list 只返回 id、url（只给 owner）、events、state、overflowAt、createdAt；日志返回 id/type/state/attempts/lastStatus/lastError/time，不返 payload ciphertext。创建/轮换返回 secret 一次；rotate 使用 endpoint 行锁、清除 delivery leased 状态回 pending 并生成新 leaseToken，使旧 ack 失效；已在网络中的旧请求不能撤回，文档建议接收方短期双 key 验证。

- [ ] **Edit 2:** retry 只对 dead 更新为 pending、attempts=0、nextAttemptAt=now、lease=null，保留 eventId；succeeded/leased 拒绝 CONFLICT。resume overflow 必须 acknowledgeGap=true，否则 BAD_REQUEST。新 URL 删除/另建，不复用旧任务。手动 pause 不删除 pending；remove 明确提示删除 delivery 日志，复用 ConfirmDialog。

- [ ] **Edit 3:** Settings 选择表，最多5 endpoint，每项显示 Active/Paused/Overflow/Disabled、最近交付、Retry 按钮。overflow 显示 `Some changes were not queued. Reconcile your records before resuming.`，disabled 显示管理员配置指引，viewer 不挂管理查询。不要把表单提交者/普通成员带入该管理 UI。

- [ ] **Edit 4:** 接收说明中的签名代码：

```ts
const supplied=Buffer.from(signature.replace(/^sha256=/,''),'hex');
const expected=Buffer.from(createHmac('sha256',secret).update(`${timestamp}.${rawBody}`).digest('hex'),'hex');
if(Math.abs(Date.now()/1000-Number(timestamp))>300 || supplied.length!==expected.length || !timingSafeEqual(supplied,expected))
 throw Error('Invalid signature');
```

- [ ] **Edit 5:** 文档要求先检查 timestamp 为有限整数、signature 为64 hex；原始 body 原封验签，然后按 eventId 持久去重再执行副作用，成功快速2xx。给现有 REST GET /api/v1/records/{id} 和 PATCH cells 的 curl 示例只引用 `$MARKPOCKET_TOKEN`，强调检查 cellErrors（旧接口部分成功）。禁止示例硬编码真实 token。最终浏览器验证配置→真实公开 HTTPS 测试接收器仅在用户提供/授权时发送；默认使用注入 transport 的 fixture，不擅自发出外部 webhook。

- [ ] **Step 4: Verify the deliverable**

```bash
P0_P2_PG_TEST=1 pnpm exec vitest run apps/web/src/server/trpc/routers/webhook.pg.test.ts apps/web/src/components/webhooks/webhook-settings.test.tsx
```

Expected: PASS。

- [ ] **Step 5: Commit this deliverable**

```bash
git add -- apps/web/src/server/trpc/routers/webhook.ts apps/web/src/server/trpc/router.ts apps/web/src/server/trpc/routers/webhook.pg.test.ts apps/web/src/components/webhooks/webhook-settings.tsx apps/web/src/components/webhooks/webhook-settings.test.tsx 'apps/web/src/app/bases/[baseId]/settings/agent/page.tsx' docs/WEBHOOKS.md docs/api/agent-access.md
git diff --cached --check
git commit -m "feat: manage webhook delivery and recovery"
```

## Completion Gate

- [ ] 对照 Spec 的本节逐条核验，并记录证据到 `docs/release/2026-10-10-p0-p2-evidence.md` 对应子项目；不得把未运行的检查写成通过。
- [ ] 更新 `docs/STATUS.md`、`CHANGELOG.md` 与本计划直接关联的用户文档；区分已实现、fixture 验证、live 验证、已发布。
- [ ] 运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`；包含数据库变更时运行本计划 PG 测试并确认没有跳过。
- [ ] 仅 stage 本次变更；提交文档与生成迁移时列出真实生成路径。用户已有修改保持不动。
