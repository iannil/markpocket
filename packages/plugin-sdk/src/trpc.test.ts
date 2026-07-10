import { describe, expect, it } from 'vitest';

import { protectedProcedure, publicProcedure, router, type PluginContext } from './trpc';

describe('sdk trpc runtime', () => {
  it('builds a router whose public procedure runs via caller', async () => {
    const r = router({ ping: publicProcedure.query(() => 'pong') });
    const caller = r.createCaller({ session: null } satisfies PluginContext);
    expect(await caller.ping()).toBe('pong');
  });

  it('protectedProcedure rejects when session is null', async () => {
    const r = router({ me: protectedProcedure.query(({ ctx }) => ctx.session.user.id) });
    const caller = r.createCaller({ session: null } satisfies PluginContext);
    await expect(caller.me()).rejects.toThrow(/UNAUTHORIZED|Not signed in/);
  });

  it('protectedProcedure exposes session.user.id when present', async () => {
    const r = router({ me: protectedProcedure.query(({ ctx }) => ctx.session.user.id) });
    const caller = r.createCaller({ session: { user: { id: 'u1' } } });
    expect(await caller.me()).toBe('u1');
  });
});
