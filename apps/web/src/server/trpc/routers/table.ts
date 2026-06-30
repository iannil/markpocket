import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { table } from '../../db/schema';
import { db } from '../../db';
import { protectedProcedure, router } from '../init';

export const tableRouter = router({
  list: protectedProcedure.input(z.object({ baseId: z.string() })).query(async ({ input }) => {
    return db.select().from(table).where(eq(table.baseId, input.baseId)).orderBy(table.orderIndex);
  }),

  create: protectedProcedure
    .input(z.object({ baseId: z.string(), name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const [row] = await db
        .insert(table)
        .values({ id: randomUUID(), baseId: input.baseId, name: input.name })
        .returning();
      return row;
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const [row] = await db
        .update(table)
        .set({ name: input.name })
        .where(eq(table.id, input.id))
        .returning();
      return row;
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    // FK cascade clears fields → cells and records.
    await db.delete(table).where(eq(table.id, input.id));
    return { ok: true };
  }),
});
