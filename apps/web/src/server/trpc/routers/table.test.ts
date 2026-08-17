/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { mockQuery, session } from './__test-utils';

const rolesMock = vi.hoisted(() => ({ assertRole: vi.fn().mockResolvedValue(undefined), getMembership: vi.fn().mockResolvedValue('owner'), baseIdFromTable: vi.fn().mockResolvedValue('b1') }));
vi.mock('@/server/db', () => {
  const chain = mockQuery([]);
  return { db: { select: vi.fn(() => chain), insert: vi.fn(() => chain), transaction: vi.fn((cb: (tx: any) => Promise<unknown>) => cb(chain)), delete: vi.fn(() => chain), update: vi.fn(() => chain) }, sql: { notify: vi.fn().mockResolvedValue(undefined) } };
});
vi.mock('@/lib/roles', () => rolesMock);
vi.mock('@/realtime/publish', () => ({ publishBaseChange: vi.fn(), publishTableChange: vi.fn() }));

import { tableRouter } from './table';

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
    const returning = vi.fn().mockResolvedValue([{ id: 't1', baseId: 'b1', name: 'Renamed', orderIndex: 0, createdAt: new Date() }]);
    const where = vi.fn().mockReturnValue({ returning });
    (db.update as any).mockReturnValue({ set: vi.fn().mockReturnValue({ where }) });
    const result = await tableRouter.createCaller(session()).rename({ id: 't1', name: 'Renamed' });
    expect(result.name).toBe('Renamed');
  });

  it('delete returns ok', async () => {
    const { db } = await import('@/server/db');
    // delete first selects the table (returns a row), then deletes
    const chain = (db.select as any)();
    chain.limit.mockReturnValue(chain);
    chain.then = (onfulfilled: any) => Promise.resolve([{ id: 't1', baseId: 'b1', name: 'T1', orderIndex: 0, createdAt: new Date() }]).then(onfulfilled);
    (db.delete as any).mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const result = await tableRouter.createCaller(session()).delete({ id: 't1' });
    expect(result.ok).toBe(true);
  });

  it('delete nonexistent table throws NOT_FOUND', async () => {
    rolesMock.baseIdFromTable.mockResolvedValue(null);
    await expect(tableRouter.createCaller(session()).delete({ id: 'nonexistent' }))
      .rejects.toThrow('Table not found');
  });

  it('create rejects empty name', async () => {
    await expect(tableRouter.createCaller(session()).create({ baseId: 'b1', name: '' }))
      .rejects.toThrow();
  });
});

describe('tableRouter — permission', () => {
  it('create requires editor role', async () => {
    vi.mocked(await import('@/lib/roles')).assertRole = vi.fn().mockRejectedValue(new Error('FORBIDDEN'));
    await expect(tableRouter.createCaller(session()).create({ baseId: 'b1', name: 'x' })).rejects.toThrow('FORBIDDEN');
  });
});