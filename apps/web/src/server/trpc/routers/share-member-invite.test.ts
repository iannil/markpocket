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
  const select = vi.fn(() => chain);
  const insert = vi.fn(() => chain);
  const update = vi.fn(() => chain);
  const del = vi.fn(() => chain);
  // Variadic wrappers so the transaction handle can forward spread args into
  // the per-test-overridable mocks above (tests pin insert/update chains via
  // db.insert/db.update even when the router writes through tx).
  const variadic =
    (fn: (...a: any[]) => any) =>
    (...a: any[]) =>
      fn(...a);
  const db = {
    select,
    insert,
    update,
    delete: del,
    transaction: vi.fn((cb: (tx: any) => Promise<unknown>) =>
      cb({
        select: variadic(select),
        insert: variadic(insert),
        update: variadic(update),
        delete: variadic(del),
      }),
    ),
  };
  return { db, sql: { notify: vi.fn().mockResolvedValue(undefined) } };
});
vi.mock('@/lib/roles', () => rolesMock);
vi.mock('@/server/realtime/publish', () => ({
  publishKick: vi.fn(),
  publishBaseChange: vi.fn(),
  publishTableChange: vi.fn(),
}));

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

  it('create stamps expiresAt 90 days out by default', async () => {
    const { db } = await import('@/server/db');
    let inserted: any;
    const returning = vi
      .fn()
      .mockResolvedValue([
        { id: 's1', token: 'abc123', expiresAt: new Date(), createdAt: new Date() },
      ]);
    (db.insert as any).mockReturnValue({
      values: vi.fn((v: any) => {
        inserted = v;
        return { returning };
      }),
    });
    await shareRouter.createCaller(session()).create({ baseId: 'b1' });
    // Without this the schema column stays null and the token never expires.
    const expected = Date.now() + 90 * 24 * 60 * 60 * 1000;
    expect(Math.abs(new Date(inserted.expiresAt).getTime() - expected)).toBeLessThan(60_000);
  });

  it('create honors a custom expiresInDays', async () => {
    const { db } = await import('@/server/db');
    let inserted: any;
    const returning = vi
      .fn()
      .mockResolvedValue([
        { id: 's2', token: 'def789', expiresAt: new Date(), createdAt: new Date() },
      ]);
    (db.insert as any).mockReturnValue({
      values: vi.fn((v: any) => {
        inserted = v;
        return { returning };
      }),
    });
    await shareRouter.createCaller(session()).create({ baseId: 'b1', expiresInDays: 7 });
    const expected = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(new Date(inserted.expiresAt).getTime() - expected)).toBeLessThan(60_000);
  });

  it('create rejects expiresInDays outside 1..365', async () => {
    await expect(
      shareRouter.createCaller(session()).create({ baseId: 'b1', expiresInDays: 0 }),
    ).rejects.toThrow();
    await expect(
      shareRouter.createCaller(session()).create({ baseId: 'b1', expiresInDays: 366 }),
    ).rejects.toThrow();
  });

  it('create with viewId sets it', async () => {
    const { db } = await import('@/server/db');
    // The view-scope check select finds the view in this base.
    const chain = (db.select as any)();
    chain.innerJoin = vi.fn().mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.then = (onfulfilled: any) => Promise.resolve([{ id: 'v1' }]).then(onfulfilled);
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

  it('create rejects a viewId that does not exist in the base', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.innerJoin = vi.fn().mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.then = (onfulfilled: any) => Promise.resolve([]).then(onfulfilled);
    await expect(
      shareRouter.createCaller(session()).create({ baseId: 'b1', viewId: 'other-base-view' }),
    ).rejects.toThrow('View not found in this base');
  });

  it('create with viewId rejects when the view config references a dead field', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.innerJoin = vi.fn().mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    // Awaited reads in order: the view-scope lookup (its stored filter
    // references f-gone), then the field liveness re-check finds no match.
    const results = [
      [
        {
          id: 'v1',
          tableId: 't1',
          options: {
            filter: {
              op: 'and',
              conditions: [{ fieldId: 'f-gone', operator: 'equals', operand: 'x' }],
            },
          },
        },
      ],
      [],
    ];
    let call = 0;
    chain.then = (onfulfilled: any) =>
      Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onfulfilled);
    (db.insert as any).mockClear();
    await expect(
      shareRouter.createCaller(session()).create({ baseId: 'b1', viewId: 'v1' }),
    ).rejects.toThrow('fix the view before sharing');
    // Rejected before the insert — no share token minted.
    expect((db.insert as any).mock.calls).toHaveLength(0);
  });

  it('create with viewId passes when the view config only references live fields', async () => {
    const { db } = await import('@/server/db');
    const chain = (db.select as any)();
    chain.innerJoin = vi.fn().mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    const results = [
      [
        {
          id: 'v1',
          tableId: 't1',
          options: {
            filter: {
              op: 'and',
              conditions: [{ fieldId: 'f1', operator: 'equals', operand: 'x' }],
            },
            sort: [{ fieldId: 'f2', direction: 'asc' }],
            hiddenFields: ['f3'],
          },
        },
      ],
      [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }],
    ];
    let call = 0;
    chain.then = (onfulfilled: any) =>
      Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onfulfilled);
    const returning = vi.fn().mockResolvedValue([
      {
        id: 's3',
        baseId: 'b1',
        viewId: 'v1',
        token: 'xyz789',
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

// tx.update(baseMember).set().where().returning() chain resolving one row.
function memberUpdateTx(members: Array<{ userId: string; role: string }>, affected = 1) {
  const chain = mockQuery(members);
  const update = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi
          .fn()
          .mockResolvedValue(Array.from({ length: affected }, () => ({ userId: 'u2' }))),
      }),
    }),
  });
  return { tx: { select: vi.fn(() => chain), update }, chain };
}

// tx.delete(baseMember).where().returning() chain resolving one row.
function memberDeleteTx(members: Array<{ userId: string; role: string }>, affected = 1) {
  const chain = mockQuery(members);
  const del = vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: vi
        .fn()
        .mockResolvedValue(Array.from({ length: affected }, () => ({ userId: 'u2' }))),
    }),
  });
  return { tx: { select: vi.fn(() => chain), delete: del }, chain };
}

describe('memberRouter', () => {
  it('list returns an array', async () => {
    const result = await memberRouter.createCaller(session()).list({ baseId: 'b1' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('updateRole returns ok', async () => {
    const { db } = await import('@/server/db');
    const { tx } = memberUpdateTx([
      { userId: 'u1', role: 'owner' },
      { userId: 'u2', role: 'editor' },
    ]);
    (db.transaction as any).mockImplementationOnce((cb: (tx: any) => Promise<unknown>) => cb(tx));
    const result = await memberRouter
      .createCaller(session())
      .updateRole({ baseId: 'b1', userId: 'u2', role: 'editor' });
    expect(result.ok).toBe(true);
  });

  it('remove returns ok', async () => {
    const { db } = await import('@/server/db');
    const { tx } = memberDeleteTx([
      { userId: 'u1', role: 'owner' },
      { userId: 'u2', role: 'editor' },
    ]);
    (db.transaction as any).mockImplementationOnce((cb: (tx: any) => Promise<unknown>) => cb(tx));
    const result = await memberRouter
      .createCaller(session())
      .remove({ baseId: 'b1', userId: 'u2' });
    expect(result.ok).toBe(true);
  });

  it('updateRole throws NOT_FOUND when the target affects 0 rows (no silent success, no kick)', async () => {
    const { db } = await import('@/server/db');
    const { publishKick } = await import('@/server/realtime/publish');
    // Target user is not among the base's members — the UPDATE matches
    // nothing. Previously this returned ok AND published a kick.
    const { tx } = memberUpdateTx([{ userId: 'u1', role: 'owner' }], 0);
    (db.transaction as any).mockImplementationOnce((cb: (tx: any) => Promise<unknown>) => cb(tx));
    (publishKick as any).mockClear();
    await expect(
      memberRouter
        .createCaller(session())
        .updateRole({ baseId: 'b1', userId: 'ghost', role: 'editor' }),
    ).rejects.toThrow('Member not found');
    expect(publishKick).not.toHaveBeenCalled();
  });

  it('remove throws NOT_FOUND when the target affects 0 rows (no silent success, no kick)', async () => {
    const { db } = await import('@/server/db');
    const { publishKick } = await import('@/server/realtime/publish');
    const { tx } = memberDeleteTx([{ userId: 'u1', role: 'owner' }], 0);
    (db.transaction as any).mockImplementationOnce((cb: (tx: any) => Promise<unknown>) => cb(tx));
    (publishKick as any).mockClear();
    await expect(
      memberRouter.createCaller(session()).remove({ baseId: 'b1', userId: 'ghost' }),
    ).rejects.toThrow('Member not found');
    expect(publishKick).not.toHaveBeenCalled();
  });

  it('demotes an owner while another owner remains (guard passes)', async () => {
    const { db } = await import('@/server/db');
    const { tx } = memberUpdateTx([
      { userId: 'u1', role: 'owner' },
      { userId: 'u2', role: 'owner' },
    ]);
    (db.transaction as any).mockImplementationOnce((cb: (tx: any) => Promise<unknown>) => cb(tx));

    const result = await memberRouter
      .createCaller(session())
      .updateRole({ baseId: 'b1', userId: 'u2', role: 'editor' });
    expect(result.ok).toBe(true);
    expect(tx.update).toHaveBeenCalled();
  });

  it('rejects demoting the last owner', async () => {
    const { db } = await import('@/server/db');
    const chain = mockQuery([{ userId: 'u1', role: 'owner' }]);
    (db.transaction as any).mockImplementationOnce((cb: (tx: any) => Promise<unknown>) =>
      cb({ select: vi.fn(() => chain), update: vi.fn() }),
    );

    await expect(
      memberRouter
        .createCaller(session())
        .updateRole({ baseId: 'b1', userId: 'u1', role: 'editor' }),
    ).rejects.toThrow('Cannot demote the last owner of this base');
  });

  it('rejects removing the last owner', async () => {
    const { db } = await import('@/server/db');
    const chain = mockQuery([{ userId: 'u1', role: 'owner' }]);
    (db.transaction as any).mockImplementationOnce((cb: (tx: any) => Promise<unknown>) =>
      cb({ select: vi.fn(() => chain), delete: vi.fn() }),
    );

    await expect(
      memberRouter.createCaller(session()).remove({ baseId: 'b1', userId: 'u1' }),
    ).rejects.toThrow('Cannot remove the last owner of this base');
  });

  it('counts owners under FOR UPDATE inside the mutation transaction', async () => {
    const { db } = await import('@/server/db');
    const { tx, chain } = memberUpdateTx([
      { userId: 'u1', role: 'owner' },
      { userId: 'u2', role: 'editor' },
    ]);
    (db.transaction as any).mockImplementationOnce((cb: (tx: any) => Promise<unknown>) => cb(tx));

    await memberRouter
      .createCaller(session())
      .updateRole({ baseId: 'b1', userId: 'u2', role: 'viewer' });

    // The mock chain cannot simulate two racing owners, so assert on the
    // mechanism instead: the count read locks the base's member rows inside
    // the same transaction as the role UPDATE — without the lock, two
    // concurrent last-owner demotions both pass the count and the base ends
    // up ownerless.
    expect(db.transaction).toHaveBeenCalled();
    expect(chain.for).toHaveBeenCalledWith('update');
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

  it('accept inserts membership with ON CONFLICT DO NOTHING (idempotent double-accept)', async () => {
    const { db } = await import('@/server/db');
    const inv = {
      id: 'i1',
      baseId: 'b1',
      email: 'alice@test.local',
      role: 'editor',
      token: 'tok',
      invitedBy: 'u1',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 100000),
      acceptedAt: null,
    };
    const chain = (db.select as any)();
    chain.limit.mockReturnValue(chain);
    chain.then = (onfulfilled: any) => Promise.resolve([inv]).then(onfulfilled);

    // The insert chain records the conflict clause — the race (two accepts
    // both inserting the same (base_id, user_id)) cannot be simulated with
    // the mock chain, so pin the mechanism: without ON CONFLICT DO NOTHING
    // the loser of the race dies on the PK with a 500 instead of succeeding
    // idempotently.
    let conflictTarget: unknown = undefined;
    const insertChain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn((cfg: unknown) => {
        conflictTarget = cfg;
        return Promise.resolve([]);
      }),
    };
    (db.insert as any).mockReturnValueOnce(insertChain);
    (db.update as any).mockReturnValueOnce({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    });

    const result = await inviteRouter.createCaller(session()).accept({ token: 'tok' });
    expect(result).toEqual({ baseId: 'b1' });
    expect(insertChain.onConflictDoNothing).toHaveBeenCalled();
    expect(conflictTarget).toBeDefined();
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
