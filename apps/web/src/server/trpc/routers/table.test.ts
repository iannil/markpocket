/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { mockQuery, session } from './__test-utils';

const rolesMock = vi.hoisted(() => ({
  assertRole: vi.fn().mockResolvedValue(undefined),
  getMembership: vi.fn().mockResolvedValue('owner'),
  baseIdFromTable: vi.fn().mockResolvedValue('b1'),
}));
vi.mock('@/server/db', () => {
  const chain = mockQuery([]);
  chain.execute = vi.fn().mockResolvedValue([]);
  return {
    db: {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      transaction: vi.fn((cb: (tx: any) => Promise<unknown>) => cb(chain)),
      delete: vi.fn(() => chain),
      update: vi.fn(() => chain),
    },
    sql: { notify: vi.fn().mockResolvedValue(undefined) },
  };
});
vi.mock('@/lib/roles', () => rolesMock);
vi.mock('@/server/realtime/publish', () => ({
  publishBaseChange: vi.fn(),
  publishTableChange: vi.fn(),
}));
vi.mock('@/server/plugins', () => ({ getStorage: vi.fn() }));

import { tableRouter } from './table';

// Sequential tx.select results, one fresh chain per call (repeats the last
// entry beyond the end). The final delete transaction selects in order: the
// FOR UPDATE table-row lock, the referrer-guard re-run, the fresh record-id
// snapshot for the post-delete sweep.
function txSelectQueue(results: unknown[][]) {
  let call = 0;
  return () => {
    const chain = mockQuery([]);
    const v = results[Math.min(call++, results.length - 1)] ?? [];
    chain.then = (onfulfilled: any) => Promise.resolve(v).then(onfulfilled);
    return chain;
  };
}

// Sequential db.select results (repeats the last entry beyond the end).
function mockSelects(results: unknown[][]) {
  let call = 0;
  return () => {
    const chain = mockQuery([]);
    const v = results[Math.min(call++, results.length - 1)] ?? [];
    chain.then = (onfulfilled: any) => Promise.resolve(v).then(onfulfilled);
    return chain;
  };
}

describe('tableRouter', () => {
  it('list returns an array', async () => {
    const result = await tableRouter.createCaller(session()).list({ baseId: 'b1' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('create returns a table and creates default view in transaction', async () => {
    const { db } = await import('@/server/db');
    const tx = mockQuery([
      { id: 't1', baseId: 'b1', name: 'T1', orderIndex: 0, createdAt: new Date() },
    ]);
    // First insert inside transaction returns the table
    tx.insert = vi.fn(() => tx);
    tx.returning = vi.fn(() => tx);
    (db.transaction as any).mockImplementation((cb: any) => cb(tx));
    const result = await tableRouter.createCaller(session()).create({ baseId: 'b1', name: 'T1' });
    expect(result.id).toBe('t1');
    expect(result.name).toBe('T1');
  });

  it('rename returns updated table', async () => {
    const { db } = await import('@/server/db');
    const returning = vi
      .fn()
      .mockResolvedValue([
        { id: 't1', baseId: 'b1', name: 'Renamed', orderIndex: 0, createdAt: new Date() },
      ]);
    const where = vi.fn().mockReturnValue({ returning });
    (db.update as any).mockReturnValue({ set: vi.fn().mockReturnValue({ where }) });
    const result = await tableRouter.createCaller(session()).rename({ id: 't1', name: 'Renamed' });
    expect(result.name).toBe('Renamed');
  });

  it('delete returns ok', async () => {
    const { db } = await import('@/server/db');
    // Outer reads: referrer guard (none), dying record ids (none).
    (db.select as any).mockImplementation(mockSelects([[], []]));
    // In-tx reads: table-row lock (found), guard re-run (none), fresh
    // record-id snapshot (empty → the post-delete sweep is a no-op).
    const tx: any = {
      ...mockQuery([]),
      select: vi.fn(txSelectQueue([[{ id: 't1' }], [], []])),
      execute: vi.fn().mockResolvedValue([]),
    };
    (db.transaction as any).mockImplementation((cb: any) => cb(tx));
    const result = await tableRouter.createCaller(session()).delete({ id: 't1' });
    expect(result.ok).toBe(true);
    // Delete is owner-only (irreversible + cross-table cascade), unlike
    // create/rename which editors may use.
    expect(rolesMock.assertRole).toHaveBeenLastCalledWith('b1', session().session.user.id, 'owner');
  });

  it('delete nonexistent table throws NOT_FOUND', async () => {
    rolesMock.baseIdFromTable.mockResolvedValue(null);
    await expect(tableRouter.createCaller(session()).delete({ id: 'nonexistent' })).rejects.toThrow(
      'Table not found',
    );
    rolesMock.baseIdFromTable.mockResolvedValue('b1');
  });

  it('create rejects empty name', async () => {
    await expect(
      tableRouter.createCaller(session()).create({ baseId: 'b1', name: '' }),
    ).rejects.toThrow();
  });
});

describe('tableRouter.delete — dead link cleanup (ADR-0005 decision 5)', () => {
  // The delete flow reads the record ids outside any transaction (the cleanup
  // commits in chunks), so consecutive db.select calls serve: #1 the
  // surviving-link referrer guard, #2 the dying record ids — mockSelects at
  // module level queues those.

  // Flatten a drizzle sql template (StringChunk / Param / nested SQL nodes)
  // into plain text so tests can assert on locking clauses the query builder
  // would otherwise hide.
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

  it('strips dead ids from surviving cells and appends cell_history', async () => {
    const { db } = await import('@/server/db');
    (db.select as any).mockImplementation(mockSelects([[], [{ id: 'r1' }]]));

    // Inside a cleanup chunk: the linked-cell scan returns one cell holding a
    // dead id and a live id.
    const historyInsert = vi.fn().mockResolvedValue(undefined);
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'c9', value: ['r1', 'rkeep'] }]) // linked-cell scan
      .mockResolvedValue([]); // cell rewrites / attachment scans
    const tx: any = {
      ...mockQuery([]),
      select: vi.fn(txSelectQueue([[{ id: 't1' }], [], [{ id: 'r1' }]])),
      execute,
      insert: vi.fn(() => ({ values: historyInsert })),
    };
    (db.transaction as any).mockImplementation((cb: any) => cb(tx));

    const result = await tableRouter.createCaller(session()).delete({ id: 't1' });
    expect(result.ok).toBe(true);

    // History row logged the dead-id removal with the surviving value kept.
    expect(historyInsert).toHaveBeenCalledTimes(1);
    const logged = historyInsert.mock.calls[0][0];
    expect(logged.cellId).toBe('c9');
    expect(logged.oldValue).toEqual(['r1', 'rkeep']);
    expect(logged.newValue).toEqual(['rkeep']);
    // Linked-cell scan + value UPDATE both issued.
    expect(execute.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('locks the probe rows (FOR UPDATE) so concurrent cleaners cannot interleave', async () => {
    const { db } = await import('@/server/db');
    (db.select as any).mockImplementation(mockSelects([[], [{ id: 'r1' }]]));
    const execute = vi.fn().mockResolvedValue([]);
    const tx: any = {
      ...mockQuery([]),
      select: vi.fn(txSelectQueue([[{ id: 't1' }], [], [{ id: 'r1' }]])),
      execute,
      insert: vi.fn(() => ({ values: vi.fn() })),
    };
    (db.transaction as any).mockImplementation((cb: any) => cb(tx));

    await tableRouter.createCaller(session()).delete({ id: 't1' });

    // Window (c) closure: read-filter-write without the row lock is a
    // lost-update race between two cleaners; FOR UPDATE OF c (cell rows only,
    // never the joined field/table rows) makes the loser re-read the winner's
    // committed value. Assert on the SQL text — the mock chain cannot
    // faithfully simulate the interleaving itself.
    const probe = execute.mock.calls.map((c) => sqlText(c[0])).find((t) => t.includes('FROM cell'));
    expect(probe).toBeDefined();
    expect(probe).toContain('FOR UPDATE OF c');
  });

  it('re-runs the referrer guard inside the final delete transaction', async () => {
    const { db } = await import('@/server/db');
    // Outer guard sees no referrers; the dying record ids come back next.
    (db.select as any).mockImplementation(mockSelects([[], [{ id: 'r1' }]]));

    // The final transaction's second tx.select (the in-tx guard re-run, after
    // the table-row lock) surfaces a link field created after the fast-fail
    // pass — window (b).
    const referrer = [{ name: 'Linky', options: { targetTableId: 't1' }, tableName: 'T2' }];
    const tx: any = {
      ...mockQuery([]),
      select: vi.fn(txSelectQueue([[{ id: 't1' }], referrer])),
      execute: vi.fn().mockResolvedValue([]),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    };
    (db.transaction as any).mockImplementation((cb: any) => cb(tx));
    (db.transaction as any).mockClear();

    await expect(tableRouter.createCaller(session()).delete({ id: 't1' })).rejects.toThrow(
      /referenced by link field\(s\) T2\.Linky/,
    );
    // The rollback happened before the table delete itself ran, and no
    // post-delete sweep follows a rolled-back delete.
    expect(tx.delete).not.toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledTimes(2); // 1 cleanup chunk + the final tx
  });

  it('sweeps again after the delete commits until a round finds nothing', async () => {
    const { db } = await import('@/server/db');
    (db.select as any).mockImplementation(mockSelects([[], [{ id: 'r1' }]]));

    // A cell.upsert that passed its existence re-check during the window
    // committed the dead id after the cleanup chunks ran — window (a). The
    // sweep's first round catches it; the second round confirms zero.
    const historyInsert = vi.fn().mockResolvedValue(undefined);
    const execute = vi
      .fn()
      .mockResolvedValueOnce([]) // pre-delete cleanup chunk: nothing yet
      .mockResolvedValueOnce([]) // final tx: attachment scan
      .mockResolvedValueOnce([{ id: 'c9', value: ['r1', 'rkeep'] }]) // sweep round 1 probe
      .mockResolvedValueOnce([]) // sweep round 1 rewrite UPDATE
      .mockResolvedValueOnce([]); // sweep round 2 probe: clean
    const tx: any = {
      ...mockQuery([]),
      select: vi.fn(txSelectQueue([[{ id: 't1' }], [], [{ id: 'r1' }]])),
      execute,
      insert: vi.fn(() => ({ values: historyInsert })),
    };
    (db.transaction as any).mockImplementation((cb: any) => cb(tx));
    (db.transaction as any).mockClear();

    const result = await tableRouter.createCaller(session()).delete({ id: 't1' });
    expect(result.ok).toBe(true);
    // The window's write was stripped with a proper history row.
    expect(historyInsert).toHaveBeenCalledTimes(1);
    expect(historyInsert.mock.calls[0][0]).toMatchObject({
      cellId: 'c9',
      oldValue: ['r1', 'rkeep'],
      newValue: ['rkeep'],
    });
    // 1 cleanup chunk + 1 final delete + 2 sweep rounds.
    expect(db.transaction).toHaveBeenCalledTimes(4);
  });

  it('re-scans in new transactions until a chunk comes back under the batch size', async () => {
    const { db } = await import('@/server/db');
    (db.select as any).mockImplementation(mockSelects([[], [{ id: 'r1' }]]));

    // First scan fills the whole REWRITE_BATCH; that chunk commits, the loop
    // re-scans (now empty) — the cleanup is resumable chunk by chunk rather
    // than one long-held transaction (an interrupted run is safely retried).
    const fullBatch = Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, value: ['r1'] }));
    const historyInsert = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValueOnce(fullBatch).mockResolvedValue([]);
    const tx: any = {
      ...mockQuery([]),
      select: vi.fn(txSelectQueue([[{ id: 't1' }], [], [{ id: 'r1' }]])),
      execute,
      insert: vi.fn(() => ({ values: historyInsert })),
    };
    (db.transaction as any).mockImplementation((cb: any) => cb(tx));
    (db.transaction as any).mockClear();

    const result = await tableRouter.createCaller(session()).delete({ id: 't1' });
    expect(result.ok).toBe(true);
    expect(historyInsert).toHaveBeenCalledTimes(500);
    // 2 cleanup chunks + 1 final delete transaction + 1 sweep round.
    expect(db.transaction).toHaveBeenCalledTimes(4);
  });

  it('batches the unreferenced-attachment DELETE at 500 ids per statement', async () => {
    const { db } = await import('@/server/db');
    (db.select as any).mockImplementation(mockSelects([[], []])); // no referrers/records

    // Final transaction: the attachment scan finds 600 referenced ids, then
    // the orphan DELETE runs in two id batches (Postgres caps bind params per
    // statement at 65,535 — one statement per 500 ids stays far below it).
    const attachmentCells = Array.from({ length: 600 }, (_, i) => ({ value: [`a${i}`] }));
    const execute = vi
      .fn()
      .mockResolvedValueOnce(attachmentCells) // collectTableAttachmentIds
      .mockResolvedValue([]); // the two batched DELETE ... RETURNING statements
    const tx: any = {
      ...mockQuery([]),
      select: vi.fn(txSelectQueue([[{ id: 't1' }], [], []])),
      execute,
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    };
    (db.transaction as any).mockImplementation((cb: any) => cb(tx));

    const result = await tableRouter.createCaller(session()).delete({ id: 't1' });
    expect(result.ok).toBe(true);
    // 1 attachment scan + 2 batched DELETEs.
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('rejects when a surviving table holds a link field targeting this table', async () => {
    const { db } = await import('@/server/db');
    (db.select as any).mockImplementation(
      mockSelects([[{ name: 'Linky', tableName: 'T2', options: { targetTableId: 't1' } }]]),
    );
    (db.transaction as any).mockClear();

    await expect(tableRouter.createCaller(session()).delete({ id: 't1' })).rejects.toThrow(
      /referenced by link field\(s\) T2\.Linky/,
    );
    // Rejected before any cleanup or delete transaction ran.
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('publishes the change excluding the acting user (realtime echo)', async () => {
    const { db } = await import('@/server/db');
    const { publishBaseChange } = await import('@/server/realtime/publish');
    (db.select as any).mockImplementation(mockSelects([[], []]));
    (db.transaction as any).mockImplementation((cb: any) =>
      cb({
        ...mockQuery([]),
        select: vi.fn(txSelectQueue([[{ id: 't1' }], [], []])),
        execute: vi.fn().mockResolvedValue([]),
      }),
    );
    await tableRouter.createCaller(session()).delete({ id: 't1' });
    expect(publishBaseChange).toHaveBeenCalledWith('b1', 'u1');
  });

  it('reports NOT_FOUND when a concurrent delete already took the table', async () => {
    const { db } = await import('@/server/db');
    const { publishBaseChange } = await import('@/server/realtime/publish');
    (db.select as any).mockImplementation(mockSelects([[], []]));
    (publishBaseChange as any).mockClear();
    // The FOR UPDATE lock select matches no row: the other delete committed
    // first. The loser must fail NOT_FOUND (previously it returned {ok:true}
    // off a 0-row DELETE and published a phantom base change).
    const tx: any = {
      ...mockQuery([]),
      select: vi.fn(txSelectQueue([[]])),
      execute: vi.fn().mockResolvedValue([]),
    };
    (db.transaction as any).mockImplementation((cb: any) => cb(tx));

    await expect(tableRouter.createCaller(session()).delete({ id: 't1' })).rejects.toThrow(
      'Table not found',
    );
    expect(tx.delete).not.toHaveBeenCalled();
    expect(publishBaseChange).not.toHaveBeenCalled();
  });

  it('sweeps with the in-transaction record snapshot, not the pre-cleanup one', async () => {
    const { db } = await import('@/server/db');
    // Outer snapshot (feeds the pre-delete cleanup chunks) knows only r1;
    // rLate was created while those chunks ran. The final transaction
    // re-reads the ids after locking the table row, so the post-delete sweep
    // probes for rLate too — links to it would otherwise survive every sweep.
    (db.select as any).mockImplementation(mockSelects([[], [{ id: 'r1' }]]));
    const probes: string[] = [];
    const execute = vi.fn((frag: unknown) => {
      probes.push(sqlText(frag));
      return Promise.resolve([]);
    });
    const tx: any = {
      ...mockQuery([]),
      select: vi.fn(txSelectQueue([[{ id: 't1' }], [], [{ id: 'r1' }, { id: 'rLate' }]])),
      execute,
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    };
    (db.transaction as any).mockImplementation((cb: any) => cb(tx));

    const result = await tableRouter.createCaller(session()).delete({ id: 't1' });
    expect(result.ok).toBe(true);
    // probes: [0] pre-delete cleanup probe, [1] final tx attachment scan,
    // [2] sweep round 1 probe.
    expect(probes[0]).toContain('["r1"]');
    expect(probes[0]).not.toContain('rLate');
    expect(probes[2]).toContain('["rLate"]');
  });
});

describe('tableRouter — permission', () => {
  it('create requires editor role', async () => {
    vi.mocked(await import('@/lib/roles')).assertRole = vi
      .fn()
      .mockRejectedValue(new Error('FORBIDDEN'));
    await expect(
      tableRouter.createCaller(session()).create({ baseId: 'b1', name: 'x' }),
    ).rejects.toThrow('FORBIDDEN');
  });
});
