/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { mockQuery, mockRoles, session } from './__test-utils';

vi.mock('@/server/db', () => {
  const chain = mockQuery([]);
  chain.execute = vi.fn().mockResolvedValue([]);
  return {
    db: {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      transaction: vi.fn((cb: any) => cb(chain)),
      delete: vi.fn(() => chain),
      update: vi.fn(() => chain),
    },
    sql: { notify: vi.fn().mockResolvedValue(undefined) },
  };
});
vi.mock('@/lib/db-queries', () => ({
  ensureDefaultWorkspace: vi.fn().mockResolvedValue({ id: 'ws1', name: 'markpocket' }),
}));
vi.mock('@/lib/roles', () => mockRoles());
vi.mock('@/server/realtime/publish', () => ({
  publishBaseChange: vi.fn(),
  publishTableChange: vi.fn(),
  publishKick: vi.fn(),
}));
vi.mock('@/server/plugins', () => ({ getStorage: vi.fn() }));

import { baseRouter } from './base';

describe('baseRouter', () => {
  it('list returns an array', async () => {
    const result = await baseRouter.createCaller(session()).list();
    expect(Array.isArray(result)).toBe(true);
  });

  it('get returns null for nonexistent base', async () => {
    const result = await baseRouter.createCaller(session()).get({ id: 'nonexistent' });
    expect(result).toBeNull();
  });

  it('create returns a base with id', async () => {
    const { db } = await import('@/server/db');
    // create() runs inside db.transaction; the tx is the shared mock chain.
    const tx = (db.select as any)();
    tx.then = (onfulfilled: any) =>
      Promise.resolve([
        { id: 'b1', name: 'Test', workspaceId: 'ws1', createdBy: 'u1', createdAt: new Date() },
      ]).then(onfulfilled);
    const result = await baseRouter.createCaller(session()).create({ name: 'Test' });
    expect(result.id).toBe('b1');
    expect(result.name).toBe('Test');
  });

  it('rename returns updated base', async () => {
    const { db } = await import('@/server/db');
    const returning = vi
      .fn()
      .mockResolvedValue([
        { id: 'b1', name: 'Renamed', workspaceId: 'ws1', createdBy: 'u1', createdAt: new Date() },
      ]);
    const where = vi.fn().mockReturnValue({ returning });
    (db.update as any).mockReturnValue({ set: vi.fn().mockReturnValue({ where }) });
    const result = await baseRouter.createCaller(session()).rename({ id: 'b1', name: 'Renamed' });
    expect(result.name).toBe('Renamed');
  });

  it('delete returns ok', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.limit.mockReturnValue(chain);
    chain.then = (onfulfilled: any) => Promise.resolve([]).then(onfulfilled);
    (db.transaction as any).mockImplementation((cb: any) => cb(chain));
    (db.delete as any).mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const result = await baseRouter.createCaller(session()).delete({ id: 'b1' });
    expect(result.ok).toBe(true);
  });

  it('delete skips the dead-link cleanup (ADR-0005) — cascades make it pure cost', async () => {
    const { db } = await import('@/server/db');
    const baseChain = (db.select as any)();
    baseChain.then = (onfulfilled: any) => Promise.resolve([]).then(onfulfilled);

    const execute = vi.fn().mockResolvedValue([]);
    const historyInsert = vi.fn().mockResolvedValue(undefined);
    const tx: any = {
      ...mockQuery([]),
      execute,
      insert: vi.fn(() => ({ values: historyInsert })),
    };
    // The in-transaction selects resolve the attachment keys and member ids
    // (both []) — one fresh chain per select.
    let selectCall = 0;
    tx.select = vi.fn(() => {
      const chain = mockQuery([]);
      const v = selectCall++ === 0 ? [] : [];
      chain.then = (onfulfilled: any) => Promise.resolve(v).then(onfulfilled);
      return chain;
    });
    (db.transaction as any).mockImplementation((cb: any) => cb(tx));

    const result = await baseRouter.createCaller(session()).delete({ id: 'b1' });
    expect(result.ok).toBe(true);
    // Every cell the cleanup could rewrite cascades away moments later, and
    // history reads INNER JOIN cell — so no linked-cell scans and no
    // cell_history writes may run.
    expect(execute).not.toHaveBeenCalled();
    expect(historyInsert).not.toHaveBeenCalled();
    expect(tx.delete).toHaveBeenCalledWith(expect.anything());
  });

  it('delete kicks every former member off the base channel after commit', async () => {
    const { db } = await import('@/server/db');
    const { publishKick, publishBaseChange } = await import('@/server/realtime/publish');
    (publishKick as any).mockClear();
    (publishBaseChange as any).mockClear();

    // In-transaction selects, in order: attachment keys (none), member
    // snapshot (two members).
    const results: unknown[][] = [[], [{ userId: 'u1' }, { userId: 'u2' }]];
    let selectCall = 0;
    const tx: any = {
      ...mockQuery([]),
      select: vi.fn(() => {
        const chain = mockQuery([]);
        const v = results[Math.min(selectCall++, results.length - 1)];
        chain.then = (onfulfilled: any) => Promise.resolve(v).then(onfulfilled);
        return chain;
      }),
    };
    (db.transaction as any).mockImplementation((cb: any) => cb(tx));

    const result = await baseRouter.createCaller(session()).delete({ id: 'b1' });
    expect(result.ok).toBe(true);
    // Without the kicks, subscribers linger on the deleted base's channel
    // until the 5-minute membership sweep.
    expect(publishKick).toHaveBeenCalledWith('b1', 'u1');
    expect(publishKick).toHaveBeenCalledWith('b1', 'u2');
    expect(publishKick).toHaveBeenCalledTimes(2);
    expect(publishBaseChange).toHaveBeenCalled();
  });

  it('create rejects empty name', async () => {
    await expect(baseRouter.createCaller(session()).create({ name: '' })).rejects.toThrow();
  });
});

describe('baseRouter — permission', () => {
  it('rename requires editor role', async () => {
    vi.mocked(await import('@/lib/roles')).assertRole = vi
      .fn()
      .mockRejectedValue(new Error('FORBIDDEN'));
    await expect(
      baseRouter.createCaller(session()).rename({ id: 'b1', name: 'x' }),
    ).rejects.toThrow();
  });

  it('delete requires owner role', async () => {
    vi.mocked(await import('@/lib/roles')).assertRole = vi
      .fn()
      .mockRejectedValue(new Error('FORBIDDEN'));
    await expect(baseRouter.createCaller(session()).delete({ id: 'b1' })).rejects.toThrow();
  });
});
