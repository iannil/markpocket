import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { FIELD_TYPES, FieldType, type FieldOptions } from '@/lib/field-types';
import { extractDependsOn } from '@/lib/expression-eval';
import { defaultOptions, parseOptions } from '@/server/plugins/field-value';
import { backfillExpressionField } from '@/server/expression';
import { field } from '../../db/schema';
import { db } from '../../db';
import { publishTableChange } from '../../realtime/publish';
import { assertRole, assertTableRole, baseIdFromTable } from '@/lib/roles';
import { protectedProcedure, router } from '../init';

export const fieldRouter = router({
  list: protectedProcedure
    .input(z.object({ tableId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTableRole(input.tableId, ctx.session.user.id, 'viewer');
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
    .mutation(async ({ ctx, input }) => {
      await assertTableRole(input.tableId, ctx.session.user.id, 'editor');
      const options = parseOptions(input.type, input.options ?? defaultOptions(input.type));
      // dependsOn is server-derived — a client-supplied value is never trusted.
      if (input.type === FieldType.Expression) {
        (options as { dependsOn?: string[] }).dependsOn = extractDependsOn(
          (options as { expression?: string }).expression ?? '',
        );
      }
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(field)
          .values({
            id: randomUUID(),
            tableId: input.tableId,
            name: input.name,
            type: input.type,
            options,
          })
          .returning();
        // New expression field: materialize values for existing records.
        if (input.type === FieldType.Expression) {
          const exprOpts = options as { expression?: string };
          await backfillExpressionField(
            tx,
            input.tableId,
            created!.id,
            exprOpts.expression ?? '',
            ctx.session.user.id,
          );
        }
        return created!;
      });
      void publishTableChange(input.tableId);
      return row;
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(field).where(eq(field.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' });
      await assertTableRole(existing.tableId, ctx.session.user.id, 'editor');
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
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(field).where(eq(field.id, input.id)).limit(1);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' });
      }
      await assertTableRole(existing.tableId, ctx.session.user.id, 'editor');
      const options = parseOptions(existing.type as FieldType, input.options) as FieldOptions;
      // dependsOn is server-derived on every expression write.
      if (existing.type === FieldType.Expression) {
        (options as { dependsOn?: string[] }).dependsOn = extractDependsOn(
          (options as { expression?: string }).expression ?? '',
        );
      }
      const row = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(field)
          .set({ options })
          .where(eq(field.id, input.id))
          .returning();
        // Expression definition changed: re-materialize every existing record.
        if (existing.type === FieldType.Expression) {
          const exprOpts = options as { expression?: string };
          await backfillExpressionField(
            tx,
            existing.tableId,
            input.id,
            exprOpts.expression ?? '',
            ctx.session.user.id,
          );
        }
        return updated!;
      });
      void publishTableChange(row.tableId);
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(field).where(eq(field.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' });
      const baseId = await baseIdFromTable(existing.tableId);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      await assertRole(baseId, ctx.session.user.id, 'editor');
      // FK cascade clears cells; cell_history rows persist (no FK on cellId).
      await db.delete(field).where(eq(field.id, input.id));
      void publishTableChange(existing.tableId);
      return { ok: true };
    }),
});
