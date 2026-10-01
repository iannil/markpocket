import { randomUUID } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { view } from '../../db/schema';
import { db } from '../../db';
import { publishTableChange } from '../../realtime/publish';
import { assertRole, baseIdFromTable, assertTableRole } from '@/lib/roles';
import { protectedProcedure, router } from '../init';

export const viewRouter = router({
  list: protectedProcedure
    .input(z.object({ tableId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTableRole(input.tableId, ctx.session.user.id, 'viewer');
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
    .mutation(async ({ ctx, input }) => {
      const baseId = await baseIdFromTable(input.tableId);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      await assertRole(baseId, ctx.session.user.id, 'editor');
      const [row] = await db
        .insert(view)
        .values({
          id: randomUUID(),
          tableId: input.tableId,
          type: input.type ?? 'grid',
          name: input.name,
        })
        .returning();
      void publishTableChange(input.tableId);
      return row;
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(view).where(eq(view.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'View not found' });
      const baseId = await baseIdFromTable(existing.tableId);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      await assertRole(baseId, ctx.session.user.id, 'editor');
      const [row] = await db
        .update(view)
        .set({ name: input.name })
        .where(eq(view.id, input.id))
        .returning();
      if (row) void publishTableChange(row.tableId);
      return row;
    }),

  updateOptions: protectedProcedure
    .input(z.object({ id: z.string(), options: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(view).where(eq(view.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'View not found' });
      const baseId = await baseIdFromTable(existing.tableId);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      await assertRole(baseId, ctx.session.user.id, 'editor');
      const [row] = await db
        .update(view)
        .set({ options: input.options })
        .where(eq(view.id, input.id))
        .returning();
      if (row) void publishTableChange(row.tableId);
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(view).where(eq(view.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'View not found' });
      const baseId = await baseIdFromTable(existing.tableId);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      await assertRole(baseId, ctx.session.user.id, 'editor');
      await db.delete(view).where(eq(view.id, input.id));
      if (existing) void publishTableChange(existing.tableId);
      return { ok: true };
    }),
});
