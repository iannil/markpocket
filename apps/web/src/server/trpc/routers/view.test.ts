/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { mockQuery, mockRoles, session } from './__test-utils';

vi.mock('@/server/db', () => {
  const chain = mockQuery([]);
  return {
    db: {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
    },
    sql: { notify: vi.fn().mockResolvedValue(undefined) },
  };
});
vi.mock('@/lib/roles', () => mockRoles());
vi.mock('@/realtime/publish', () => ({ publishTableChange: vi.fn() }));

import { viewRouter } from './view';

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
    const options = {
      filter: { op: 'and', conditions: [{ fieldId: 'f1', operator: 'equals', operand: 'x' }] },
    };
    const returning = vi.fn().mockResolvedValue([
      {
        id: 'v1',
        tableId: 't1',
        type: 'grid',
        name: 'Grid',
        options,
        orderIndex: 0,
        createdAt: new Date(),
      },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    (db.update as any).mockReturnValue({ set: vi.fn().mockReturnValue({ where }) });
    const result = await viewRouter.createCaller(session()).updateOptions({ id: 'v1', options });
    expect(result.options).toEqual(options);
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
    (db.delete as any).mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const result = await viewRouter.createCaller(session()).delete({ id: 'v1' });
    expect(result.ok).toBe(true);
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
