import { randomUUID } from 'node:crypto';

import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { base } from '../../db/schema';
import { db } from '../../db';
import { ensureDefaultWorkspace } from '@/lib/db-queries';
import { protectedProcedure, router } from '../init';

export const baseRouter = router({
  list: protectedProcedure.query(async () => {
    const ws = await ensureDefaultWorkspace();
    return db.select().from(base).where(eq(base.workspaceId, ws.id)).orderBy(desc(base.createdAt));
  }),

  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const [row] = await db.select().from(base).where(eq(base.id, input.id)).limit(1);
    return row ?? null;
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const ws = await ensureDefaultWorkspace();
      const [row] = await db
        .insert(base)
        .values({
          id: randomUUID(),
          workspaceId: ws.id,
          name: input.name,
          createdBy: ctx.session.user.id,
        })
        .returning();
      return row;
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const [row] = await db
        .update(base)
        .set({ name: input.name })
        .where(eq(base.id, input.id))
        .returning();
      return row;
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    // FK cascade clears tables → fields → cells → records.
    await db.delete(base).where(eq(base.id, input.id));
    return { ok: true };
  }),
});
