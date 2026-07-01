import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { view } from '../../db/schema';
import { db } from '../../db';
import { protectedProcedure, router } from '../init';

export const viewRouter = router({
  list: protectedProcedure.input(z.object({ tableId: z.string() })).query(async ({ input }) => {
    return db
      .select()
      .from(view)
      .where(eq(view.tableId, input.tableId))
      .orderBy(asc(view.orderIndex));
  }),

  create: protectedProcedure
    .input(
      z.object({
        tableId: z.string(),
        name: z.string().min(1),
        type: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [row] = await db
        .insert(view)
        .values({
          id: randomUUID(),
          tableId: input.tableId,
          type: input.type ?? 'grid',
          name: input.name,
        })
        .returning();
      return row;
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const [row] = await db
        .update(view)
        .set({ name: input.name })
        .where(eq(view.id, input.id))
        .returning();
      return row;
    }),

  updateOptions: protectedProcedure
    .input(z.object({ id: z.string(), options: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ input }) => {
      const [row] = await db
        .update(view)
        .set({ options: input.options })
        .where(and(eq(view.id, input.id)))
        .returning();
      return row;
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    await db.delete(view).where(eq(view.id, input.id));
    return { ok: true };
  }),
});
