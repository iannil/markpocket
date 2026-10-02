/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';

// expression.ts pulls the real pg client at import time — stub the module.
vi.mock('@/server/db', () => ({ db: {}, sql: { notify: vi.fn() } }));
vi.mock('@/lib/expression-eval', () => ({
  evaluateExpression: vi.fn().mockReturnValue({ value: 42 }),
}));

import { backfillExpressionField, materializeExpressionsForRecord } from '@/server/expression';
import { cellHistory } from '@/server/db/schema';

// A tiny drizzle-shaped tx: record selects keyset-paginate a queue, cell
// selects resolve to `cellsFor(recordId)`, writes land in arrays. `ops` logs
// statement-issue order (lock:k = the backfill's record-row UPDATE k-th
// .returning(), cells = a cell select, write = an expression cell insert) so
// tests can assert the lock precedes each record's cell snapshot.
// `vanishLockAt` makes those lock UPDATEs match 0 rows (record deleted
// between pagination and lock).
function makeTx(records: string[], opts: { vanishLockAt?: number[] } = {}) {
  const remaining = [...records];
  const vanished = new Set(opts.vanishLockAt ?? []);
  const state = { cellInserts: 0, historyInserts: 0, locks: 0, ops: [] as string[] };
  const chainFor = (resolve: () => any) => {
    const chain: Record<string, any> = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      orderBy: () => chain,
      insert: () => ({ values: async () => undefined }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      delete: () => ({ where: async () => undefined }),
      then: (onf: any) => Promise.resolve(resolve()).then(onf),
    };
    return chain;
  };
  const tx = {
    // Distinguish the two select shapes by the projection argument.
    select: (proj?: any) => {
      const isRecordSelect = proj != null && 'id' in proj;
      if (!isRecordSelect) state.ops.push('cells');
      return chainFor(() => {
        if (isRecordSelect) return remaining.splice(0, 500).map((id) => ({ id }));
        return []; // cell lookups: treat every record as having no cells yet
      });
    },
    insert: (tbl: any) => ({
      // Cell inserts chain into the upsert (.returning resolves to the row's
      // id); history inserts are awaited bare.
      values: (v: any) => {
        if (tbl === cellHistory) {
          state.historyInserts++;
          return Promise.resolve(undefined);
        }
        state.ops.push('write');
        state.cellInserts++;
        return {
          onConflictDoUpdate: () => ({
            returning: async () => [{ id: v.id }],
          }),
        };
      },
    }),
    update: () => ({
      set: () => {
        // The where-node is both awaitable (writeExpressionCell's cell update
        // has no .returning) and carries .returning (the backfill's record
        // row lock counts matched rows to detect a vanished record).
        const node: Record<string, any> = {
          returning: async () => {
            const idx = state.locks++;
            state.ops.push(`lock:${idx}`);
            return vanished.has(idx) ? [] : [{ id: 'locked' }];
          },
          then: (onf: any) => Promise.resolve(undefined).then(onf),
        };
        return { where: () => node };
      },
    }),
    delete: () => ({ where: async () => undefined }),
  };
  return { tx, state };
}

describe('backfillExpressionField', () => {
  it('commits in batches of 500 records', async () => {
    const records = Array.from({ length: 1_001 }, (_, i) => `r${String(i).padStart(5, '0')}`);
    const txs: any[] = [];
    const { db } = await import('@/server/db');
    let made = 0;
    (db as any).transaction = async (cb: any) => {
      made++;
      // One fresh tx per transaction so each batch paginates from scratch.
      const { tx, state } = makeTx(records.slice((made - 1) * 500));
      txs.push(state);
      return cb(tx);
    };

    await backfillExpressionField('t1', 'f-expr', '{f1}', 'u1');

    // 1001 records → ceil(1001/500) = 3 transactions.
    expect(made).toBe(3);
    const totalCells = txs.reduce((n, s) => n + s.cellInserts, 0);
    const totalHistory = txs.reduce((n, s) => n + s.historyInserts, 0);
    expect(totalCells).toBe(1_001);
    expect(totalHistory).toBe(1_001);
  });

  it('is a no-op on an empty table (single transaction, zero writes)', async () => {
    const { db } = await import('@/server/db');
    const cbSpy = vi.fn();
    (db as any).transaction = async (cb: any) => {
      cbSpy();
      const { tx, state } = makeTx([]);
      await cb(tx);
      return state;
    };

    await backfillExpressionField('t1', 'f-expr', '{f1}', 'u1');

    expect(cbSpy).toHaveBeenCalledTimes(1);
  });

  it('locks each record row before reading that record’s cells', async () => {
    // The lock (a value-neutral UPDATE ... RETURNING, the same lock point
    // cell.upsert takes before touching any cell) must precede the cell
    // snapshot — otherwise a concurrent upsert can commit between snapshot
    // and write, and the backfill's stale value wins with no recompute left
    // to fix it.
    const records = ['r1', 'r2'];
    const { db } = await import('@/server/db');
    let state: any;
    (db as any).transaction = async (cb: any) => {
      const t = makeTx(records);
      state = t.state;
      return cb(t.tx);
    };

    await backfillExpressionField('t1', 'f-expr', '{f1}', 'u1');

    // Per record: lock → cell snapshot → existing-cell check → write, in
    // ascending record order — the deterministic multi-record lock order
    // that keeps two concurrent backfills serializing instead of
    // deadlocking.
    expect(state.ops).toEqual([
      'lock:0',
      'cells',
      'cells',
      'write',
      'lock:1',
      'cells',
      'cells',
      'write',
    ]);
  });

  it('skips records deleted between pagination and their lock', async () => {
    // Lock UPDATE matched 0 rows → the record (and, via FK cascade, its
    // cells) is gone: nothing to materialize, and writing the expression
    // cell anyway would trip the FK and fail the whole committed-less batch.
    const records = ['r1', 'r2', 'r3'];
    const { db } = await import('@/server/db');
    let state: any;
    (db as any).transaction = async (cb: any) => {
      const t = makeTx(records, { vanishLockAt: [1] });
      state = t.state;
      return cb(t.tx);
    };

    await backfillExpressionField('t1', 'f-expr', '{f1}', 'u1');

    expect(state.ops).toEqual([
      'lock:0',
      'cells',
      'cells',
      'write',
      'lock:1', // vanished: no cell read, no write
      'lock:2',
      'cells',
      'cells',
      'write',
    ]);
  });
});

describe('materializeExpressionsForRecord — concurrent materialization', () => {
  it('two racing materializations of the same (record, field) do not throw', async () => {
    // Two editors change different source fields of the same record: their
    // advisory locks differ, both materializations select "no existing cell"
    // and insert. With a bare insert the loser failed on the unique index
    // (23505 → 500); the upsert makes it land on the winner's row instead.
    const SURVIVING_ID = 'c-survivor';
    const historyRows: any[] = [];
    const makeRacingTx = () => {
      let selects = 0;
      return {
        // select #1 reads the table's expression fields, #2 the record's cells
        // (both awaited through the same chain shape: where → orderBy → limit
        // → then for the field select).
        select: () => {
          selects++;
          const rows =
            selects === 1
              ? [
                  {
                    id: 'f-expr',
                    tableId: 't1',
                    type: 'expression',
                    options: { expression: '{f1}', dependsOn: ['f1'] },
                  },
                ]
              : [];
          const node: any = {
            orderBy: () => node,
            limit: () => node,
            then: (onf: any) => Promise.resolve(rows).then(onf),
          };
          return { from: () => ({ where: () => node }) };
        },
        insert: (tbl: any) => ({
          values: (v: any) => {
            if (tbl === cellHistory) {
              historyRows.push(v);
              return Promise.resolve(undefined);
            }
            // Both inserts "lose" to the same surviving row.
            return {
              onConflictDoUpdate: () => ({
                returning: async () => [{ id: SURVIVING_ID }],
              }),
            };
          },
        }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
        delete: () => ({ where: async () => undefined }),
      };
    };

    await Promise.all([
      materializeExpressionsForRecord(makeRacingTx() as any, 't1', 'r1', 'u1', 'f1'),
      materializeExpressionsForRecord(makeRacingTx() as any, 't1', 'r1', 'u2', 'f1'),
    ]);

    // Both histories hang off the surviving cell, not off fabricated uuids.
    expect(historyRows).toHaveLength(2);
    for (const h of historyRows) expect(h.cellId).toBe(SURVIVING_ID);
  });

  it('selects the expression fields in id order (deterministic lock order)', async () => {
    const orderByCalls: unknown[][] = [];
    const node: any = {
      orderBy: (...args: unknown[]) => {
        orderByCalls.push(args);
        return node;
      },
      limit: () => node,
      then: (onf: any) => Promise.resolve([]).then(onf),
    };
    const tx: any = {
      select: () => ({ from: () => ({ where: () => node }) }),
      insert: () => ({ values: async () => undefined }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      delete: () => ({ where: async () => undefined }),
    };

    await materializeExpressionsForRecord(tx, 't1', 'r1', 'u1');

    // Exactly the field select is ordered: writers holding different advisory
    // locks materialize concurrently, and an unordered field list could hand
    // them opposite cell-lock orders (AB-BA). The cell snapshot select stays
    // unordered — it locks nothing.
    expect(orderByCalls).toHaveLength(1);
  });
});
