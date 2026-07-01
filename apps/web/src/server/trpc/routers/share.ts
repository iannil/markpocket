import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { baseShare } from '../../db/schema';
import { db } from '../../db';
import { protectedProcedure, router } from '../init';

export const shareRouter = router({
  list: protectedProcedure.input(z.object({ baseId: z.string() })).query(async ({ input }) => {
    return db.select().from(baseShare).where(eq(baseShare.baseId, input.baseId));
  }),

  create: protectedProcedure
    .input(z.object({ baseId: z.string(), viewId: z.string().optional() }))
    .mutation(async ({ input }) => {
      const [row] = await db
        .insert(baseShare)
        .values({
          id: randomUUID(),
          baseId: input.baseId,
          viewId: input.viewId,
          token: randomUUID().replace(/-/g, ''),
        })
        .returning();
      return row;
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    await db.delete(baseShare).where(eq(baseShare.id, input.id));
    return { ok: true };
  }),
});
