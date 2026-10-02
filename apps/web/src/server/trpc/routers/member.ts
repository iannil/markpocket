import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getMembership, assertRole } from '@/lib/roles';
import { baseMember, user } from '../../db/schema';
import { db } from '../../db';
import { publishKick } from '../../realtime/publish';
import { protectedProcedure, router } from '../init';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The last-owner guard is only sound if the count and the mutation that
// follows it are one atomic unit: two owners concurrently demoting/removing
// each other (or themselves) would both pass a lock-free count and leave the
// base ownerless. Reading the base's member rows FOR UPDATE serializes
// same-base membership changes — under READ COMMITTED the loser of the race
// waits on the lock and then re-reads the winner's committed roles, so the
// guard fires for exactly one of the requests. The whole member set is locked
// (not just the target row) because the race is between changes to different
// members of the same base.
async function lockedMembers(
  tx: Tx,
  baseId: string,
): Promise<Array<{ userId: string; role: string }>> {
  return tx
    .select({ userId: baseMember.userId, role: baseMember.role })
    .from(baseMember)
    .where(eq(baseMember.baseId, baseId))
    .for('update');
}

function assertNotLastOwner(
  members: Array<{ userId: string; role: string }>,
  targetRole: string | undefined,
  action: 'demote' | 'remove',
): void {
  if (targetRole === 'owner' && members.filter((m) => m.role === 'owner').length <= 1) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Cannot ${action} the last owner of this base`,
    });
  }
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
      await db.transaction(async (tx) => {
        const members = await lockedMembers(tx, input.baseId);
        const target = members.find((m) => m.userId === input.userId)?.role;
        // Promoting to owner never reduces the owner count.
        if (input.role !== 'owner') assertNotLastOwner(members, target, 'demote');
        // 0 affected rows = target not a member (anymore) — surface as
        // NOT_FOUND like table.delete does, instead of silently succeeding
        // (and kicking) on a no-op.
        const updated = await tx
          .update(baseMember)
          .set({ role: input.role })
          .where(and(eq(baseMember.baseId, input.baseId), eq(baseMember.userId, input.userId)))
          .returning({ userId: baseMember.userId });
        if (updated.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
        }
      });
      // Force re-authorization of the affected user's realtime subscriptions
      // (their connection re-subscribes and is re-checked).
      publishKick(input.baseId, input.userId);
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ baseId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertRole(input.baseId, ctx.session.user.id, 'owner');
      await db.transaction(async (tx) => {
        const members = await lockedMembers(tx, input.baseId);
        const target = members.find((m) => m.userId === input.userId)?.role;
        assertNotLastOwner(members, target, 'remove');
        // Same 0-rows check as updateRole — a remove of a nonexistent member
        // must NOT report success (or publish a kick) for a no-op.
        const removed = await tx
          .delete(baseMember)
          .where(and(eq(baseMember.baseId, input.baseId), eq(baseMember.userId, input.userId)))
          .returning({ userId: baseMember.userId });
        if (removed.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
        }
      });
      // Close the removed user's realtime subscriptions on this base —
      // otherwise they keep receiving events until they disconnect.
      publishKick(input.baseId, input.userId);
      return { ok: true };
    }),
});
