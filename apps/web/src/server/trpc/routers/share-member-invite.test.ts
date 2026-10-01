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
vi.mock('@/lib/roles', () => rolesMock);

import { shareRouter } from './share';

describe('shareRouter', () => {
  it('list returns an array', async () => {
    const result = await shareRouter.createCaller(session()).list({ baseId: 'b1' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('create returns a share with token', async () => {
    const { db } = await import('@/server/db');
    const returning = vi.fn().mockResolvedValue([
      {
        id: 's1',
        baseId: 'b1',
        viewId: null,
        token: 'abc123',
        expiresAt: null,
        createdAt: new Date(),
        createdBy: 'u1',
      },
    ]);
    (db.insert as any).mockReturnValue({ values: vi.fn().mockReturnValue({ returning }) });
    const result = await shareRouter.createCaller(session()).create({ baseId: 'b1' });
    expect(result.token).toBeDefined();
    expect(result.token.length).toBeGreaterThan(0);
    expect(result.createdBy).toBe('u1');
  });

  it('create with viewId sets it', async () => {
    const { db } = await import('@/server/db');
    const returning = vi.fn().mockResolvedValue([
      {
        id: 's2',
        baseId: 'b1',
        viewId: 'v1',
        token: 'def456',
        expiresAt: null,
        createdAt: new Date(),
        createdBy: 'u1',
      },
    ]);
    (db.insert as any).mockReturnValue({ values: vi.fn().mockReturnValue({ returning }) });
    const result = await shareRouter.createCaller(session()).create({ baseId: 'b1', viewId: 'v1' });
    expect(result.viewId).toBe('v1');
  });

  it('delete returns ok', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.limit.mockReturnValue(chain);
    chain.then = (onfulfilled: any) =>
      Promise.resolve([
        {
          id: 's1',
          baseId: 'b1',
          viewId: null,
          token: 't',
          expiresAt: null,
          createdAt: new Date(),
          createdBy: 'u1',
        },
      ]).then(onfulfilled);
    (db.delete as any).mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const result = await shareRouter.createCaller(session()).delete({ id: 's1' });
    expect(result.ok).toBe(true);
  });
});

describe('shareRouter — permission', () => {
  it('create requires editor role', async () => {
    rolesMock.assertRole = vi.fn().mockRejectedValue(new Error('FORBIDDEN'));
    await expect(shareRouter.createCaller(session()).create({ baseId: 'b1' })).rejects.toThrow(
      'FORBIDDEN',
    );
    rolesMock.assertRole = vi.fn().mockResolvedValue(undefined);
  });
});

// ── member router ──
import { memberRouter } from './member';

describe('memberRouter', () => {
  it('list returns an array', async () => {
    const result = await memberRouter.createCaller(session()).list({ baseId: 'b1' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('updateRole returns ok', async () => {
    const { db } = await import('@/server/db');
    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    });
    const result = await memberRouter
      .createCaller(session())
      .updateRole({ baseId: 'b1', userId: 'u2', role: 'editor' });
    expect(result.ok).toBe(true);
  });

  it('remove returns ok', async () => {
    const { db } = await import('@/server/db');
    (db.delete as any).mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const result = await memberRouter
      .createCaller(session())
      .remove({ baseId: 'b1', userId: 'u2' });
    expect(result.ok).toBe(true);
  });
});

// ── invite router ──
import { inviteRouter } from './invite';

describe('inviteRouter', () => {
  it('list returns an array', async () => {
    const result = await inviteRouter.createCaller(session()).list({ baseId: 'b1' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('create returns an invite with token', async () => {
    const { db } = await import('@/server/db');
    const returning = vi.fn().mockResolvedValue([
      {
        id: 'i1',
        baseId: 'b1',
        email: 'bob@test.local',
        role: 'editor',
        token: 'tok123',
        invitedBy: 'u1',
        createdAt: new Date(),
        expiresAt: new Date(),
        acceptedAt: null,
      },
    ]);
    // create first selects existing invites (returns []) then inserts
    const chain = (db.select as any)();
    chain.then = (onfulfilled: any) => Promise.resolve([]).then(onfulfilled); // no existing
    (db.insert as any).mockReturnValue({ values: vi.fn().mockReturnValue({ returning }) });
    const result = await inviteRouter
      .createCaller(session())
      .create({ baseId: 'b1', email: 'bob@test.local', role: 'editor' });
    expect(result.token).toBeDefined();
    expect(result.email).toBe('bob@test.local');
    expect(result.role).toBe('editor');
  });

  it('resolve returns null for nonexistent token', async () => {
    const result = await inviteRouter.createCaller({ session: null }).resolve({ token: 'nope' });
    expect(result).toBeNull();
  });

  it('resolve returns base info for valid token', async () => {
    const { db } = await import('@/server/db');
    // First select returns invite, second returns base
    const chain = (db.select as any)();
    let call = 0;
    chain.limit.mockReturnValue(chain);
    chain.then = (onfulfilled: any) => {
      call++;
      const data =
        call === 1
          ? [
              {
                id: 'i1',
                baseId: 'b1',
                email: 'bob@test.local',
                role: 'editor',
                token: 'tok',
                invitedBy: 'u1',
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 100000),
                acceptedAt: null,
              },
            ]
          : [{ id: 'b1', name: 'My Base' }];
      return Promise.resolve(data).then(onfulfilled);
    };
    const result = await inviteRouter.createCaller({ session: null }).resolve({ token: 'tok' });
    expect(result).toEqual({
      baseId: 'b1',
      baseName: 'My Base',
      email: 'bob@test.local',
      role: 'editor',
    });
  });

  it('create rejects invalid email', async () => {
    await expect(
      inviteRouter
        .createCaller(session())
        .create({ baseId: 'b1', email: 'not-an-email', role: 'editor' }),
    ).rejects.toThrow();
  });

  it('create rejects invalid role', async () => {
    await expect(
      inviteRouter
        .createCaller(session())
        .create({ baseId: 'b1', email: 'bob@test.local', role: 'owner' as any }),
    ).rejects.toThrow();
  });
});

describe('inviteRouter — permission', () => {
  it('create requires owner role', async () => {
    rolesMock.assertRole = vi.fn().mockRejectedValue(new Error('FORBIDDEN'));
    await expect(
      inviteRouter
        .createCaller(session())
        .create({ baseId: 'b1', email: 'x@test.local', role: 'editor' }),
    ).rejects.toThrow('FORBIDDEN');
    rolesMock.assertRole = vi.fn().mockResolvedValue(undefined);
  });

  it('delete requires owner role', async () => {
    rolesMock.assertRole = vi.fn().mockRejectedValue(new Error('FORBIDDEN'));
    await expect(inviteRouter.createCaller(session()).delete({ id: 'i1' })).rejects.toThrow(
      'FORBIDDEN',
    );
    rolesMock.assertRole = vi.fn().mockResolvedValue(undefined);
  });
});
