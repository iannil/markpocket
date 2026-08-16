import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { table, view } from '../../db/schema';
import { db } from '../../db';
import { publishBaseChange } from '../../realtime/publish';
import { assertRole, baseIdFromTable } from '@/lib/roles';
import { protectedProcedure, router } from '../init';

export const tableRouter = router({
  list: protectedProcedure.input(z.object({ baseId: z.string() })).query(async ({ input }) => {
    return db.select().from(table).where(eq(table.baseId, input.baseId)).orderBy(table.orderIndex);
  }),

  create: protectedProcedure
    .input(z.object({ baseId: z.string(), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertRole(input.baseId, ctx.session.user.id, 'editor');
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(table)
          .values({ id: randomUUID(), baseId: input.baseId, name: input.name })
          .returning();
        // Each new table ships with one default Grid view.
        await tx.insert(view).values({
          id: randomUUID(),
          tableId: row!.id,
          type: 'grid',
          name: 'Grid',
        });
        void publishBaseChange(input.baseId);
        return row;
      });
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const baseId = await baseIdFromTable(input.id);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found' });
      await assertRole(baseId, ctx.session.user.id, 'editor');
      const [row] = await db
        .update(table)
        .set({ name: input.name })
        .where(eq(table.id, input.id))
        .returning();
      if (row) void publishBaseChange(row.baseId);
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const baseId = await baseIdFromTable(input.id);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found' });
      await assertRole(baseId, ctx.session.user.id, 'editor');
      const [existing] = await db.select().from(table).where(eq(table.id, input.id)).limit(1);
      // FK cascade clears fields → cells and records.
      await db.delete(table).where(eq(table.id, input.id));
      if (existing) void publishBaseChange(existing.baseId);
      return { ok: true };
    }),
});
