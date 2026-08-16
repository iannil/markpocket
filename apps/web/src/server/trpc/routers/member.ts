import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ensureMembership, assertRole } from '@/lib/roles';
import { baseMember, user } from '../../db/schema';
import { db } from '../../db';
import { protectedProcedure, router } from '../init';

export const memberRouter = router({
  me: protectedProcedure.input(z.object({ baseId: z.string() })).query(async ({ ctx, input }) => {
    return { role: await ensureMembership(input.baseId, ctx.session.user.id) };
  }),

  list: protectedProcedure.input(z.object({ baseId: z.string() })).query(async ({ input }) => {
    return db
      .select({
        userId: baseMember.userId,
        role: baseMember.role,
        name: user.name,
        email: user.email,
      })
      .from(baseMember)
      .leftJoin(user, eq(baseMember.userId, user.id))
      .where(eq(baseMember.baseId, input.baseId));
  }),

  updateRole: protectedProcedure
    .input(
      z.object({
        baseId: z.string(),
        userId: z.string(),
        role: z.enum(['owner', 'editor', 'viewer']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRole(input.baseId, ctx.session.user.id, 'owner');
      await db
        .update(baseMember)
        .set({ role: input.role })
        .where(and(eq(baseMember.baseId, input.baseId), eq(baseMember.userId, input.userId)));
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ baseId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertRole(input.baseId, ctx.session.user.id, 'owner');
      await db
        .delete(baseMember)
        .where(and(eq(baseMember.baseId, input.baseId), eq(baseMember.userId, input.userId)));
      return { ok: true };
    }),
});
