/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { session } from './__test-utils';

const mockDb = vi.hoisted(() => {
  function mockQuery<T>(resolveValue: T) {
    const chain: Record<string, any> & PromiseLike<T> = {
      from: vi.fn(() => chain), where: vi.fn(() => chain), limit: vi.fn(() => chain),
      orderBy: vi.fn(() => chain), select: vi.fn(() => chain), values: vi.fn(() => chain),
      returning: vi.fn(() => chain), insert: vi.fn(() => chain), update: vi.fn(() => chain),
      set: vi.fn(() => chain), delete: vi.fn(() => chain), leftJoin: vi.fn(() => chain),
      then: (onfulfilled: (v: T) => any) => Promise.resolve(resolveValue).then(onfulfilled),
      catch: (onrejected: any) => Promise.resolve(resolveValue).catch(onrejected),
    };
    return chain;
  }
  const chain = mockQuery([]);
  chain.execute = vi.fn().mockResolvedValue([]);
  return {
    db: { select: vi.fn(() => chain), insert: vi.fn(() => chain), update: vi.fn(() => chain), delete: vi.fn(() => chain), transaction: vi.fn((cb: any) => cb(chain)), execute: vi.fn().mockResolvedValue([]) },
    sql: { notify: vi.fn().mockResolvedValue(undefined) },
  };
});
vi.mock('@/server/db', () => mockDb);
vi.mock('@/lib/roles', () => ({
  assertRole: vi.fn().mockResolvedValue(undefined),
  getMembership: vi.fn().mockResolvedValue('owner'),
  baseIdFromTable: vi.fn().mockResolvedValue('b1'),
}));
vi.mock('@/realtime/publish', () => ({ publishTableChange: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/expression-eval', () => ({ evaluateExpression: vi.fn().mockReturnValue({ value: 1 }), extractDependsOn: vi.fn().mockReturnValue([]) }));
vi.mock('@/lib/view-ast', () => ({ parseViewOptions: vi.fn().mockReturnValue({}) }));
vi.mock('@/lib/view-query', () => ({ compileFilter: vi.fn().mockReturnValue(null), compileSort: vi.fn().mockReturnValue(null), applyGroup: vi.fn().mockReturnValue([]) }));
vi.mock('@/lib/db-queries', () => ({ listRecordsPivoted: vi.fn().mockResolvedValue([]), countRecords: vi.fn().mockResolvedValue(0) }));
vi.mock('@/server/plugins/field-value', () => ({ normalizeCellValue: vi.fn().mockReturnValue({ value: 'hello' }), defaultOptions: vi.fn().mockReturnValue({}), parseOptions: vi.fn().mockReturnValue({}) }));

import { fieldRouter } from './field';
import { recordRouter } from './record';
import { cellRouter } from './cell';

describe('fieldRouter', () => {
  it('list returns an array', async () => {
    const result = await fieldRouter.createCaller(session()).list({ tableId: 't1' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('create returns a field', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'f1', tableId: 't1', name: 'Name', type: 'text', options: {}, orderIndex: 0, createdAt: new Date() }]);
    (mockDb.db.insert as any).mockReturnValue({ values: vi.fn().mockReturnValue({ returning }) });
    const result = await fieldRouter.createCaller(session()).create({ tableId: 't1', name: 'Name', type: 'text' });
    expect(result.name).toBe('Name');
    expect(result.type).toBe('text');
  });

  it('create with number type and options', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'f2', tableId: 't1', name: 'Price', type: 'number', options: { precision: 2 }, orderIndex: 1, createdAt: new Date() }]);
    (mockDb.db.insert as any).mockReturnValue({ values: vi.fn().mockReturnValue({ returning }) });
    const result = await fieldRouter.createCaller(session()).create({ tableId: 't1', name: 'Price', type: 'number', options: { precision: 2 } });
    expect(result.options.precision).toBe(2);
  });

  it('create rejects invalid type', async () => {
    await expect(fieldRouter.createCaller(session()).create({ tableId: 't1', name: 'Bad', type: 'bad-type' as any })).rejects.toThrow();
  });

  it('rename returns updated field', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    ch.then = (onfulfilled: any) => Promise.resolve([{ id: 'f1', tableId: 't1', name: 'Old', type: 'text', options: {}, orderIndex: 0, createdAt: new Date() }]).then(onfulfilled);
    const returning = vi.fn().mockResolvedValue([{ id: 'f1', tableId: 't1', name: 'Renamed', type: 'text', options: {}, orderIndex: 0, createdAt: new Date() }]);
    const where = vi.fn().mockReturnValue({ returning });
    (mockDb.db.update as any).mockReturnValue({ set: vi.fn().mockReturnValue({ where }) });
    const result = await fieldRouter.createCaller(session()).rename({ id: 'f1', name: 'Renamed' });
    expect(result.name).toBe('Renamed');
  });

  it('delete returns ok', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    ch.then = (onfulfilled: any) => Promise.resolve([{ id: 'f1', tableId: 't1', name: 'F', type: 'text', options: {}, orderIndex: 0, createdAt: new Date() }]).then(onfulfilled);
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

  it('create returns a record', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'r1', tableId: 't1', createdBy: 'u1', createdAt: new Date() }]);
    (mockDb.db.insert as any).mockReturnValue({ values: vi.fn().mockReturnValue({ returning }) });
    const result = await recordRouter.createCaller(session()).create({ tableId: 't1' });
    expect(result.id).toBe('r1');
  });

  it('delete returns ok', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    ch.then = (onfulfilled: any) => Promise.resolve([]).then(onfulfilled);
    (mockDb.db.transaction as any).mockImplementation((cb: any) => cb(ch));
    const result = await recordRouter.createCaller(session()).delete({ id: 'r1', tableId: 't1' });
    expect(result.ok).toBe(true);
  });
});

describe('cellRouter', () => {
  it('upsert returns normalized value', async () => {
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    ch.then = (onfulfilled: any) => Promise.resolve([{ id: 'f1', tableId: 't1', type: 'text', options: {} }]).then(onfulfilled);
    (mockDb.db.transaction as any).mockImplementation((cb: any) => cb(ch));
    const result = await cellRouter.createCaller(session()).upsert({ recordId: 'r1', fieldId: 'f1', value: 'hello' });
    expect(result).toBeDefined();
  });

  it('upsert rejects error from normalizeCellValue', async () => {
    const mod = await import('@/server/plugins/field-value');
    (mod.normalizeCellValue as any).mockReturnValue({ error: 'Invalid value' });
    const ch = (mockDb.db.select as any)();
    ch.limit.mockReturnValue(ch);
    ch.then = (onfulfilled: any) => Promise.resolve([{ id: 'f1', tableId: 't1', type: 'text', options: {} }]).then(onfulfilled);
    await expect(cellRouter.createCaller(session()).upsert({ recordId: 'r1', fieldId: 'f1', value: 'bad' })).rejects.toThrow('Invalid value');
  });
});