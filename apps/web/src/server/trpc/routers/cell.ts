import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { FieldType, FieldOptions, normalizeCellValue } from '@/lib/field-types';
import { evaluateExpression } from '@/lib/expression-eval';
import { cell, cellHistory, field, record } from '../../db/schema';
import { db } from '../../db';
import { publishTableChange } from '../../realtime/publish';
import { protectedProcedure, router } from '../init';

async function recomputeExpressions(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tableId: string,
  recordId: string,
  changedFieldId: string,
  userId: string,
) {
  // Find expression fields whose dependsOn includes the changed field (Q2).
  const exprFields = await tx
    .select()
    .from(field)
    .where(and(eq(field.tableId, tableId), eq(field.type, FieldType.Expression)));

  for (const ef of exprFields) {
    const opts = ef.options as { expression?: string; dependsOn?: string[] };
    if (!opts.dependsOn?.includes(changedFieldId)) continue;

    // Read current cell values for this record (includes the just-written cell).
    const currentCells = await tx.select().from(cell).where(eq(cell.recordId, recordId));
    const values = new Map(currentCells.map((c) => [c.fieldId, c.value]));

    const result = evaluateExpression(opts.expression ?? '', values);

    // Write expression cell: value / error sentinel / delete if empty.
    const [existing] = await tx
      .select()
      .from(cell)
      .where(and(eq(cell.recordId, recordId), eq(cell.fieldId, ef.id)))
      .limit(1);

    if ('empty' in result) {
      if (existing) {
        await tx.insert(cellHistory).values({
          id: randomUUID(),
          cellId: existing.id,
          oldValue: existing.value,
          newValue: null,
          changedBy: userId,
        });
        await tx.delete(cell).where(eq(cell.id, existing.id));
      }
    } else {
      const exprValue = 'error' in result ? { __error: result.error } : result.value;
      if (existing) {
        await tx
          .update(cell)
          .set({ value: exprValue, updatedAt: new Date() })
          .where(eq(cell.id, existing.id));
        await tx.insert(cellHistory).values({
          id: randomUUID(),
          cellId: existing.id,
          oldValue: existing.value,
          newValue: exprValue,
          changedBy: userId,
        });
      } else {
        const newId = randomUUID();
        await tx.insert(cell).values({ id: newId, recordId, fieldId: ef.id, value: exprValue });
        await tx.insert(cellHistory).values({
          id: randomUUID(),
          cellId: newId,
          oldValue: null,
          newValue: exprValue,
          changedBy: userId,
        });
      }
    }
  }
}

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

      const result = await db.transaction(async (tx) => {
        // Write the primary cell (user-edited).
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
        }

        // Recompute dependent expression fields (same record, same transaction, Q2).
        await recomputeExpressions(
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
