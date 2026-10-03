import { randomUUID } from 'node:crypto';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { FieldType, type CellValue, type FieldOptions } from '@/lib/field-types';
import { normalizeCellValue } from '@/server/plugins/field-value';
import { fieldTypeRegistry } from '@/server/plugins';
import { materializeExpressionsForRecord } from '@/server/expression';
import { cell, cellHistory, field, record, table, attachment } from '../../db/schema';
import { db } from '../../db';
import { mapBusyToConflict } from '../../db/pg-errors';
import { publishTableChange } from '../../realtime/publish';
import { assertTableRole } from '@/lib/roles';
import { protectedProcedure, router } from '../init';

// Unbounded JSONB payloads are a cheap DoS vector — cap the serialized size.
const MAX_CELL_VALUE_BYTES = 256 * 1024;

// LWW conflict signal window: overwriting a value another user wrote within
// this window is flagged so the UI can warn about the lost update.
const RECENT_EDIT_MS = 60_000;

// Phase-2 value validation (DB-backed, ADR-0005 decision 5 prevention):
// normalizeCellValue is pure and cannot check existence — link values
// must reference real records of the target table, resolved in one
// batched query. Runs against either the pool or the caller's transaction:
// once pre-transaction as a fast fail, and again inside the transaction
// after the advisory lock, where the verdict is authoritative — a referenced
// record can be deleted between the two runs (TOCTOU), and only the in-lock
// re-check closes that window. The re-check reads FOR SHARE: a plain SELECT
// conflicts with no row lock, so a delete that commits between the re-check
// and this transaction's commit leaves our just-written link silently dead —
// every cleaner's snapshot predates our commit. FOR SHARE makes the delete's
// DELETE/cascade block until we commit, so any cleanup reading past that
// serialization point (table.delete's post-commit sweep, a record.delete
// whose probe scan reads after our commit) observes the dead id and strips
// it. On the pool pass the lock dies with the autocommit statement — the
// clause is inert there, so both callers share this one query.
async function assertCellValueReferable(
  executor: Pick<typeof db, 'select'>,
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
      // Byte length, not string length: .length counts UTF-16 code units and
      // undercounts multibyte payloads by up to 3-4x against the wire size.
      const serialized = JSON.stringify(input.value) ?? '';
      if (Buffer.byteLength(serialized, 'utf8') > MAX_CELL_VALUE_BYTES) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cell value too large (limit ${MAX_CELL_VALUE_BYTES / 1024}KB serialized)`,
        });
      }

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

      // Fast-fail pass — see assertCellValueReferable for the authoritative
      // re-check inside the transaction.
      if (!('empty' in normalized)) {
        await assertCellValueReferable(db, fld, normalized.value);
      }

      const result = await mapBusyToConflict(
        db.transaction(async (tx) => {
          // Serialize writers on this (record, field) pair for the whole
          // transaction. Without it, two select-then-insert writers race: the
          // loser's onConflictDoUpdate lands on the winner's row while its
          // cell_history row hangs off a fabricated id (orphan) with a stale
          // oldValue. The lock makes the read-modify-write below atomic; the
          // unique (record_id, field_id) index still backstops the insert.
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${input.recordId} || ':' || ${input.fieldId}))`,
          );

          // Take the record's row lock FIRST, before touching any cell row. This
          // transaction and record.delete lock the same pair in opposite orders:
          // record.delete's FOR UPDATE scan locks cell rows and only reaches the
          // record row at its DELETE (whose cascade also locks this record's
          // cells) — if we lock our cell first and the record last, the two
          // form an AB-BA deadlock. Locking the record up front (value-neutral:
          // only updatedAt moves) makes record-then-cells the order on this
          // pair for both sides — the delete's cascade reaches our cell only
          // after its DELETE took the record row — so the two can no longer
          // wait on each other.
          const touched = await tx
            .update(record)
            .set({ updatedAt: sql`now()` })
            .where(eq(record.id, input.recordId))
            // returning updatedAt — just written as now() by this very
            // statement — hands the transaction a DB-clock reference for
            // free; recentOverwriteBy below measures its 60s window against
            // it so both ends of the comparison sit on one clock.
            .returning({ id: record.id, dbNow: record.updatedAt });
          // 0 rows = the record was deleted between the pre-transaction check
          // and this lock — without this guard the FK on the cell write below
          // would surface as a raw 500 instead of NOT_FOUND.
          if (touched.length === 0) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found' });
          }
          const dbNow = touched[0]?.dbNow;

          // Authoritative existence re-check, under the lock: referenced records
          // deleted since the pre-transaction pass must still be rejected here.
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
            if (!recent?.changedBy || recent.changedBy === ctx.session.user.id) return null;
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
                changedBy: ctx.session.user.id,
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
                changedBy: ctx.session.user.id,
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
                  changedBy: ctx.session.user.id,
                });
              }
            }
          }

          // Recompute dependent expression fields (same record, same
          // transaction, Q2). Signature: (tx, tableId, recordId, userId,
          // changedFieldId) — the previous call passed fieldId and userId in
          // each other's positions, so the dependsOn filter compared a user
          // id against field ids and NEVER matched: dependent expressions
          // were silently not recomputed on any cell edit.
          const recomputed = await materializeExpressionsForRecord(
            tx,
            fld.tableId,
            input.recordId,
            ctx.session.user.id,
            input.fieldId,
          );

          return { normalized, overwroteRecentBy, recomputed };
        }),
      );

      void publishTableChange(fld.tableId, ctx.session.user.id);
      return {
        ...result.normalized,
        overwroteRecentBy: result.overwroteRecentBy,
        // Dependent expression cells recalculated in the same transaction.
        // The editing session's ws broadcast excludes itself, so without
        // these the client would keep showing stale expression values until
        // some unrelated refetch.
        recomputed: result.recomputed,
      };
    }),
});
