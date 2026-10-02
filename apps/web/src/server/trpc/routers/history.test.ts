/* eslint-disable @typescript-eslint/no-explicit-any */
import { getTableName } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { mockQuery, session } from './__test-utils';

const rolesMock = vi.hoisted(() => ({
  assertRole: vi.fn().mockResolvedValue(undefined),
  assertTableRole: vi.fn().mockResolvedValue(undefined),
  getMembership: vi.fn().mockResolvedValue('owner'),
  baseIdFromTable: vi.fn().mockResolvedValue('b1'),
}));
vi.mock('@/server/db', () => {
  const chain = mockQuery([]);
  return {
    db: {
      select: vi.fn(() => chain),
    },
    sql: { notify: vi.fn().mockResolvedValue(undefined) },
  };
});
vi.mock('@/lib/roles', () => rolesMock);

import { historyRouter } from './history';

// Sequential db.select results, one fresh chain per call (repeats the last
// entry beyond the end) — same pattern as table.test.ts / public-share.test.ts.
function queuedSelects(results: unknown[][]) {
  const chains: any[] = [];
  let call = 0;
  const impl = () => {
    const chain = mockQuery([]);
    const v = results[Math.min(call++, results.length - 1)] ?? [];
    chain.then = (onfulfilled: any) => Promise.resolve(v).then(onfulfilled);
    chains.push(chain);
    return chain;
  };
  return { impl, chains };
}

// Point the db.select mock at a fresh queue, clearing call history so
// per-test indices (calls[1] etc.) stay stable across tests.
async function useSelectQueue(results: unknown[][]) {
  const { db } = await import('@/server/db');
  const q = queuedSelects(results);
  (db.select as any).mockClear();
  (db.select as any).mockImplementation(q.impl);
  return q;
}

// Flatten a drizzle sql template (StringChunk / nested SQL / Table / Column
// nodes) into plain text so projections can be asserted without a live db.
const TABLE_FLAG = Symbol.for('drizzle:IsDrizzleTable');
function sqlText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(sqlText).join('');
  if (typeof node === 'object') {
    if (TABLE_FLAG in (node as object)) return getTableName(node as any);
    if ('queryChunks' in (node as object))
      return sqlText((node as { queryChunks: unknown[] }).queryChunks);
    if ('value' in (node as object)) return sqlText((node as { value: unknown }).value);
    if ('name' in (node as object)) return String((node as { name: unknown }).name);
  }
  return '';
}

// Bound parameters of a sql fragment: scalar chunks directly under
// queryChunks are drizzle Params (StringChunk literals live under .value,
// Columns under .name — both skipped).
function sqlParams(node: unknown): unknown[] {
  const params: unknown[] = [];
  const walkChunk = (chunk: unknown): void => {
    if (chunk == null) return;
    if (typeof chunk === 'object') {
      if (Array.isArray((chunk as { value?: unknown }).value)) return; // StringChunk
      if ('queryChunks' in (chunk as object)) {
        (chunk as { queryChunks: unknown[] }).queryChunks.forEach(walkChunk);
        return;
      }
      return; // Column / Table / other node — no bound param
    }
    params.push(chunk); // scalar chunk = bound param value
  };
  if (node && typeof node === 'object' && 'queryChunks' in (node as object)) {
    (node as { queryChunks: unknown[] }).queryChunks.forEach(walkChunk);
  }
  return params;
}

const HISTORY_ROW = (over: Record<string, unknown> = {}) => ({
  id: 'h1',
  cellId: 'c1',
  oldValue: 'a',
  newValue: 'b',
  changedAt: new Date(),
  changedByName: 'Alice',
  changedByEmail: 'alice@test.local',
  fieldName: 'Name',
  tableName: 'T1',
  ...over,
});

describe('historyRouter.listByBase', () => {
  it('returns rows with total, applying offset/limit paging and the sort tiebreaker', async () => {
    const q = await useSelectQueue([[{ value: 2 }], [HISTORY_ROW(), HISTORY_ROW({ id: 'h2' })]]);

    const result = await historyRouter
      .createCaller(session())
      .listByBase({ baseId: 'b1', offset: 10, limit: 5 });

    expect(result.total).toBe(2);
    expect(result.rows).toHaveLength(2);
    // Second select is the rows query: paged by input, ordered by
    // changed_at DESC with the unique-id tiebreaker (bulk writes stamp many
    // rows identically — offset paging without it repeats/drops rows).
    const rowsChain = q.chains[1];
    expect(rowsChain.limit).toHaveBeenCalledWith(5);
    expect(rowsChain.offset).toHaveBeenCalledWith(10);
    expect(rowsChain.orderBy.mock.calls[0]).toHaveLength(2);
  });

  it('defaults offset 0 / limit 50', async () => {
    const q = await useSelectQueue([[{ value: 0 }], []]);

    await historyRouter.createCaller(session()).listByBase({ baseId: 'b1' });

    const rowsChain = q.chains[1];
    expect(rowsChain.limit).toHaveBeenCalledWith(50);
    expect(rowsChain.offset).toHaveBeenCalledWith(0);
  });

  it('gates emails on current base membership (removed members leak no email)', async () => {
    const { db } = await import('@/server/db');
    await useSelectQueue([[{ value: 1 }], [HISTORY_ROW()]]);

    await historyRouter.createCaller(session()).listByBase({ baseId: 'b1' });

    // The rows projection (2nd select) must NOT select user.email directly —
    // a removed member's history rows would keep exposing it to viewers.
    const projection = (db.select as any).mock.calls[1][0];
    expect(projection.changedByName).toBeDefined(); // name kept for display
    const emailSql = sqlText(projection.changedByEmail);
    expect(emailSql).toContain('CASE WHEN EXISTS');
    expect(emailSql).toContain('base_member');
    expect(emailSql).toContain('user'); // correlated against the joined author
    // The base being read is a bound param — membership is scoped per base.
    expect(sqlParams(projection.changedByEmail)).toContain('b1');
  });

  it('requires viewer role on the base', async () => {
    rolesMock.assertRole.mockRejectedValueOnce(new Error('FORBIDDEN'));
    await expect(
      historyRouter.createCaller(session()).listByBase({ baseId: 'b1' }),
    ).rejects.toThrow('FORBIDDEN');
    expect(rolesMock.assertRole).toHaveBeenCalledWith('b1', 'u1', 'viewer');
  });
});

describe('historyRouter.listByTable', () => {
  it('returns rows with the table name attached, paged by input', async () => {
    const q = await useSelectQueue([
      [{ id: 't1', name: 'T1', baseId: 'b1' }], // table lookup
      [{ value: 1 }], // count
      [HISTORY_ROW()], // rows
    ]);

    const result = await historyRouter
      .createCaller(session())
      .listByTable({ tableId: 't1', offset: 4, limit: 8 });

    expect(result.total).toBe(1);
    expect(result.rows[0].tableName).toBe('T1');
    const rowsChain = q.chains[2];
    expect(rowsChain.limit).toHaveBeenCalledWith(8);
    expect(rowsChain.offset).toHaveBeenCalledWith(4);
    expect(rowsChain.orderBy.mock.calls[0]).toHaveLength(2);
  });

  it('returns empty for a nonexistent table without querying history', async () => {
    const { db } = await import('@/server/db');
    await useSelectQueue([[]]);

    const result = await historyRouter.createCaller(session()).listByTable({ tableId: 'gone' });
    expect(result).toEqual({ rows: [], total: 0 });
    expect((db.select as any).mock.calls).toHaveLength(1);
  });

  it('gates emails on membership of the table owning base', async () => {
    const { db } = await import('@/server/db');
    await useSelectQueue([
      [{ id: 't1', name: 'T1', baseId: 'b9' }], // baseId comes from the table row
      [{ value: 0 }],
      [],
    ]);

    await historyRouter.createCaller(session()).listByTable({ tableId: 't1' });

    const projection = (db.select as any).mock.calls[2][0];
    const emailSql = sqlText(projection.changedByEmail);
    expect(emailSql).toContain('base_member');
    expect(sqlParams(projection.changedByEmail)).toContain('b9');
  });

  it('requires viewer role on the table', async () => {
    rolesMock.assertTableRole.mockRejectedValueOnce(new Error('FORBIDDEN'));
    await expect(
      historyRouter.createCaller(session()).listByTable({ tableId: 't1' }),
    ).rejects.toThrow('FORBIDDEN');
    expect(rolesMock.assertTableRole).toHaveBeenCalledWith('t1', 'u1', 'viewer');
  });
});

describe('historyRouter.list (single cell)', () => {
  it('returns cell history rows for an existing cell', async () => {
    await useSelectQueue([
      [{ tableId: 't1', baseId: 'b1' }], // record → table/base
      [{ id: 'c1' }], // cell lookup
      [HISTORY_ROW()], // history rows
    ]);

    const result = await historyRouter
      .createCaller(session())
      .list({ recordId: 'r1', fieldId: 'f1' });

    expect(result).toHaveLength(1);
    expect(result[0].newValue).toBe('b');
  });

  it('returns [] for a nonexistent record or cell', async () => {
    await useSelectQueue([[{ tableId: 't1', baseId: 'b1' }], []]);

    expect(
      await historyRouter.createCaller(session()).list({ recordId: 'r1', fieldId: 'f1' }),
    ).toEqual([]);

    await useSelectQueue([[]]);
    expect(
      await historyRouter.createCaller(session()).list({ recordId: 'gone', fieldId: 'f1' }),
    ).toEqual([]);
  });

  it('gates emails on membership of the record owning base', async () => {
    const { db } = await import('@/server/db');
    await useSelectQueue([[{ tableId: 't1', baseId: 'b7' }], [{ id: 'c1' }], [HISTORY_ROW()]]);

    await historyRouter.createCaller(session()).list({ recordId: 'r1', fieldId: 'f1' });

    const projection = (db.select as any).mock.calls[2][0];
    const emailSql = sqlText(projection.changedByEmail);
    expect(emailSql).toContain('base_member');
    expect(sqlParams(projection.changedByEmail)).toContain('b7');
  });
});
