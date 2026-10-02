/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockQuery, session } from './__test-utils';

// Kept in its own file (not field-record-cell.test.ts) so the record-router
// concurrency coverage stays independent of the field/cell suites.

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
      execute: vi.fn().mockResolvedValue([]),
    },
  };
});
vi.mock('@/lib/roles', () => ({
  assertRole: vi.fn().mockResolvedValue(undefined),
  assertTableRole: vi.fn().mockResolvedValue(undefined),
  getMembership: vi.fn().mockResolvedValue('owner'),
  baseIdFromTable: vi.fn().mockResolvedValue('b1'),
}));
// Path must match record.ts's own import ('../../realtime/publish' resolves
// here) — an earlier '@/realtime/publish' mock never intercepted it, so the
// real publisher ran against the mocked db and call assertions were moot.
vi.mock('@/server/realtime/publish', () => ({
  publishTableChange: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/expression-eval', () => ({
  evaluateExpression: vi.fn().mockReturnValue({ value: 1 }),
  extractDependsOn: vi.fn().mockReturnValue([]),
}));
vi.mock('@/lib/view-ast', () => ({ parseViewOptions: vi.fn().mockReturnValue({}) }));
vi.mock('@/lib/view-query', () => ({
  compileFilter: vi.fn().mockReturnValue(null),
  compileSort: vi.fn().mockReturnValue(null),
  applyGroup: vi.fn().mockReturnValue([]),
}));
vi.mock('@/lib/db-queries', () => ({
  listRecordsPivoted: vi.fn().mockResolvedValue([]),
  countRecords: vi.fn().mockResolvedValue(0),
}));

import { db } from '@/server/db';
import { publishTableChange } from '@/server/realtime/publish';
import { recordRouter } from './record';

// Flatten a drizzle sql template (StringChunk / Param / nested SQL nodes)
// into plain text — see the same helper in table.test.ts.
function sqlText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(sqlText).join('');
  if (typeof node === 'object') {
    if ('queryChunks' in (node as object))
      return sqlText((node as { queryChunks: unknown[] }).queryChunks);
    if ('value' in (node as object)) return sqlText((node as { value: unknown }).value);
  }
  return '';
}

describe('recordRouter.delete — cascade-clear locking', () => {
  beforeEach(() => {
    // Publish calls accumulate across the file's tests otherwise — each test
    // asserts on its own notices only.
    vi.mocked(publishTableChange).mockClear();
  });

  it('locks the linked-cell scan rows so concurrent cleaners cannot interleave', async () => {
    const target = mockQuery([{ tableId: 't1' }]);
    (db.select as any).mockImplementationOnce(() => target);
    const execute = vi.fn().mockResolvedValue([]);
    // The transaction's first statement locks the doomed record's own row
    // (FOR UPDATE) — it must resolve the row, or delete() bails with NOT_FOUND.
    const lockChain = mockQuery([{ id: 'r1' }]);
    const tx: any = {
      ...mockQuery([]),
      select: vi.fn(() => lockChain),
      execute,
      insert: vi.fn(() => ({ values: vi.fn() })),
    };
    (db.transaction as any).mockImplementationOnce((cb: (t: any) => Promise<unknown>) => cb(tx));

    const result = await recordRouter.createCaller(session()).delete({ id: 'r1', tableId: 't1' });
    expect(result.ok).toBe(true);

    // The record row itself is locked first — a concurrent link-writing
    // cell.upsert holds FOR SHARE on it until commit, so lock-then-scan is
    // what makes the scan see (and clean) that upsert's cell.
    expect(tx.select).toHaveBeenCalled();
    expect(lockChain.for).toHaveBeenCalledWith('update');

    // Without the row lock, this scan and a table.delete cleanup chunk can
    // snapshot the same cell, filter out different dead ids, and blind-write
    // over each other (lost update). Assert on the SQL text — the mock chain
    // cannot faithfully simulate the interleaving. Only the cell rows are
    // locked (OF c), never the joined field/table rows.
    const probe = execute.mock.calls.map((c) => sqlText(c[0])).find((t) => t.includes('FROM cell'));
    expect(probe).toBeDefined();
    expect(probe).toContain('FOR UPDATE OF c');
  });

  it('bails with NOT_FOUND when the record vanished before the lock', async () => {
    const target = mockQuery([{ tableId: 't1' }]);
    (db.select as any).mockImplementationOnce(() => target);
    const lockChain = mockQuery([]); // lock query finds no row
    const tx: any = { ...mockQuery([]), select: vi.fn(() => lockChain), execute: vi.fn() };
    (db.transaction as any).mockImplementationOnce((cb: (t: any) => Promise<unknown>) => cb(tx));

    await expect(
      recordRouter.createCaller(session()).delete({ id: 'rX', tableId: 't1' }),
    ).rejects.toThrow('Record not found');
    // The linked-cell scan never ran.
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it('notifies every referencing table of the cascade rewrite (dedup, minus own table)', async () => {
    const target = mockQuery([{ tableId: 't1' }]);
    (db.select as any).mockImplementationOnce(() => target);
    // Link cells holding the dead id, owned by tables across the base — the
    // scan now projects f.table_id so each owning table can be notified.
    const execute = vi.fn().mockResolvedValue([
      { id: 'c1', value: ['r1'], table_id: 't2' },
      { id: 'c2', value: ['r1'], table_id: 't3' },
      { id: 'c3', value: ['r1', 'r9'], table_id: 't2' }, // second hit in t2 → dedup
      { id: 'c4', value: ['r1'], table_id: 't1' }, // own table → primary notice covers it
    ]);
    const lockChain = mockQuery([{ id: 'r1' }]);
    const tx: any = {
      ...mockQuery([]),
      select: vi.fn(() => lockChain),
      execute,
      insert: vi.fn(() => ({ values: vi.fn() })),
    };
    (db.transaction as any).mockImplementationOnce((cb: (t: any) => Promise<unknown>) => cb(tx));

    const result = await recordRouter.createCaller(session()).delete({ id: 'r1', tableId: 't1' });
    expect(result.ok).toBe(true);

    // Without the per-table notices, t2/t3's clients keep rendering link cells
    // that point at the deleted record until some local edit of theirs
    // invalidates the cache. Own table first, then each referencing table
    // once, every notice with the deleter's id as echo suppression.
    const publish = vi.mocked(publishTableChange);
    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish).toHaveBeenNthCalledWith(1, 't1', 'u1');
    expect(publish).toHaveBeenNthCalledWith(2, 't2', 'u1');
    expect(publish).toHaveBeenNthCalledWith(3, 't3', 'u1');
  });

  it('notifies only the deleted record’s table when no other table references it', async () => {
    const target = mockQuery([{ tableId: 't1' }]);
    (db.select as any).mockImplementationOnce(() => target);
    const execute = vi.fn().mockResolvedValue([
      { id: 'c1', value: ['r1'], table_id: 't1' }, // only self-references
    ]);
    const lockChain = mockQuery([{ id: 'r1' }]);
    const tx: any = {
      ...mockQuery([]),
      select: vi.fn(() => lockChain),
      execute,
      insert: vi.fn(() => ({ values: vi.fn() })),
    };
    (db.transaction as any).mockImplementationOnce((cb: (t: any) => Promise<unknown>) => cb(tx));

    await recordRouter.createCaller(session()).delete({ id: 'r1', tableId: 't1' });

    expect(vi.mocked(publishTableChange)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(publishTableChange)).toHaveBeenCalledWith('t1', 'u1');
  });
});
