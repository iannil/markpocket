import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { FieldType, FieldOptions, normalizeCellValue } from '@/lib/field-types';
import { cell, cellHistory, field, record } from '../../db/schema';
import { db } from '../../db';
import { publishTableChange } from '../../realtime/publish';
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

      const normalized = normalizeCellValue(
        fld.type as FieldType,
        fld.options as FieldOptions,
        input.value,
      );
      if ('error' in normalized) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: normalized.error });
      }

      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(cell)
          .where(and(eq(cell.recordId, input.recordId), eq(cell.fieldId, input.fieldId)))
          .limit(1);

        // Empty value → delete the cell row (Q4). History records old → null.
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
          await tx
            .update(record)
            .set({ updatedAt: new Date() })
            .where(eq(record.id, input.recordId));
          return { empty: true as const };
        }

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
          await tx.insert(cell).values({
            id: newCellId,
            recordId: input.recordId,
            fieldId: input.fieldId,
            value: newValue,
          });
          await tx.insert(cellHistory).values({
            id: randomUUID(),
            cellId: newCellId,
            oldValue: null,
            newValue,
            changedBy: ctx.session.user.id,
          });
        }
        await tx.update(record).set({ updatedAt: new Date() }).where(eq(record.id, input.recordId));
        return { value: newValue };
      });
      // Broadcast the cell change to other subscribers on this table's base.
      void publishTableChange(fld.tableId, ctx.session.user.id);
    }),
});
