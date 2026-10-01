import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { baseShare } from '../../db/schema';
import { db } from '../../db';
import { assertRole } from '@/lib/roles';
import { protectedProcedure, router } from '../init';

export const shareRouter = router({
  list: protectedProcedure.input(z.object({ baseId: z.string() })).query(async ({ ctx, input }) => {
    // Tokens grant read access — treat them like the data itself.
    await assertRole(input.baseId, ctx.session.user.id, 'viewer');
    return db.select().from(baseShare).where(eq(baseShare.baseId, input.baseId));
  }),

  create: protectedProcedure
    .input(z.object({ baseId: z.string(), viewId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertRole(input.baseId, ctx.session.user.id, 'editor');
      const [row] = await db
        .insert(baseShare)
        .values({
          id: randomUUID(),
          baseId: input.baseId,
          viewId: input.viewId,
          token: randomUUID().replace(/-/g, ''),
          createdBy: ctx.session.user.id,
        })
        .returning();
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [share] = await db
        .select({ baseId: baseShare.baseId })
        .from(baseShare)
        .where(eq(baseShare.id, input.id))
        .limit(1);
      if (!share) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });
      }
      await assertRole(share.baseId, ctx.session.user.id, 'editor');
      await db.delete(baseShare).where(eq(baseShare.id, input.id));
      return { ok: true };
    }),
});
