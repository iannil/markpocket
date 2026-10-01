import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { FieldType, type FieldOptions } from '@/lib/field-types';
import { evaluateExpression } from '@/lib/expression-eval';
import { cell, cellHistory, field, record } from './db/schema';
import { db } from './db';

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Write one expression cell for `recordId` following ADR-0005: value → store
// JSONB, error → { __error } sentinel, empty → no row. Appends cell_history.
async function writeExpressionCell(
  tx: DbTx,
  recordId: string,
  expressionFieldId: string,
  result: ReturnType<typeof evaluateExpression>,
  userId: string,
) {
  const [existing] = await tx
    .select()
    .from(cell)
    .where(and(eq(cell.recordId, recordId), eq(cell.fieldId, expressionFieldId)))
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
    return;
  }

  const value = 'error' in result ? { __error: result.error } : result.value;
  if (existing) {
    await tx.update(cell).set({ value, updatedAt: new Date() }).where(eq(cell.id, existing.id));
    await tx.insert(cellHistory).values({
      id: randomUUID(),
      cellId: existing.id,
      oldValue: existing.value,
      newValue: value,
      changedBy: userId,
    });
  } else {
    const newId = randomUUID();
    await tx.insert(cell).values({ id: newId, recordId, fieldId: expressionFieldId, value });
    await tx.insert(cellHistory).values({
      id: randomUUID(),
      cellId: newId,
      oldValue: null,
      newValue: value,
      changedBy: userId,
    });
  }
}

// Recompute expression cells for one record (ADR-0003 Q2). When `changedFieldId`
// is given, only expression fields depending on it are recomputed; otherwise all
// expression fields of the table are (used by record.create).
export async function materializeExpressionsForRecord(
  tx: DbTx,
  tableId: string,
  recordId: string,
  userId: string,
  changedFieldId?: string,
): Promise<void> {
  const exprFields = await tx
    .select()
    .from(field)
    .where(and(eq(field.tableId, tableId), eq(field.type, FieldType.Expression)));

  // One fetch of the record's current cells, shared by every dependent field.
  const currentCells = await tx.select().from(cell).where(eq(cell.recordId, recordId));
  const values = new Map(currentCells.map((c) => [c.fieldId, c.value]));

  for (const ef of exprFields) {
    const opts = (ef.options ?? {}) as { expression?: string; dependsOn?: string[] } & FieldOptions;
    if (changedFieldId && !opts.dependsOn?.includes(changedFieldId)) continue;
    const result = evaluateExpression(opts.expression ?? '', values);
    await writeExpressionCell(tx, recordId, ef.id, result, userId);
  }
}

// Backfill an expression field for every record of a table (field created or
// its options changed). Bounded by the <100k-row design target (ADR-0001).
export async function backfillExpressionField(
  tx: DbTx,
  tableId: string,
  expressionFieldId: string,
  expression: string,
  userId: string,
): Promise<void> {
  const records = await tx
    .select({ id: record.id })
    .from(record)
    .where(eq(record.tableId, tableId));
  for (const r of records) {
    const currentCells = await tx.select().from(cell).where(eq(cell.recordId, r.id));
    const values = new Map(currentCells.map((c) => [c.fieldId, c.value]));
    const result = evaluateExpression(expression, values);
    await writeExpressionCell(tx, r.id, expressionFieldId, result, userId);
  }
}
