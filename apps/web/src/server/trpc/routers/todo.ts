import { randomUUID } from 'node:crypto';

import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { todo } from '../../db/schema';
import { db } from '../../db';
import { protectedProcedure, router } from '../init';

export const todoRouter = router({
  list: protectedProcedure.query(async () => {
    return db.select().from(todo).orderBy(desc(todo.createdAt));
  }),

  create: protectedProcedure
    .input(z.object({ text: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const [row] = await db
        .insert(todo)
        .values({ id: randomUUID(), text: input.text })
        .returning();
      return row;
    }),

  toggle: protectedProcedure
    .input(z.object({ id: z.string(), done: z.boolean() }))
    .mutation(async ({ input }) => {
      const [row] = await db
        .update(todo)
        .set({ done: input.done })
        .where(eq(todo.id, input.id))
        .returning();
      return row;
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    await db.delete(todo).where(eq(todo.id, input.id));
    return { ok: true };
  }),
});
