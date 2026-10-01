/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { mockQuery, mockRoles, session } from './__test-utils';

vi.mock('@/server/db', () => {
  const chain = mockQuery([]);
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
vi.mock('@/realtime/publish', () => ({ publishBaseChange: vi.fn(), publishTableChange: vi.fn() }));

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
    (db.delete as any).mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const result = await baseRouter.createCaller(session()).delete({ id: 'b1' });
    expect(result.ok).toBe(true);
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
