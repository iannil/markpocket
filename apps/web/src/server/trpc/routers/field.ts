import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  FIELD_TYPES,
  FieldType,
  FieldOptions,
  defaultOptions,
  parseOptions,
} from '@/lib/field-types';
import { field } from '../../db/schema';
import { db } from '../../db';
import { publishTableChange } from '../../realtime/publish';
import { protectedProcedure, router } from '../init';

export const fieldRouter = router({
  list: protectedProcedure.input(z.object({ tableId: z.string() })).query(async ({ input }) => {
    return db
      .select()
      .from(field)
      .where(eq(field.tableId, input.tableId))
      .orderBy(field.orderIndex);
  }),

  create: protectedProcedure
    .input(
      z.object({
        tableId: z.string(),
        name: z.string().min(1),
        type: z.enum(FIELD_TYPES),
        options: z.unknown().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const options = parseOptions(input.type, input.options ?? defaultOptions(input.type));
      const [row] = await db
        .insert(field)
        .values({
          id: randomUUID(),
          tableId: input.tableId,
          name: input.name,
          type: input.type,
          options,
        })
        .returning();
      void publishTableChange(input.tableId);
      return row;
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const [row] = await db
        .update(field)
        .set({ name: input.name })
        .where(eq(field.id, input.id))
        .returning();
      if (row) void publishTableChange(row.tableId);
      return row;
    }),

  // Note (deferred): removing a select option does NOT cascade-clear cells holding
  // that option id in Phase 1 — such cells render blank until re-edited. Lands later.
  updateOptions: protectedProcedure
    .input(z.object({ id: z.string(), options: z.unknown() }))
    .mutation(async ({ input }) => {
      const [existing] = await db.select().from(field).where(eq(field.id, input.id)).limit(1);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' });
      }
      const options = parseOptions(existing.type as FieldType, input.options) as FieldOptions;
      const [row] = await db
        .update(field)
        .set({ options })
        .where(eq(field.id, input.id))
        .returning();
      if (row) void publishTableChange(row.tableId);
      return row;
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const [existing] = await db.select().from(field).where(eq(field.id, input.id)).limit(1);
    // FK cascade clears cells; cell_history rows persist (no FK on cellId).
    await db.delete(field).where(eq(field.id, input.id));
    if (existing) void publishTableChange(existing.tableId);
    return { ok: true };
  }),
});
