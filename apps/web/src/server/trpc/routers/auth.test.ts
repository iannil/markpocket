import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({ db: {} }));

import { authRouter } from './auth';

describe('authRouter', () => {
  it('getSession returns the session from context', async () => {
    const session = { user: { id: 'u1', name: 'Alice', email: 'alice@test.local' } };
    const result = await authRouter.createCaller({ session }).getSession();
    expect(result).toEqual(session);
  });

  it('getSession works with minimal session', async () => {
    const session = { user: { id: 'u1' } };
    const result = await authRouter.createCaller({ session }).getSession();
    expect(result).toEqual(session);
  });
});