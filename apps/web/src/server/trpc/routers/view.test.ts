/* eslint-disable @typescript-eslint/no-explicit-any */
import { getTableName } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { mockQuery, mockRoles, session } from './__test-utils';

vi.mock('@/server/db', () => {
  const chain = mockQuery([]);
  chain.execute = vi.fn().mockResolvedValue([]);
  return {
    db: {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      transaction: vi.fn((cb: (tx: any) => Promise<unknown>) => cb(chain)),
    },
    sql: { notify: vi.fn().mockResolvedValue(undefined) },
  };
});
vi.mock('@/lib/roles', () => mockRoles());
vi.mock('@/realtime/publish', () => ({ publishTableChange: vi.fn() }));

import { viewRouter } from './view';

// Flattens a drizzle `sql` template fragment into its literal text plus bound
// parameter values, so lock statements can be asserted without a live db.
function flattenSql(fragment: any): { text: string; params: unknown[] } {
  const text: string[] = [];
  const params: unknown[] = [];
  for (const chunk of fragment?.queryChunks ?? []) {
    if (chunk && typeof chunk === 'object' && Array.isArray(chunk.value)) {
      text.push(chunk.value.join(''));
    } else if (chunk && typeof chunk === 'object' && Array.isArray(chunk.queryChunks)) {
      const nested = flattenSql(chunk);
      text.push(nested.text);
      params.push(...nested.params);
    } else {
      params.push(chunk);
    }
  }
  return { text: text.join(''), params };
}

describe('viewRouter', () => {
  it('list returns an array', async () => {
    const result = await viewRouter.createCaller(session()).list({ tableId: 't1' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('create returns a view', async () => {
    const { db } = await import('@/server/db');
    const returning = vi.fn().mockResolvedValue([
      {
        id: 'v1',
        tableId: 't1',
        type: 'grid',
        name: 'Grid',
        options: {},
        orderIndex: 0,
        createdAt: new Date(),
      },
    ]);
    (db.insert as any).mockReturnValue({ values: vi.fn().mockReturnValue({ returning }) });
    const result = await viewRouter.createCaller(session()).create({ tableId: 't1', name: 'Grid' });
    expect(result.name).toBe('Grid');
    expect(result.type).toBe('grid');
  });

  it('rename returns updated view', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.limit.mockReturnValue(chain);
    chain.then = (onfulfilled: any) =>
      Promise.resolve([
        {
          id: 'v1',
          tableId: 't1',
          type: 'grid',
          name: 'Old',
          options: {},
          orderIndex: 0,
          createdAt: new Date(),
        },
      ]).then(onfulfilled);
    const returning = vi.fn().mockResolvedValue([
      {
        id: 'v1',
        tableId: 't1',
        type: 'grid',
        name: 'Renamed',
        options: {},
        orderIndex: 0,
        createdAt: new Date(),
      },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    (db.update as any).mockReturnValue({ set: vi.fn().mockReturnValue({ where }) });
    const result = await viewRouter.createCaller(session()).rename({ id: 'v1', name: 'Renamed' });
    expect(result.name).toBe('Renamed');
  });

  it('updateOptions persists filter config', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.limit.mockReturnValue(chain);
    const options = {
      filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'equals', operand: 'x' }] },
    };
    // Awaited reads in order: existing view lookup, the in-transaction field
    // liveness check (review N4), update().returning() — both tx statements
    // run on the same mocked chain (advisory lock + write).
    const results = [
      [
        {
          id: 'v1',
          tableId: 't1',
          type: 'grid',
          name: 'Grid',
          options: {},
          orderIndex: 0,
          createdAt: new Date(),
        },
      ],
      // Liveness check: 'f1' exists in the table.
      [{ id: 'f1' }],
      [
        {
          id: 'v1',
          tableId: 't1',
          type: 'grid',
          name: 'Grid',
          options,
          orderIndex: 0,
          createdAt: new Date(),
        },
      ],
    ];
    // P2 re-reads the view after acquiring the lifecycle lock.
    results.splice(1, 0, results[0]);
    let call = 0;
    chain.then = (onfulfilled: any) =>
      Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onfulfilled);
    const result = await viewRouter.createCaller(session()).updateOptions({ id: 'v1', options });
    expect(result.options).toEqual(options);
  });

  it('updateOptions takes the view-options table lock inside the write transaction', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.limit.mockReturnValue(chain);
    (chain.execute as any).mockClear();
    (chain.set as any).mockClear();
    const viewRow = [
      {
        id: 'v1',
        tableId: 't1',
        type: 'grid',
        name: 'Grid',
        options: {} as Record<string, unknown>,
        orderIndex: 0,
        createdAt: new Date(),
      },
    ];
    const results = [viewRow, viewRow];
    // P2 re-reads the view after acquiring the lifecycle lock.
    results.splice(1, 0, results[0]);
    let call = 0;
    chain.then = (onfulfilled: any) =>
      Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onfulfilled);
    await viewRouter.createCaller(session()).updateOptions({ id: 'v1', options: {} });

    // Exactly one lock statement, namespaced per table ('view-options:' —
    // disjoint from cell.ts's per-cell locks) and parameterized by tableId.
    expect((chain.execute as any).mock.calls).toHaveLength(1);
    const { text, params } = flattenSql((chain.execute as any).mock.calls[0][0]);
    expect(text).toContain('pg_advisory_xact_lock');
    expect(text).toContain("hashtext('view-options:'");
    expect(params).toContain('t1');
    // Lock acquired BEFORE the options write inside the transaction.
    const lockOrder = (chain.execute as any).mock.invocationCallOrder[0];
    const writeOrder = (chain.set as any).mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(writeOrder);
  });

  it('updateOptions rejects options referencing an unknown field', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.limit.mockReturnValue(chain);
    (chain.set as any).mockClear();
    const options = {
      filter: { op: 'and', conditions: [{ fieldId: 'f-gone', operator: 'equals', operand: 'x' }] },
    };
    // Awaited reads in order: existing view lookup, then the in-tx field
    // liveness check finds no matching field row.
    const results = [
      [
        {
          id: 'v1',
          tableId: 't1',
          type: 'grid',
          name: 'Grid',
          options: {},
          orderIndex: 0,
          createdAt: new Date(),
        },
      ],
      [],
    ];
    // P2 re-reads the view after acquiring the lifecycle lock.
    results.splice(1, 0, results[0]);
    let call = 0;
    chain.then = (onfulfilled: any) =>
      Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onfulfilled);
    await expect(
      viewRouter.createCaller(session()).updateOptions({ id: 'v1', options }),
    ).rejects.toThrow('View config references unknown field(s): f-gone');
    // Rejected before the write — nothing persisted.
    expect((chain.set as any).mock.calls).toHaveLength(0);
  });

  it('updateOptions rejects an unknown field referenced inside a nested filter group', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.limit.mockReturnValue(chain);
    const options = {
      filter: {
        op: 'and',
        conditions: [
          { fieldId: 'f1', operator: 'equals', operand: 'x' },
          { op: 'or', conditions: [{ fieldId: 'f-deep', operator: 'empty' }] },
        ],
      },
    };
    // Liveness check returns only the top-level field — 'f-deep' is dead.
    const results = [
      [
        {
          id: 'v1',
          tableId: 't1',
          type: 'grid',
          name: 'Grid',
          options: {},
          orderIndex: 0,
          createdAt: new Date(),
        },
      ],
      [{ id: 'f1' }],
    ];
    // P2 re-reads the view after acquiring the lifecycle lock.
    results.splice(1, 0, results[0]);
    let call = 0;
    chain.then = (onfulfilled: any) =>
      Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onfulfilled);
    await expect(
      viewRouter.createCaller(session()).updateOptions({ id: 'v1', options }),
    ).rejects.toThrow('View config references unknown field(s): f-deep');
  });

  it('updateOptions rejects unknown fields in sort and hiddenFields', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.limit.mockReturnValue(chain);
    // hiddenFields ids are validated too: a dead id is behaviorally harmless
    // (it hides a field that doesn't exist) but signals stale client state,
    // and field.delete's cleanup strips them — new writes must not re-add them.
    const options = {
      sort: [{ fieldId: 'f-dead', direction: 'asc' }],
      hiddenFields: ['f-hidden-dead'],
    };
    const results = [
      [
        {
          id: 'v1',
          tableId: 't1',
          type: 'grid',
          name: 'Grid',
          options: {},
          orderIndex: 0,
          createdAt: new Date(),
        },
      ],
      [],
    ];
    // P2 re-reads the view after acquiring the lifecycle lock.
    results.splice(1, 0, results[0]);
    let call = 0;
    chain.then = (onfulfilled: any) =>
      Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onfulfilled);
    await expect(
      viewRouter.createCaller(session()).updateOptions({ id: 'v1', options }),
    ).rejects.toThrow('View config references unknown field(s): f-dead, f-hidden-dead');
  });

  it('updateOptions accepts when every referenced field exists', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.limit.mockReturnValue(chain);
    const options = {
      filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'equals', operand: 'x' }] },
      sort: [{ fieldId: 'f2', direction: 'asc' }],
      group: [{ fieldId: 'f3' }],
      hiddenFields: ['f4'],
      columnWidth: { f1: 120, 'f-gone': 80 },
    };
    // Liveness check: all four referenced ids alive ('f-gone' is only a
    // columnWidth key — deliberately exempt, UI metadata).
    const results = [
      [
        {
          id: 'v1',
          tableId: 't1',
          type: 'grid',
          name: 'Grid',
          options: {},
          orderIndex: 0,
          createdAt: new Date(),
        },
      ],
      [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }, { id: 'f4' }],
      [
        {
          id: 'v1',
          tableId: 't1',
          type: 'grid',
          name: 'Grid',
          options,
          orderIndex: 0,
          createdAt: new Date(),
        },
      ],
    ];
    // P2 re-reads the view after acquiring the lifecycle lock.
    results.splice(1, 0, results[0]);
    let call = 0;
    chain.then = (onfulfilled: any) =>
      Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onfulfilled);
    const result = await viewRouter.createCaller(session()).updateOptions({ id: 'v1', options });
    expect(result.options).toEqual(options);
  });

  it('updateOptions checks field liveness after the lock and before the write', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.limit.mockReturnValue(chain);
    (chain.execute as any).mockClear();
    (chain.select as any).mockClear();
    (chain.set as any).mockClear();
    const options = {
      filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'equals', operand: 'x' }] },
    };
    const results = [
      [
        {
          id: 'v1',
          tableId: 't1',
          type: 'grid',
          name: 'Grid',
          options: {},
          orderIndex: 0,
          createdAt: new Date(),
        },
      ],
      [{ id: 'f1' }],
      [
        {
          id: 'v1',
          tableId: 't1',
          type: 'grid',
          name: 'Grid',
          options,
          orderIndex: 0,
          createdAt: new Date(),
        },
      ],
    ];
    // P2 re-reads the view after acquiring the lifecycle lock.
    results.splice(1, 0, results[0]);
    let call = 0;
    chain.then = (onfulfilled: any) =>
      Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onfulfilled);
    await viewRouter.createCaller(session()).updateOptions({ id: 'v1', options });

    // The check must run UNDER the advisory lock (so it sees the post-
    // field.delete state) and BEFORE the options write. chain.select call #2
    // is the in-tx liveness query — the pre-tx view lookup went through
    // db.select, a different mock.
    const lockOrder = (chain.execute as any).mock.invocationCallOrder[0];
    const checkOrder = (chain.select as any).mock.invocationCallOrder[1];
    const writeOrder = (chain.set as any).mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(checkOrder);
    expect(checkOrder).toBeLessThan(writeOrder);
  });

  it('delete returns ok', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.limit.mockReturnValue(chain);
    chain.then = (onfulfilled: any) =>
      Promise.resolve([
        {
          id: 'v1',
          tableId: 't1',
          type: 'grid',
          name: 'Grid',
          options: {},
          orderIndex: 0,
          createdAt: new Date(),
        },
      ]).then(onfulfilled);
    // The delete transaction (tx = the shared mock chain) issues both the
    // share cleanup and the view delete through tx.delete().where(); the
    // chain's thenable resolves [] for both awaited statements.
    const result = await viewRouter.createCaller(session()).delete({ id: 'v1' });
    expect(result.ok).toBe(true);
  });

  it('delete drops share rows pinned to the view in the same transaction', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.limit.mockReturnValue(chain);
    chain.then = (onfulfilled: any) =>
      Promise.resolve([
        {
          id: 'v1',
          tableId: 't1',
          type: 'grid',
          name: 'Grid',
          options: {},
          orderIndex: 0,
          createdAt: new Date(),
        },
      ]).then(onfulfilled);
    (chain.delete as any).mockClear();
    (chain.where as any).mockClear();
    const result = await viewRouter.createCaller(session()).delete({ id: 'v1' });
    expect(result.ok).toBe(true);
    // baseShare.viewId has no FK — the cleanup is manual and must run inside
    // the same transaction as the view delete (tx = the shared mock chain).
    expect((chain.delete as any).mock.calls).toHaveLength(2);
    const deletedTables = (chain.delete as any).mock.calls.map((c: any) => getTableName(c[0]));
    expect(deletedTables).toEqual(expect.arrayContaining(['base_share', 'view']));
  });

  it('create rejects empty name', async () => {
    await expect(
      viewRouter.createCaller(session()).create({ tableId: 't1', name: '' }),
    ).rejects.toThrow();
  });

  it('updateOptions rejects invalid options (not an object)', async () => {
    await expect(
      viewRouter.createCaller(session()).updateOptions({ id: 'v1', options: 'bad' as any }),
    ).rejects.toThrow();
  });

  it('updateOptions rejects a filter operator outside the whitelist', async () => {
    await expect(
      viewRouter.createCaller(session()).updateOptions({
        id: 'v1',
        options: {
          filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'regex', operand: 'x' }] },
        },
      }),
    ).rejects.toThrow('Unsupported filter operator');
  });

  it('updateOptions rejects oversized serialized options', async () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) wide[`column_${'_'.repeat(20)}${i}`] = 1234567890;
    await expect(
      viewRouter.createCaller(session()).updateOptions({
        id: 'v1',
        options: { columnWidth: wide },
      }),
    ).rejects.toThrow('Invalid view options');
  });

  it('create rejects an unknown view type', async () => {
    await expect(
      viewRouter
        .createCaller(session())
        .create({ tableId: 't1', name: 'X', type: 'hologram' as any }),
    ).rejects.toThrow();
  });
});

describe('viewRouter — permission', () => {
  it('create requires editor role', async () => {
    vi.mocked(await import('@/lib/roles')).assertRole = vi
      .fn()
      .mockRejectedValue(new Error('FORBIDDEN'));
    await expect(
      viewRouter.createCaller(session()).create({ tableId: 't1', name: 'x' }),
    ).rejects.toThrow('FORBIDDEN');
  });
});

describe('typed Form configuration writes', () => {
  const form = {
    title: 'Contact',
    description: '',
    fields: [{ fieldId: 'f1', required: true }],
    successMessage: 'Thanks',
  };
  async function setup(type: string, fieldType = 'text') {
    vi.mocked(await import('@/lib/roles')).assertRole = vi.fn().mockResolvedValue(undefined);
    const { db } = await import('@/server/db');
    const chain = mockQuery([] as any[]);
    chain.execute = vi.fn().mockResolvedValue([]);
    const results = [
      [{ id: 'v1', tableId: 't1', type, options: {} }],
      [{ id: 'f1' }],
      [{ id: 'f1', type: fieldType }],
      [], // P2 revokes prior publications on projection changes.
      [{ id: 'v1', tableId: 't1', type, options: { form } }],
    ];
    // P2 re-reads the view after acquiring the lifecycle lock.
    results.splice(1, 0, results[0]);
    let call = 0;
    chain.then = (onfulfilled: any) =>
      Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onfulfilled);
    vi.mocked(db.select).mockReturnValue(chain as any);
    vi.mocked(db.transaction).mockImplementation((cb: any) => cb(chain));
    return { chain };
  }
  it('saves only validated public scalar projection on Form views', async () => {
    const { chain } = await setup('form');
    const result = await viewRouter
      .createCaller(session())
      .updateOptions({ id: 'v1', options: { form } });
    expect(result.options).toEqual({ form });
    expect(chain.set).toHaveBeenCalledWith({ options: { form } });
  });
  it('rejects non-public field types before writing', async () => {
    const { chain } = await setup('form', 'user');
    await expect(
      viewRouter.createCaller(session()).updateOptions({ id: 'v1', options: { form } }),
    ).rejects.toThrow('Form field is unavailable');
    expect(chain.set).not.toHaveBeenCalled();
  });
  it('rejects Form config on Grid views', async () => {
    const { chain } = await setup('grid');
    await expect(
      viewRouter.createCaller(session()).updateOptions({ id: 'v1', options: { form } }),
    ).rejects.toThrow('Form config requires a Form view');
    expect(chain.set).not.toHaveBeenCalled();
  });
  it('rejects Grid options on Form views', async () => {
    const { chain } = await setup('form');
    await expect(
      viewRouter
        .createCaller(session())
        .updateOptions({ id: 'v1', options: { sort: [{ fieldId: 'f1', direction: 'asc' }] } }),
    ).rejects.toThrow('Form views only accept form configuration');
    expect(chain.set).not.toHaveBeenCalled();
  });
});
