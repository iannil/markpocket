import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({ db: {} }));

import { authRouter } from './auth';
import { session } from './__test-utils';

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
});
