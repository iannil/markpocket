import { and, count, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getMembership, assertRole } from '@/lib/roles';
import { baseMember, user } from '../../db/schema';
import { db } from '../../db';
import { protectedProcedure, router } from '../init';

async function countOwners(baseId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(baseMember)
    .where(and(eq(baseMember.baseId, baseId), eq(baseMember.role, 'owner')));
  return row?.value ?? 0;
}

export const memberRouter = router({
  me: protectedProcedure.input(z.object({ baseId: z.string() })).query(async ({ ctx, input }) => {
    const role = await getMembership(input.baseId, ctx.session.user.id);
    return role ? { role } : null;
  }),

  list: protectedProcedure.input(z.object({ baseId: z.string() })).query(async ({ ctx, input }) => {
    await assertRole(input.baseId, ctx.session.user.id, 'viewer');
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
      // Never demote the last owner — the base would become unmanageable.
      const [target] = await db
        .select({ role: baseMember.role })
        .from(baseMember)
        .where(and(eq(baseMember.baseId, input.baseId), eq(baseMember.userId, input.userId)))
        .limit(1);
      if (
        target?.role === 'owner' &&
        input.role !== 'owner' &&
        (await countOwners(input.baseId)) <= 1
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot demote the last owner of this base',
        });
      }
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
      const [target] = await db
        .select({ role: baseMember.role })
        .from(baseMember)
        .where(and(eq(baseMember.baseId, input.baseId), eq(baseMember.userId, input.userId)))
        .limit(1);
      if (target?.role === 'owner' && (await countOwners(input.baseId)) <= 1) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot remove the last owner of this base',
        });
      }
      await db
        .delete(baseMember)
        .where(and(eq(baseMember.baseId, input.baseId), eq(baseMember.userId, input.userId)));
      return { ok: true };
    }),
});
