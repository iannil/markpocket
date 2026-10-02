/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  selectDistinct: vi.fn(),
}));
vi.mock('@/server/db', () => ({ db: dbMock }));

import { authRouter } from './auth';
import { session } from './__test-utils';

function chainReturning(value: unknown) {
  const chain: Record<string, any> = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (onfulfilled: any) => Promise.resolve(value).then(onfulfilled),
  };
  return chain;
}

describe('authRouter', () => {
  it('getSession returns the session from context', async () => {
    const ctx = session();
    const result = await authRouter.createCaller(ctx).getSession();
    expect(result).toEqual(ctx.session);
  });

  it('getSession works for a different user fixture', async () => {
    const ctx = session({ id: 'u2', email: 'bob@test.local', name: 'Bob' });
    const result = await authRouter.createCaller(ctx).getSession();
    expect(result.user.id).toBe('u2');
  });

  it('listUsers selects distinct users via a shared-base self-join', async () => {
    const users = [
      { id: 'u1', name: 'Alice', email: 'alice@test.local' },
      { id: 'u2', name: 'Bob', email: 'bob@test.local' },
    ];
    const chain = chainReturning(users);
    dbMock.selectDistinct.mockReturnValueOnce(chain);
    const result = await authRouter.createCaller(session()).listUsers();
    // Directory enumeration guard: must not be a plain select of all users.
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(dbMock.selectDistinct).toHaveBeenCalledTimes(1);
    expect(result).toEqual(users);
    // Shape preserved for the user-field picker: id / name / email.
    const selection = dbMock.selectDistinct.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(selection).sort()).toEqual(['email', 'id', 'name']);
  });
});
