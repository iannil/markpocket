import { createHash, randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assertTableRole } from '@/lib/roles';
import { materializeExpressionsForRecord, type DbTx } from '@/server/expression';
import { db } from '../db';
import { mapBusyToConflict } from '../db/pg-errors';
import { field, record, table, writeReceipt } from '../db/schema';
import { publishTableChange } from '../realtime/publish';
import { writeCellInTransaction } from './write-cell';

export const batchInputSchema = z
  .object({
    tableId: z.string().min(1),
    requestId: z.string().uuid(),
    rows: z
      .array(
        z.object({
          recordId: z.string().min(1).optional(),
          cells: z.record(z.string(), z.unknown()),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((v, ctx) => {
    try {
      const values = v.rows.flatMap((r) => Object.values(r.cells));
      const ids = v.rows.flatMap((r) => (r.recordId ? [r.recordId] : []));
      if (
        values.length > 500 ||
        Buffer.byteLength(JSON.stringify(v), 'utf8') > 1048576 ||
        values.some((value) => Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') > 262144)
      )
        ctx.addIssue({ code: 'custom', message: 'Paste exceeds the batch limit' });
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate record IDs' });
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Cells must be JSON serializable' });
    }
  });
export type BatchInput = z.infer<typeof batchInputSchema>;
export type BatchResult = { recordIds: string[]; created: number; updated: number };

export async function writeBatchInTransaction(
  tx: DbTx,
  actor: { key: string; userId: string | null },
  input: BatchInput,
): Promise<BatchResult> {
  const parsed = batchInputSchema.safeParse(input);
  if (!parsed.success)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: parsed.error.issues[0]?.message ?? 'Invalid batch',
    });
  input = parsed.data;
  await tx.execute(sql`select set_config('statement_timeout','30000',true)`);
  const bodyHash = createHash('sha256')
    .update(
      JSON.stringify({
        tableId: input.tableId,
        rows: input.rows.map((row) => ({
          recordId: row.recordId,
          cells: Object.fromEntries(
            Object.entries(row.cells).sort(([a], [b]) => a.localeCompare(b)),
          ),
        })),
      }),
    )
    .digest('hex');
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`write-receipt:${actor.key}:${input.requestId}`}))`,
  );
  // Bounded actor-local cleanup never removes receipts inside the seven-day window.
  await tx.execute(
    sql`with expired as materialized (select actor_key, request_id from write_receipt where actor_key = ${actor.key} and created_at < now() - interval '7 days' order by created_at limit 100 for update skip locked) delete from write_receipt r using expired e where r.actor_key = e.actor_key and r.request_id = e.request_id`,
  );
  const [receipt] = await tx
    .select()
    .from(writeReceipt)
    .where(and(eq(writeReceipt.actorKey, actor.key), eq(writeReceipt.requestId, input.requestId)));
  if (receipt) {
    if (receipt.bodyHash !== bodyHash)
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Request ID already used for a different batch',
      });
    return receipt.result as BatchResult;
  }
  const [tbl] = await tx
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, input.tableId))
    .for('share');
  if (!tbl) throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found' });
  const ids = input.rows.flatMap((r) => (r.recordId ? [r.recordId] : [])).sort();
  if (ids.length) {
    const existing = await tx
      .select({ id: record.id })
      .from(record)
      .where(and(eq(record.tableId, input.tableId), inArray(record.id, ids)))
      .orderBy(record.id)
      .for('update');
    if (existing.length !== ids.length)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found in this table' });
  }
  const fieldIds = [...new Set(input.rows.flatMap((r) => Object.keys(r.cells)))];
  if (fieldIds.length) {
    const fields = await tx
      .select({ id: field.id })
      .from(field)
      .where(and(eq(field.tableId, input.tableId), inArray(field.id, fieldIds)))
      .orderBy(field.id)
      .for('share');
    if (fields.length !== fieldIds.length)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found in this table' });
  }
  const result: BatchResult = { recordIds: [], created: 0, updated: 0 };
  for (const row of input.rows) {
    const id = row.recordId ?? randomUUID();
    if (!row.recordId) {
      await tx.insert(record).values({ id, tableId: input.tableId, createdBy: actor.userId });
      result.created++;
    } else result.updated++;
    for (const fieldId of Object.keys(row.cells).sort())
      await writeCellInTransaction(tx, {
        recordId: id,
        fieldId,
        value: row.cells[fieldId],
        actorId: actor.userId,
        recompute: false,
      });
    await materializeExpressionsForRecord(tx, input.tableId, id, actor.userId);
    result.recordIds.push(id);
  }
  await tx
    .insert(writeReceipt)
    .values({ actorKey: actor.key, requestId: input.requestId, bodyHash, result });
  return result;
}

export async function writeBatch(userId: string, input: BatchInput): Promise<BatchResult> {
  await assertTableRole(input.tableId, userId, 'editor');
  const result = await mapBusyToConflict(
    db.transaction((tx) => writeBatchInTransaction(tx, { key: `user:${userId}`, userId }, input)),
  );
  void publishTableChange(input.tableId, userId);
  return result;
}
