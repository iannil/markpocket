/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { session } from './__test-utils';

const mockDb = vi.hoisted(() => {
  function mockQuery<T>(resolveValue: T) {
    const chain: Record<string, any> & PromiseLike<T> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      select: vi.fn(() => chain),
      values: vi.fn(() => chain),
      returning: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      set: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      onConflictDoUpdate: vi.fn(() => chain),
      // assertCellValueReferable locks referenced record rows with .for('share').
      for: vi.fn(() => chain),
      then: (onfulfilled: (v: T) => any) => Promise.resolve(resolveValue).then(onfulfilled),
      catch: (onrejected: any) => Promise.resolve(resolveValue).catch(onrejected),
    };
    return chain;
  }
  const chain = mockQuery([]);
  chain.execute = vi.fn().mockResolvedValue([]);
  return {
    db: {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      transaction: vi.fn((cb: any) => cb(chain)),
      execute: vi.fn().mockResolvedValue([]),
    },
    sql: { notify: vi.fn().mockResolvedValue(undefined) },
  };
});
vi.mock('@/server/db', () => mockDb);
vi.mock('@/lib/roles', () => ({
  assertRole: vi.fn().mockResolvedValue(undefined),
  assertTableRole: vi.fn().mockResolvedValue(undefined),
  getMembership: vi.fn().mockResolvedValue('owner'),
  baseIdFromTable: vi.fn().mockResolvedValue('b1'),
}));
vi.mock('@/realtime/publish', () => ({ publishTableChange: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/expression-eval', () => ({
  evaluateExpression: vi.fn().mockReturnValue({ value: 1 }),
  extractDependsOn: vi.fn().mockReturnValue([]),
}));
vi.mock('@/lib/view-ast', () => ({
  parseViewOptions: vi.fn().mockReturnValue({}),
  // field.delete cleanup helpers — identity/no-op mocks keep delete tests on
  // the "no view references the field" path.
  filterReferencesField: vi.fn().mockReturnValue(false),
  removeFieldReferences: vi.fn((options: unknown) => options),
  viewOptionsSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) },
}));
vi.mock('@/lib/view-query', () => ({
  compileFilter: vi.fn().mockReturnValue(null),
  compileSort: vi.fn().mockReturnValue(null),
  applyGroup: vi.fn().mockReturnValue([]),
}));
vi.mock('@/lib/db-queries', () => ({
  listRecordsPivoted: vi.fn().mockResolvedValue([]),
  countRecords: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/server/plugins/field-value', () => ({
  normalizeCellValue: vi.fn().mockReturnValue({ value: 'hello' }),
  defaultOptions: vi.fn().mockReturnValue({}),
  parseOptions: vi.fn().mockReturnValue({}),
}));
// Spy rather than stub-through: cell.upsert must call materialization with
// (…, userId, changedFieldId) — the historical arg-order bug passed the two
// swapped, dependsOn never matched, and dependent expressions were silently
// never recomputed. Asserting the spy is the regression lock.
vi.mock('@/server/expression', () => ({
  materializeExpressionsForRecord: vi.fn().mockResolvedValue([]),
}));

import { fieldRouter } from './field';
import { recordRouter } from './record';
import { cellRouter } from './cell';
import { materializeExpressionsForRecord } from '@/server/expression';
import { record as recordTable } from '../../db/schema';

describe('fieldRouter', () => {
  it('list returns an array', async () => {
    const result = await fieldRouter.createCaller(session()).list({ tableId: 't1' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('create returns a field', async () => {
    // create() runs inside db.transaction; the tx is the shared mock chain.
    const ch = (mockDb.db.select as any)();
    ch.then = (onfulfilled: any) =>
      Promise.resolve([
        {
          id: 'f1',
          tableId: 't1',
          name: 'Name',
          type: 'text',
          options: {},
          orderIndex: 0,
          createdAt: new Date(),
        },
      ]).then(onfulfilled);
    const result = await fieldRouter
      .createCaller(session())
      .create({ tableId: 't1', name: 'Name', type: 'text' });
    expect(result.name).toBe('Name');
    expect(result.type).toBe('text');
  });

  it('create with number type and options', async () => {
    const ch = (mockDb.db.select as any)();
    ch.then = (onfulfilled: any) =>
      Promise.resolve([
        {
          id: 'f2',
          tableId: 't1',
          name: 'Price',
          type: 'number',
          options: { precision: 2 },
          orderIndex: 1,
          createdAt: new Date(),
        },
      ]).then(onfulfilled);
    const result = await fieldRouter
      .createCaller(session())
      .create({ tableId: 't1', name: 'Price', type: 'number', options: { precision: 2 } });
    expect((result.options as { precision?: number }).precision).toBe(2);
  });

  it('create rejects invalid type', async () => {
    await expect(
      fieldRouter
        .createCaller(session())
        .create({ tableId: 't1', name: 'Bad', type: 'bad-type' as any }),
    ).rejects.toThrow();
  });

  it('rename returns updated field', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    ch.then = (onfulfilled: any) =>
      Promise.resolve([
        {
          id: 'f1',
          tableId: 't1',
          name: 'Old',
          type: 'text',
          options: {},
          orderIndex: 0,
          createdAt: new Date(),
        },
      ]).then(onfulfilled);
    const returning = vi.fn().mockResolvedValue([
      {
        id: 'f1',
        tableId: 't1',
        name: 'Renamed',
        type: 'text',
        options: {},
        orderIndex: 0,
        createdAt: new Date(),
      },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    (mockDb.db.update as any).mockReturnValue({ set: vi.fn().mockReturnValue({ where }) });
    const result = await fieldRouter.createCaller(session()).rename({ id: 'f1', name: 'Renamed' });
    expect(result.name).toBe('Renamed');
  });

  it('delete returns ok', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    ch.then = (onfulfilled: any) =>
      Promise.resolve([
        {
          id: 'f1',
          tableId: 't1',
          name: 'F',
          type: 'text',
          options: {},
          orderIndex: 0,
          createdAt: new Date(),
        },
      ]).then(onfulfilled);
    (mockDb.db.delete as any).mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const result = await fieldRouter.createCaller(session()).delete({ id: 'f1' });
    expect(result.ok).toBe(true);
  });
});

describe('recordRouter', () => {
  it('list returns groups', async () => {
    const result = await recordRouter.createCaller(session()).list({ tableId: 't1' });
    expect(result).toBeDefined();
    expect(result.groups).toBeDefined();
  });

  it('list rejects a viewId from another table', async () => {
    // The shared chain may carry a then-override from an earlier test — reset
    // it so the view lookup finds nothing.
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    ch.then = (onfulfilled: any) => Promise.resolve([]).then(onfulfilled);
    await expect(
      recordRouter.createCaller(session()).list({ tableId: 't1', viewId: 'vX' }),
    ).rejects.toThrow('View does not belong to this table');
  });

  it('list rejects a viewId bound to a different table', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    ch.then = (onfulfilled: any) =>
      Promise.resolve([{ id: 'vX', tableId: 't2', options: {} }]).then(onfulfilled);
    await expect(
      recordRouter.createCaller(session()).list({ tableId: 't1', viewId: 'vX' }),
    ).rejects.toThrow('View does not belong to this table');
  });

  it('create returns a record', async () => {
    // create() runs inside db.transaction; materializeExpressions reads the same
    // mocked chain (rows carry no expression fields).
    const ch = (mockDb.db.select as any)();
    ch.then = (onfulfilled: any) =>
      Promise.resolve([{ id: 'r1', tableId: 't1', createdBy: 'u1', createdAt: new Date() }]).then(
        onfulfilled,
      );
    const result = await recordRouter.createCaller(session()).create({ tableId: 't1' });
    expect(result.id).toBe('r1');
  });

  it('delete returns ok', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    // Pre-delete check resolves the record as belonging to table t1.
    ch.then = (onfulfilled: any) =>
      Promise.resolve([{ id: 'r1', tableId: 't1' }]).then(onfulfilled);
    (mockDb.db.transaction as any).mockImplementation((cb: any) => cb(ch));
    const result = await recordRouter.createCaller(session()).delete({ id: 'r1', tableId: 't1' });
    expect(result.ok).toBe(true);
  });
});

describe('cellRouter', () => {
  // Route each awaited thenable in the shared chain to the next queued result.
  function queueChainResults(ch: any, results: unknown[][]) {
    let call = 0;
    ch.then = (onfulfilled: any) => {
      const v = results[Math.min(call++, results.length - 1)] ?? [];
      return Promise.resolve(v).then(onfulfilled);
    };
  }

  it('upsert returns normalized value', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    // Same chain serves the field lookup and the record-scope check (tableId matches).
    ch.then = (onfulfilled: any) =>
      Promise.resolve([{ id: 'f1', tableId: 't1', type: 'text', options: {} }]).then(onfulfilled);
    (mockDb.db.transaction as any).mockImplementation((cb: any) => cb(ch));
    const result = await cellRouter
      .createCaller(session())
      .upsert({ recordId: 'r1', fieldId: 'f1', value: 'hello' });
    expect(result).toBeDefined();
  });

  it('upsert recomputes expressions with userId before changedFieldId', async () => {
    vi.mocked(materializeExpressionsForRecord).mockClear();
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    ch.then = (onfulfilled: any) =>
      Promise.resolve([{ id: 'f1', tableId: 't1', type: 'text', options: {} }]).then(onfulfilled);
    (mockDb.db.transaction as any).mockImplementation((cb: any) => cb(ch));
    await cellRouter
      .createCaller(session())
      .upsert({ recordId: 'r1', fieldId: 'f1', value: 'hello' });
    const args = vi.mocked(materializeExpressionsForRecord).mock.calls.at(-1);
    expect(args).toBeDefined();
    // (tx, tableId, recordId, userId, changedFieldId): the swapped order
    // fed a user id to the dependsOn filter and silently disabled all
    // expression recomputation.
    expect(args![3]).toBe('u1');
    expect(args![4]).toBe('f1');
  });

  it('upsert rejects values over the 256KB serialized cap', async () => {
    await expect(
      cellRouter
        .createCaller(session())
        .upsert({ recordId: 'r1', fieldId: 'f1', value: 'x'.repeat(256 * 1024 + 1) }),
    ).rejects.toThrow('Cell value too large');
  });

  it('upsert measures the cap in bytes, not UTF-16 code units', async () => {
    // 200,001 code units — passes the old string-length check, over the byte cap.
    await expect(
      cellRouter
        .createCaller(session())
        .upsert({ recordId: 'r1', fieldId: 'f1', value: 'あ'.repeat(200_001) }),
    ).rejects.toThrow('Cell value too large');
  });

  it('upsert rejects a link value pointing at a missing record', async () => {
    const { normalizeCellValue } = await import('@/server/plugins/field-value');
    (normalizeCellValue as any).mockReturnValue({ value: ['rMissing'] });
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    (mockDb.db.transaction as any).mockImplementation((cb: any) => cb(ch));
    // Awaited reads: router field, helper field, record scope, record lock, references.
    queueChainResults(ch, [
      [{ id: 'f1', tableId: 't1', type: 'link', options: { targetTableId: 't2' } }],
      [{ id: 'f1', tableId: 't1', type: 'link', options: { targetTableId: 't2' } }],
      [{ tableId: 't1' }],
      [{ id: 'r1' }], // record lock acquired before reference validation
      [{ id: 'rOther' }], // only rOther exists in t2 — rMissing is dangling
    ]);
    await expect(
      cellRouter
        .createCaller(session())
        .upsert({ recordId: 'r1', fieldId: 'f1', value: ['rMissing'] }),
    ).rejects.toThrow('Unknown record id: rMissing');
    (normalizeCellValue as any).mockReturnValue({ value: 'hello' });
  });

  it('upsert accepts a link value whose ids all exist in the target table', async () => {
    const { normalizeCellValue } = await import('@/server/plugins/field-value');
    (normalizeCellValue as any).mockReturnValue({ value: ['rOk'] });
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    ch.for.mockClear();
    (mockDb.db.transaction as any).mockImplementation((cb: any) => cb(ch));
    // Router/helper field reads, record scope/lock, references, existing cell.
    queueChainResults(ch, [
      [{ id: 'f1', tableId: 't1', type: 'link', options: { targetTableId: 't2' } }],
      [{ id: 'f1', tableId: 't1', type: 'link', options: { targetTableId: 't2' } }],
      [{ tableId: 't1' }],
      [{ id: 'r1' }], // early UPDATE record returning — row still exists
      [{ id: 'rOk' }], // in-transaction re-validation still sees rOk
      [], // no existing cell → insert path
    ]);
    const result = await cellRouter
      .createCaller(session())
      .upsert({ recordId: 'r1', fieldId: 'f1', value: ['rOk'] });
    expect(result).toBeDefined();
    // The existence checks lock the referenced rows FOR SHARE: held to commit
    // inside the transaction, they block a concurrent record/table delete
    // long enough for its cleanup to see (and strip) this write's dead ids.
    expect(ch.for).toHaveBeenCalledWith('share');
    (normalizeCellValue as any).mockReturnValue({ value: 'hello' });
  });

  it('upsert rejects a link value whose record vanished before the lock', async () => {
    const { normalizeCellValue } = await import('@/server/plugins/field-value');
    (normalizeCellValue as any).mockReturnValue({ value: ['rVanished'] });
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    (mockDb.db.transaction as any).mockImplementation((cb: any) => cb(ch));
    // The authoritative reference check runs after the record/advisory locks.
    queueChainResults(ch, [
      [{ id: 'f1', tableId: 't1', type: 'link', options: { targetTableId: 't2' } }],
      [{ id: 'f1', tableId: 't1', type: 'link', options: { targetTableId: 't2' } }],
      [{ tableId: 't1' }],
      [{ id: 'r1' }], // early UPDATE record returning — row still exists
      [], // in-lock re-check: deleted meanwhile
    ]);
    await expect(
      cellRouter
        .createCaller(session())
        .upsert({ recordId: 'r1', fieldId: 'f1', value: ['rVanished'] }),
    ).rejects.toThrow('Unknown record id: rVanished');
    (normalizeCellValue as any).mockReturnValue({ value: 'hello' });
  });

  it('upsert maps a lock-timeout failure to a retryable CONFLICT', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    ch.for.mockReturnValue(ch);
    ch.then = (onfulfilled: any) =>
      Promise.resolve([{ id: 'f1', tableId: 't1', type: 'text', options: {} }]).then(onfulfilled);
    // Awaited reads in order: field lookup, record scope check — then the
    // transaction itself rejects with a Postgres lock-timeout error.
    let calls = 0;
    ch.then = (onfulfilled: any) =>
      Promise.resolve(
        calls++ === 0
          ? [{ id: 'f1', tableId: 't1', type: 'text', options: {} }]
          : [{ tableId: 't1' }],
      ).then(onfulfilled);
    (mockDb.db.transaction as any).mockRejectedValueOnce(
      Object.assign(new Error('lock timeout'), { code: '55P03' }),
    );
    await expect(
      cellRouter.createCaller(session()).upsert({ recordId: 'r1', fieldId: 'f1', value: 'v' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('upsert flags overwriting a recent edit by another user', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    (mockDb.db.transaction as any).mockImplementation((cb: any) => cb(ch));
    // Awaited reads in order: field, record, the early record-row UPDATE,
    // existing cell, recent history, then write-path thenables and
    // materialize selects.
    queueChainResults(ch, [
      [{ id: 'f1', tableId: 't1', type: 'text', options: {} }],
      [{ id: 'f1', tableId: 't1', type: 'text', options: {} }],
      [{ tableId: 't1' }],
      [{ id: 'r1' }], // early UPDATE record returning — row still exists
      [{ id: 'c1', recordId: 'r1', fieldId: 'f1', value: 'old', updatedAt: new Date() }],
      [{ changedBy: 'u2', changedAt: new Date() }],
    ]);
    const result = await cellRouter
      .createCaller(session())
      .upsert({ recordId: 'r1', fieldId: 'f1', value: 'hello' });
    expect((result as any).value).toBe('hello');
    expect(result.overwroteRecentBy).toEqual({ userId: 'u2' });
  });

  it('upsert does not flag the caller overwriting their own recent edit', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    (mockDb.db.transaction as any).mockImplementation((cb: any) => cb(ch));
    queueChainResults(ch, [
      [{ id: 'f1', tableId: 't1', type: 'text', options: {} }],
      [{ id: 'f1', tableId: 't1', type: 'text', options: {} }],
      [{ tableId: 't1' }],
      [{ id: 'r1' }], // early UPDATE record returning — row still exists
      [{ id: 'c1', recordId: 'r1', fieldId: 'f1', value: 'old', updatedAt: new Date() }],
      [{ changedBy: 'u1', changedAt: new Date() }], // u1 = session user
    ]);
    const result = await cellRouter
      .createCaller(session())
      .upsert({ recordId: 'r1', fieldId: 'f1', value: 'hello' });
    expect(result.overwroteRecentBy).toBeNull();
  });

  it('upsert does not flag stale (>60s) edits by other users', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    (mockDb.db.transaction as any).mockImplementation((cb: any) => cb(ch));
    queueChainResults(ch, [
      [{ id: 'f1', tableId: 't1', type: 'text', options: {} }],
      [{ id: 'f1', tableId: 't1', type: 'text', options: {} }],
      [{ tableId: 't1' }],
      [{ id: 'r1' }], // early UPDATE record returning — row still exists
      [{ id: 'c1', recordId: 'r1', fieldId: 'f1', value: 'old', updatedAt: new Date() }],
      [{ changedBy: 'u2', changedAt: new Date(Date.now() - 120_000) }],
    ]);
    const result = await cellRouter
      .createCaller(session())
      .upsert({ recordId: 'r1', fieldId: 'f1', value: 'hello' });
    expect(result.overwroteRecentBy).toBeNull();
  });

  it('upsert on a new cell attaches history to the surviving row id', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    (mockDb.db.transaction as any).mockImplementation((cb: any) => cb(ch));
    // The shared chain accumulates insert calls across tests — assert only
    // what this test wrote.
    ch.values.mockClear();
    // Awaited reads: field, record, early UPDATE record, existing cell (none),
    // insert…returning (concurrent writer won → real id c9), recent history
    // for c9.
    queueChainResults(ch, [
      [{ id: 'f1', tableId: 't1', type: 'text', options: {} }],
      [{ id: 'f1', tableId: 't1', type: 'text', options: {} }],
      [{ tableId: 't1' }],
      [{ id: 'r1' }], // early UPDATE record returning — row still exists
      [], // no existing cell
      [{ id: 'c9' }],
      [{ changedBy: 'u2', changedAt: new Date() }],
    ]);
    const result = await cellRouter
      .createCaller(session())
      .upsert({ recordId: 'r1', fieldId: 'f1', value: 'hello' });
    expect((result as any).value).toBe('hello');
    expect(result.overwroteRecentBy).toEqual({ userId: 'u2' });
    // The history insert must use the returning id, not a fabricated uuid.
    const historyValues = ch.values.mock.calls.find((args: any[]) => args[0]?.cellId !== undefined);
    expect((historyValues?.[0] as { cellId: string }).cellId).toBe('c9');
  });

  it('upsert locks the record row before any cell row (AB-BA with record.delete)', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    (mockDb.db.transaction as any).mockImplementation((cb: any) => cb(ch));
    ch.update.mockClear();
    ch.select.mockClear();
    ch.execute.mockClear();
    ch.then = (onfulfilled: any) =>
      Promise.resolve([{ id: 'f1', tableId: 't1', type: 'text', options: {} }]).then(onfulfilled);
    await cellRouter
      .createCaller(session())
      .upsert({ recordId: 'r1', fieldId: 'f1', value: 'hello' });

    // Ownership SELECTs precede the row lock; the cell SELECT follows it.
    // The record lock must also precede the advisory key used by batch callers.
    expect(ch.update.mock.invocationCallOrder[0]).toBeLessThan(
      ch.execute.mock.invocationCallOrder[0],
    );
    const recordUpdates = ch.update.mock.calls.filter((args: any[]) => args[0] === recordTable);
    expect(recordUpdates).toHaveLength(1);
    expect(ch.update.mock.invocationCallOrder[0]).toBeLessThan(
      ch.select.mock.invocationCallOrder[2],
    );
  });

  it('upsert rejects error from normalizeCellValue', async () => {
    const mod = await import('@/server/plugins/field-value');
    (mod.normalizeCellValue as any).mockReturnValue({ error: 'Invalid value' });
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    ch.then = (onfulfilled: any) =>
      Promise.resolve([{ id: 'f1', tableId: 't1', type: 'text', options: {} }]).then(onfulfilled);
    await expect(
      cellRouter.createCaller(session()).upsert({ recordId: 'r1', fieldId: 'f1', value: 'bad' }),
    ).rejects.toThrow('Invalid value');
  });
});
