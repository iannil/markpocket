import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { FieldType, type CellValue, type FieldOptions } from '@/lib/field-types';
import type { NormalizedCell } from '@markpocket/plugin-sdk';
import { normalizeCellValue } from '@/server/plugins/field-value';
import { fieldTypeRegistry } from '@/server/plugins';
import {
  materializeExpressionsForRecord,
  type DbTx,
  type RecomputedCell,
} from '@/server/expression';
import { cell, cellHistory, field, record, table, attachment } from '../db/schema';

const RECENT_EDIT_MS = 60_000;

// FOR SHARE keeps validated references alive until the caller commits, allowing
// concurrent deletion cleanup to observe the committed link afterwards.
async function assertCellValueReferable(
  executor: DbTx,
  fld: typeof field.$inferSelect,
  value: CellValue,
): Promise<void> {
  const contribution = fieldTypeRegistry.tryGet(fld.type);
  if (!contribution?.validateCellValue) return;
  const error = await contribution.validateCellValue(fld.options as FieldOptions, value, {
    existingRecordIds: async (ids, tableId) => {
      if (ids.length === 0) return new Set<string>();
      const rows = await executor
        .select({ id: record.id })
        .from(record)
        .where(and(eq(record.tableId, tableId), inArray(record.id, ids)))
        .for('share');
      return new Set(rows.map((r) => r.id));
    },
    // Attachment counterpart (L-2): resolve the field's OWN base from its table,
    // then keep only ids that exist as attachments of that base. Same FOR SHARE
    // discipline as the record resolver — a concurrent attachment delete (table
    // teardown, base deletion) blocks until this transaction commits, so the
    // cleaner's sweep can observe and strip the id instead of leaving a dead
    // reference behind the commit. A missing table/base row resolves every id
    // as missing: the write is refused, which is the safe verdict for a field
    // whose base is gone.
    existingAttachmentIds: async (ids) => {
      if (ids.length === 0) return new Set<string>();
      const [tbl] = await executor
        .select({ baseId: table.baseId })
        .from(table)
        .where(eq(table.id, fld.tableId))
        .limit(1);
      if (!tbl?.baseId) return new Set<string>();
      const rows = await executor
        .select({ id: attachment.id })
        .from(attachment)
        .where(and(eq(attachment.baseId, tbl.baseId), inArray(attachment.id, ids)))
        .for('share');
      return new Set(rows.map((r) => r.id));
    },
  });
  if (error) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: error });
  }
}

export async function writeCellInTransaction(
  tx: DbTx,
  input: {
    recordId: string;
    fieldId: string;
    value: unknown;
    actorId: string | null;
    recompute?: boolean;
  },
): Promise<{
  normalized: Exclude<NormalizedCell, { error: string }>;
  overwroteRecentBy: { userId: string } | null;
  recomputed: RecomputedCell[];
}> {
  const [fld] = await tx.select().from(field).where(eq(field.id, input.fieldId)).limit(1);
  if (!fld) throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' });
  if (fld.type === FieldType.Expression)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Expression fields are read-only' });
  const [rec] = await tx
    .select({ tableId: record.tableId })
    .from(record)
    .where(eq(record.id, input.recordId))
    .limit(1);
  if (!rec || rec.tableId !== fld.tableId)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found in this table' });
  const normalized = normalizeCellValue(
    fld.type as FieldType,
    fld.options as FieldOptions,
    input.value,
  );
  if ('error' in normalized)
    throw new TRPCError({ code: 'BAD_REQUEST', message: normalized.error });
  // Lock the record before its cell advisory key. Batch callers prelock
  // records, so reversing these two locks would introduce an AB-BA cycle.
  const touched = await tx
    .update(record)
    .set({ updatedAt: sql`now()` })
    .where(eq(record.id, input.recordId))
    // returning updatedAt — just written as now() by this very
    // statement — hands the transaction a DB-clock reference for
    // free; recentOverwriteBy below measures its 60s window against
    // it so both ends of the comparison sit on one clock.
    .returning({ id: record.id, dbNow: record.updatedAt });
  // 0 rows = the record was deleted between the ownership check
  // and this lock — without this guard the FK on the cell write below
  // would surface as a raw 500 instead of NOT_FOUND.
  if (touched.length === 0) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found' });
  }
  const dbNow = touched[0]?.dbNow;

  // Serialize writers on this (record, field) pair for the whole
  // transaction. Without it, two select-then-insert writers race: the
  // loser's onConflictDoUpdate lands on the winner's row while its
  // cell_history row hangs off a fabricated id (orphan) with a stale
  // oldValue. The lock makes the read-modify-write below atomic; the
  // unique (record_id, field_id) index still backstops the insert.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${input.recordId} || ':' || ${input.fieldId}))`,
  );

  // Validate references under the lock; FOR SHARE holds them until commit.
  if (!('empty' in normalized)) {
    await assertCellValueReferable(tx, fld, normalized.value);
  }

  const [existing] = await tx
    .select()
    .from(cell)
    .where(and(eq(cell.recordId, input.recordId), eq(cell.fieldId, input.fieldId)))
    .limit(1);

  // Latest change by someone else within the window, read before we
  // append our own history row.
  const recentOverwriteBy = async (cellId: string): Promise<string | null> => {
    const [recent] = await tx
      .select({ changedBy: cellHistory.changedBy, changedAt: cellHistory.changedAt })
      .from(cellHistory)
      .where(eq(cellHistory.cellId, cellId))
      .orderBy(desc(cellHistory.changedAt))
      .limit(1);
    if (!recent?.changedBy || recent.changedBy === input.actorId) return null;
    // changedAt was written by the database, so the window must be
    // measured against the DB's now() captured above — mixing in
    // Date.now() shifts the 60s window by whatever the app/DB clock
    // skew is. The app-clock fallback only covers executors that
    // don't return the column (mocked tests).
    const nowMs = dbNow instanceof Date ? dbNow.getTime() : Date.now();
    const age = nowMs - new Date(recent.changedAt).getTime();
    return Number.isFinite(age) && age < RECENT_EDIT_MS ? recent.changedBy : null;
  };

  let overwroteRecentBy: { userId: string } | null = null;

  if ('empty' in normalized) {
    if (existing) {
      const recentUserId = await recentOverwriteBy(existing.id);
      overwroteRecentBy = recentUserId ? { userId: recentUserId } : null;
      await tx.insert(cellHistory).values({
        id: randomUUID(),
        cellId: existing.id,
        oldValue: existing.value,
        newValue: null,
        changedBy: input.actorId,
      });
      await tx
        .delete(cell)
        .where(and(eq(cell.recordId, input.recordId), eq(cell.fieldId, input.fieldId)));
    }
  } else {
    const newValue = normalized.value;
    if (existing) {
      const recentUserId = await recentOverwriteBy(existing.id);
      overwroteRecentBy = recentUserId ? { userId: recentUserId } : null;
      await tx
        .update(cell)
        .set({ value: newValue, updatedAt: sql`now()` })
        .where(eq(cell.id, existing.id));
      await tx.insert(cellHistory).values({
        id: randomUUID(),
        cellId: existing.id,
        oldValue: existing.value,
        newValue,
        changedBy: input.actorId,
      });
    } else {
      // returning id guarantees the history row hangs on the real cell
      // row even if a non-cooperating writer created it concurrently.
      const [row] = await tx
        .insert(cell)
        .values({
          id: randomUUID(),
          recordId: input.recordId,
          fieldId: input.fieldId,
          value: newValue,
        })
        .onConflictDoUpdate({
          target: [cell.recordId, cell.fieldId],
          set: { value: newValue, updatedAt: sql`now()` },
        })
        .returning({ id: cell.id });
      const cellId = row?.id ?? null;
      if (cellId) {
        const recentUserId = await recentOverwriteBy(cellId);
        overwroteRecentBy = recentUserId ? { userId: recentUserId } : null;
        await tx.insert(cellHistory).values({
          id: randomUUID(),
          cellId,
          oldValue: null,
          newValue,
          changedBy: input.actorId,
        });
      }
    }
  }

  // Batch callers defer materialization until the last cell of this record.
  // Default callers receive the dependent results for their local cache.
  const recomputed =
    input.recompute === false
      ? []
      : await materializeExpressionsForRecord(
          tx,
          fld.tableId,
          input.recordId,
          input.actorId,
          input.fieldId,
        );

  return { normalized, overwroteRecentBy, recomputed };
}
