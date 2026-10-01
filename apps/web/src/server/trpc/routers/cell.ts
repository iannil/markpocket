import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { FieldType, type FieldOptions } from '@/lib/field-types';
import { normalizeCellValue } from '@/server/plugins/field-value';
import { materializeExpressionsForRecord } from '@/server/expression';
import { cell, cellHistory, field, record } from '../../db/schema';
import { db } from '../../db';
import { publishTableChange } from '../../realtime/publish';
import { assertTableRole } from '@/lib/roles';
import { protectedProcedure, router } from '../init';

export const cellRouter = router({
  upsert: protectedProcedure
    .input(
      z.object({
        recordId: z.string(),
        fieldId: z.string(),
        value: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [fld] = await db.select().from(field).where(eq(field.id, input.fieldId)).limit(1);
      if (!fld) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' });
      }

      // Role gate: editor+ required
      await assertTableRole(fld.tableId, ctx.session.user.id, 'editor');

      // The record must belong to the field's table — otherwise an editor of base A
      // could hang cells off records in base B.
      const [rec] = await db
        .select({ tableId: record.tableId })
        .from(record)
        .where(eq(record.id, input.recordId))
        .limit(1);
      if (!rec || rec.tableId !== fld.tableId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found in this table' });
      }

      const normalized = normalizeCellValue(
        fld.type as FieldType,
        fld.options as FieldOptions,
        input.value,
      );
      if ('error' in normalized) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: normalized.error });
      }

      const result = await db.transaction(async (tx) => {
        // Write the primary cell (user-edited). onConflict closes the
        // select-then-insert race when two writers create the same cell at once.
        const [existing] = await tx
          .select()
          .from(cell)
          .where(and(eq(cell.recordId, input.recordId), eq(cell.fieldId, input.fieldId)))
          .limit(1);

        if ('empty' in normalized) {
          if (existing) {
            await tx.insert(cellHistory).values({
              id: randomUUID(),
              cellId: existing.id,
              oldValue: existing.value,
              newValue: null,
              changedBy: ctx.session.user.id,
            });
            await tx.delete(cell).where(eq(cell.id, existing.id));
          }
        } else {
          const newValue = normalized.value;
          if (existing) {
            await tx
              .update(cell)
              .set({ value: newValue, updatedAt: new Date() })
              .where(eq(cell.id, existing.id));
            await tx.insert(cellHistory).values({
              id: randomUUID(),
              cellId: existing.id,
              oldValue: existing.value,
              newValue,
              changedBy: ctx.session.user.id,
            });
          } else {
            const newCellId = randomUUID();
            await tx
              .insert(cell)
              .values({
                id: newCellId,
                recordId: input.recordId,
                fieldId: input.fieldId,
                value: newValue,
              })
              .onConflictDoUpdate({
                target: [cell.recordId, cell.fieldId],
                set: { value: newValue, updatedAt: new Date() },
              });
            await tx.insert(cellHistory).values({
              id: randomUUID(),
              cellId: newCellId,
              oldValue: null,
              newValue,
              changedBy: ctx.session.user.id,
            });
          }
        }

        // Recompute dependent expression fields (same record, same transaction, Q2).
        await materializeExpressionsForRecord(
          tx,
          fld.tableId,
          input.recordId,
          input.fieldId,
          ctx.session.user.id,
        );

        await tx.update(record).set({ updatedAt: new Date() }).where(eq(record.id, input.recordId));
        return normalized;
      });

      void publishTableChange(fld.tableId, ctx.session.user.id);
      return result;
    }),
});
