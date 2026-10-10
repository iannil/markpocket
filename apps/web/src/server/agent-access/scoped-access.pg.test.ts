import { beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { withDbFixture } from '../testing/pg-fixture';
import { runWithTokenScope } from './scope';
import {
  ACCESS_CASES,
  loadRestRoutes,
  type AccessCase,
  type ResourceIds,
} from './scoped-access-cases';

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('scoped access on PostgreSQL', () => {
  it('blocks direct reads, credential escape, identity mixing and bound base creation', async () => {
    await withDbFixture(async (f) => {
      const { getRecord } = await import('./records-service');
      const { MCP_TOOL_BY_NAME } = await import('./mcp/tools');
      const other = await f.caller.base.create({ name: 'Other' });
      try {
        const table = await f.caller.table.create({ baseId: other.id, name: 'Other' });
        const row = await f.caller.record.create({ tableId: table.id });
        await runWithTokenScope(
          { tokenId: 'test', userId: f.userId, baseId: f.baseId, access: 'read' },
          async () => {
            expect((await f.caller.base.list()).map((b) => b.id)).toEqual([f.baseId]);
            await expect(getRecord(f.userId, row.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
            await expect(f.caller.token.create({ name: 'escape' })).rejects.toMatchObject({
              code: 'FORBIDDEN',
            });
            await expect(f.viewer.base.get({ id: f.baseId })).rejects.toMatchObject({
              code: 'FORBIDDEN',
            });
            await expect(
              MCP_TOOL_BY_NAME.get('create_record')!.execute(
                { caller: f.caller, userId: f.userId },
                { tableId: f.tableId },
              ),
            ).rejects.toMatchObject({ code: 'FORBIDDEN' });
          },
        );
        await runWithTokenScope(
          { tokenId: 'test', userId: f.userId, baseId: f.baseId, access: 'write' },
          async () => {
            await expect(f.caller.base.create({ name: 'escape' })).rejects.toMatchObject({
              code: 'FORBIDDEN',
            });
          },
        );
      } finally {
        await f.caller.base.delete({ id: other.id });
      }
    });
  });
});

// A fresh fixture per entry makes destructive routes real successes while
// preventing an earlier mutation from obscuring a later authorization result.

const combinations = (['same', 'other', 'all'] as const).flatMap((scope) =>
  (['read', 'write'] as const).flatMap((access) =>
    (['owner', 'editor', 'viewer'] as const).flatMap((role) =>
      (['active', 'expired', 'revoked'] as const).map((state) => ({ scope, access, role, state })),
    ),
  ),
);
const ranks = { viewer: 0, editor: 1, owner: 2 };

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('REST/MCP scope and current-role matrix', () => {
  let routes: Awaited<ReturnType<typeof loadRestRoutes>>;
  let mcpPost: typeof import('@/app/api/mcp/route').POST;
  beforeAll(async () => {
    routes = await loadRestRoutes();
    mcpPost = (await import('@/app/api/mcp/route')).POST;
    const { MCP_TOOLS } = await import('./mcp/tools');
    expect(MCP_TOOLS.map((tool) => tool.name).sort()).toEqual(
      ACCESS_CASES.flatMap((c) => (c.tool ? [c.tool] : [])).sort(),
    );
    expect(
      Object.entries(routes)
        .flatMap(([path, exports]) =>
          Object.keys(exports)
            .filter((key) => /^(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)$/.test(key))
            .map((method) => `${method} ${path}`),
        )
        .sort(),
    ).toEqual(ACCESS_CASES.map((c) => `${c.method} ${c.path}`).sort());
  });
  const cases: (AccessCase & { variant?: string })[] = [
    ...ACCESS_CASES,
    ...ACCESS_CASES.filter((c) => ['update_field', 'update_view'].includes(c.tool ?? '')).map(
      (c) => ({
        ...c,
        variant: 'options-only',
        body: (ids: ResourceIds) => ({ options: c.body!(ids).options }),
      }),
    ),
  ];
  for (const operation of cases) {
    for (const channel of operation.tool ? (['REST', 'MCP'] as const) : (['REST'] as const)) {
      describe(`${channel} ${operation.method} ${operation.path} ${operation.tool ?? ''} ${operation.variant ?? 'combined/default'}`, () => {
        it.each(combinations)(
          '$scope/$access/$role/$state',
          async ({ scope, access, role, state }) => {
            await withDbFixture(async (f) => {
              const { db } = await import('../db');
              const s = await import('../db/schema');
              const { createApiToken } = await import('./tokens');
              const other = await f.caller.base.create({ name: 'Other scope' });
              try {
                const view = await f.caller.view.create({ tableId: f.tableId, name: 'Original' });
                const row = await f.caller.record.create({ tableId: f.tableId });
                const ids: ResourceIds = {
                  baseId: f.baseId,
                  tableId: f.tableId,
                  fieldId: f.textId,
                  viewId: view.id,
                  recordId: row.id,
                };
                const minted = await createApiToken(f.userId, 'matrix', {
                  baseId: scope === 'all' ? null : scope === 'same' ? f.baseId : other.id,
                  access,
                  expiresAt: state === 'expired' ? new Date(Date.now() - 1_000) : null,
                });
                if (state === 'revoked') await f.caller.token.revoke({ id: minted.row.id });
                // Mint while owner, then downgrade: token never freezes mint-time authority.
                await db
                  .update(s.baseMember)
                  .set({ role })
                  .where(eq(s.baseMember.userId, f.userId));
                const isList = operation.method === 'GET' && operation.path === 'bases';
                const isCreateBase = operation.method === 'POST' && operation.path === 'bases';
                const permitted =
                  state === 'active' &&
                  (isList ||
                    (isCreateBase
                      ? scope === 'all' && access === 'write'
                      : scope !== 'other' &&
                        (operation.role === 'viewer' || access === 'write') &&
                        ranks[role] >= ranks[operation.role]));
                const snapshot = async () => ({
                  bases: await db
                    .select()
                    .from(s.base)
                    .where(eq(s.base.createdBy, f.userId))
                    .orderBy(s.base.id),
                  tables: await db
                    .select()
                    .from(s.table)
                    .where(eq(s.table.baseId, f.baseId))
                    .orderBy(s.table.id),
                  fields: await db
                    .select()
                    .from(s.field)
                    .where(eq(s.field.tableId, f.tableId))
                    .orderBy(s.field.id),
                  views: await db
                    .select()
                    .from(s.view)
                    .where(eq(s.view.tableId, f.tableId))
                    .orderBy(s.view.id),
                  records: await db
                    .select()
                    .from(s.record)
                    .where(eq(s.record.tableId, f.tableId))
                    .orderBy(s.record.id),
                  cells: await db
                    .select()
                    .from(s.cell)
                    .where(eq(s.cell.recordId, row.id))
                    .orderBy(s.cell.id),
                });
                const before = !permitted ? await snapshot() : undefined;
                const body = operation.body?.(ids);
                const headers = {
                  authorization: `Bearer ${minted.token}`,
                  'content-type': 'application/json',
                };
                let response: Response;
                if (channel === 'REST') {
                  const path = operation.path.replace(
                    /\[(\w+)\]/g,
                    (_, key: keyof ResourceIds) => ids[key],
                  );
                  response = await routes[operation.path][operation.method]!(
                    new Request(`http://localhost/api/v1/${path}`, {
                      method: operation.method,
                      headers,
                      body: body ? JSON.stringify(body) : undefined,
                    }),
                    { params: Promise.resolve(ids) },
                  );
                } else {
                  const args = {
                    ...(operation.params ? { [operation.params]: ids[operation.params] } : {}),
                    ...body,
                  };
                  response = await mcpPost(
                    new Request('http://localhost/api/mcp', {
                      method: 'POST',
                      headers,
                      body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'tools/call',
                        params: { name: operation.tool, arguments: args },
                      }),
                    }),
                  );
                }
                const payload = await response.json();
                if (state !== 'active') {
                  expect(response.status).toBe(401);
                  expect(response.headers.get('www-authenticate')).toBe('Bearer');
                  expect(payload.error.code).toBe('UNAUTHORIZED');
                } else if (channel === 'REST') {
                  expect(response.status, JSON.stringify(payload)).toBe(
                    permitted ? (operation.method === 'POST' ? 201 : 200) : 403,
                  );
                  if (!permitted) expect(payload.error.code).toBe('FORBIDDEN');
                } else {
                  expect(response.status).toBe(200);
                  expect(payload.error).toBeUndefined();
                  expect(payload.result.isError ?? false, JSON.stringify(payload)).toBe(!permitted);
                  if (!permitted) expect(payload.result.content[0].text).toMatch(/^FORBIDDEN:/);
                }
                if (permitted && isList) {
                  const bases =
                    channel === 'REST' ? payload : JSON.parse(payload.result.content[0].text);
                  expect(bases.map((base: { id: string }) => base.id).sort()).toEqual(
                    (scope === 'all'
                      ? [f.baseId, other.id]
                      : [scope === 'same' ? f.baseId : other.id]
                    ).sort(),
                  );
                }
                if (!permitted) expect(await snapshot()).toEqual(before);
                if (permitted && ['update_field', 'update_view'].includes(operation.tool ?? '')) {
                  const rows =
                    operation.tool === 'update_field'
                      ? await db.select().from(s.field).where(eq(s.field.id, f.textId))
                      : await db.select().from(s.view).where(eq(s.view.id, view.id));
                  expect(rows[0]).toMatchObject(body!);
                }
                if (
                  permitted &&
                  ['create_record', 'update_record'].includes(operation.tool ?? '')
                ) {
                  const data =
                    channel === 'REST' ? payload : JSON.parse(payload.result.content[0].text);
                  expect(data.cellErrors).toEqual({});
                  expect(data.record.cells[f.textId]).toBe('Changed');
                }
              } finally {
                // Includes successful create_base results and already-deleted targets.
                await db.delete(s.cellHistory).where(eq(s.cellHistory.changedBy, f.userId));
                await db.delete(s.apiToken).where(eq(s.apiToken.userId, f.userId));
                const owned = await db
                  .select({ id: s.base.id })
                  .from(s.base)
                  .where(eq(s.base.createdBy, f.userId));
                if (owned.length)
                  await db.delete(s.base).where(
                    inArray(
                      s.base.id,
                      owned.map((b) => b.id),
                    ),
                  );
              }
            });
          },
        );
      });
    }
  }
});

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('non-REST caller and public boundaries', () => {
  it('intersects all extra allowlisted reads with scope, current membership and identity', async () => {
    await withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { baseMember } = await import('../db/schema');
      const { getRecord } = await import('./records-service');
      const status = await f.caller.field.create({
        tableId: f.tableId,
        name: 'Status',
        type: 'single-select',
        options: { choices: [{ id: 'todo', name: 'Todo', color: 'blue' }] },
      });
      const view = await f.caller.view.create({
        tableId: f.tableId,
        name: 'Board',
        type: 'kanban',
      });
      await f.caller.view.updateOptions({
        id: view.id,
        options: { kanban: { groupFieldId: status.id } },
      });
      const row = await f.caller.record.create({ tableId: f.tableId });
      const reads = [
        () => f.viewer.table.get({ id: f.tableId }),
        () => f.viewer.record.get({ tableId: f.tableId, id: row.id }),
        () => f.viewer.record.groupCounts({ tableId: f.tableId, viewId: view.id }),
        () => f.viewer.record.kanbanPage({ tableId: f.tableId, viewId: view.id, choiceId: null }),
        () => getRecord(f.viewerId, row.id),
      ];
      for (const baseId of [f.baseId, null, 'different-base']) {
        await runWithTokenScope(
          { tokenId: 'extra-reads', userId: f.viewerId, baseId, access: 'read' },
          async () => {
            for (const read of reads) {
              if (baseId === 'different-base')
                await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
              else await expect(read()).resolves.toBeDefined();
            }
          },
        );
      }
      await runWithTokenScope(
        { tokenId: 'identity', userId: f.userId, baseId: f.baseId, access: 'write' },
        async () => {
          await expect(getRecord(f.viewerId, row.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
          await expect(f.viewer.base.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
          await expect(f.caller.share.create({ baseId: f.baseId })).rejects.toMatchObject({
            code: 'FORBIDDEN',
          });
          await expect(f.caller.token.create({ name: 'escape' })).rejects.toMatchObject({
            code: 'FORBIDDEN',
          });
        },
      );
      await db.delete(baseMember).where(eq(baseMember.userId, f.viewerId));
      await runWithTokenScope(
        { tokenId: 'removed', userId: f.viewerId, baseId: f.baseId, access: 'write' },
        async () => {
          expect(await f.viewer.base.list()).toEqual([]);
          for (const read of reads)
            await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
        },
      );
    });
  });

  it('keeps RSS on share tokens and Skill/OpenAPI public without granting data access', async () => {
    await withDbFixture(async (f) => {
      const { GET: feed } = await import('@/app/feed/[token]/route');
      const { GET: skill } = await import('@/app/api/skill/route');
      const { GET: openapi } = await import('@/app/api/v1/openapi.json/route');
      const { db } = await import('../db');
      const { apiToken } = await import('../db/schema');
      const minted = await f.caller.token.create({
        name: 'API credential',
        baseId: f.baseId,
        access: 'read',
        expiresInDays: 1,
      });
      try {
        const v = await f.caller.view.create({ tableId: f.tableId, name: 'Shared' });
        const share = await f.caller.share.create({ baseId: f.baseId, viewId: v.id });
        const request = new Request('http://localhost/feed/test');
        expect(
          (await feed(request, { params: Promise.resolve({ token: share!.token }) })).status,
        ).toBe(200);
        expect(
          (await feed(request, { params: Promise.resolve({ token: minted.token }) })).status,
        ).toBe(404);
        expect((await skill(new Request('http://localhost/api/skill'))).status).toBe(200);
        expect((await openapi()).status).toBe(200);
      } finally {
        await db.delete(apiToken).where(eq(apiToken.userId, f.userId));
      }
    });
  });
});
