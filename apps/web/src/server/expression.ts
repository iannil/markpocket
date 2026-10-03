import { randomUUID } from 'node:crypto';

import { and, eq, gt, sql } from 'drizzle-orm';

import { FieldType, type FieldOptions } from '@/lib/field-types';
import { evaluateExpression } from '@/lib/expression-eval';
import { cell, cellHistory, field, record } from './db/schema';
import { db } from './db';

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The materialized outcome of one expression field: the value the cell ended
// up with, or null when the cell row was deleted (empty result). Returned to
// callers so they can forward it to the client, which patches its local cache
// — the ws broadcast of the same write excludes the editing session, so
// without this the client's expression columns show stale values.
export interface RecomputedCell {
  fieldId: string;
  value: unknown;
}

// Write one expression cell for `recordId` following ADR-0005: value → store
// JSONB, error → { __error } sentinel, empty → no row. Appends cell_history.
async function writeExpressionCell(
  tx: DbTx,
  recordId: string,
  expressionFieldId: string,
  result: ReturnType<typeof evaluateExpression>,
  userId: string,
): Promise<RecomputedCell> {
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
    return { fieldId: expressionFieldId, value: null };
  }

  const value = 'error' in result ? { __error: result.error } : result.value;
  if (existing) {
    // SQL now() keeps updated_at monotonic with the statement, not the JS clock.
    await tx
      .update(cell)
      .set({ value, updatedAt: sql`now()` })
      .where(eq(cell.id, existing.id));
    await tx.insert(cellHistory).values({
      id: randomUUID(),
      cellId: existing.id,
      oldValue: existing.value,
      newValue: value,
      changedBy: userId,
    });
  } else {
    const newId = randomUUID();
    // Upsert, not a bare insert: two editors changing different source fields
    // of the same record hold different advisory locks, so both
    // materializations can select-then-insert this same (record, expression
    // field) cell — a bare insert makes the loser fail on the unique index
    // (23505) and surface a 500. Returning the row's id keeps cell_history
    // attached to the surviving cell when the conflict path fires.
    const [row] = await tx
      .insert(cell)
      .values({ id: newId, recordId, fieldId: expressionFieldId, value })
      .onConflictDoUpdate({
        target: [cell.recordId, cell.fieldId],
        set: { value, updatedAt: sql`now()` },
      })
      .returning({ id: cell.id });
    await tx.insert(cellHistory).values({
      id: randomUUID(),
      cellId: row?.id ?? newId,
      // Known audit-trail imprecision on the conflict path: when a concurrent
      // materialization won the insert race, the surviving cell already holds
      // the winner's value, but this history row logs oldValue: null rather
      // than that value — reading it back here would need a second query that
      // can itself race. The cell's final value is still correct under the
      // last-writer-wins semantics materialization already adopts, so the
      // cheaper, occasionally understated oldValue is accepted.
      oldValue: null,
      newValue: value,
      changedBy: userId,
    });
  }
  return { fieldId: expressionFieldId, value };
}

// Recompute expression cells for one record (ADR-0003 Q2). When `changedFieldId`
// is given, only expression fields depending on it are recomputed; otherwise all
// expression fields of the table are (used by record.create). Returns the
// materialized outcomes so callers can surface them to the client.
export async function materializeExpressionsForRecord(
  tx: DbTx,
  tableId: string,
  recordId: string,
  userId: string,
  changedFieldId?: string,
): Promise<RecomputedCell[]> {
  const exprFields = await tx
    .select()
    .from(field)
    .where(and(eq(field.tableId, tableId), eq(field.type, FieldType.Expression)))
    // Deterministic field order = deterministic cell-lock order: two editors
    // writing different source fields of one record hold different advisory
    // locks, so their materializations run concurrently and write these
    // fields' cells in loop order — unordered reads could hand them opposite
    // orders and an AB-BA deadlock on the expression cell rows.
    .orderBy(field.id);

  // One fetch of the record's current cells, shared by every dependent field.
  const currentCells = await tx.select().from(cell).where(eq(cell.recordId, recordId));
  const values = new Map(currentCells.map((c) => [c.fieldId, c.value]));

  const recomputed: RecomputedCell[] = [];
  for (const ef of exprFields) {
    const opts = (ef.options ?? {}) as { expression?: string; dependsOn?: string[] } & FieldOptions;
    if (changedFieldId && !opts.dependsOn?.includes(changedFieldId)) continue;
    const result = evaluateExpression(opts.expression ?? '', values);
    recomputed.push(await writeExpressionCell(tx, recordId, ef.id, result, userId));
  }
  return recomputed;
}

// Backfill an expression field for every record of a table (field created or
// its options changed). Bounded by the <100k-row design target (ADR-0001).
// Commits in batches so a single backfill can't balloon one transaction into
// hundreds of thousands of statements — a mid-way failure leaves already
// committed batches materialized (the field definition itself was committed
// separately by the caller before invoking this).
const BACKFILL_BATCH = 500;

export async function backfillExpressionField(
  tableId: string,
  expressionFieldId: string,
  expression: string,
  userId: string,
): Promise<void> {
  // Keyset pagination on id — stable while the table receives concurrent writes.
  let lastId = '';
  for (;;) {
    let exhausted = false;
    await db.transaction(async (tx) => {
      const batch = await tx
        .select({ id: record.id })
        .from(record)
        .where(and(eq(record.tableId, tableId), gt(record.id, lastId)))
        .orderBy(record.id)
        .limit(BACKFILL_BATCH);
      exhausted = batch.length < BACKFILL_BATCH;
      if (batch.length === 0) return;
      for (const r of batch) {
        // Lock the record's row BEFORE reading its cells. Without this lock the
        // backfill races cell.upsert: it snapshots a record's cells, a
        // concurrent upsert commits a new source value (and materializes the
        // new expression value from it), then the backfill writes the value it
        // computed off the pre-upsert snapshot — LWW hands the stale value the
        // last write, and nothing ever recomputes the field again, so the
        // wrong value survives until the record's next edit.
        //
        // Why the record row lock and not the advisory lock cell.upsert takes:
        // that lock's key is recordId:fieldId of the *written* field, and the
        // fields whose upserts invalidate this expression are its source
        // fields — an arbitrary, user-chosen set the backfill cannot enumerate
        // (taking only this field's own key would serialize against writes to
        // the expression cell, not against the source-field writes that make
        // the snapshot stale). The record row lock is the one chokepoint every
        // cell.upsert passes before touching any cell of the record (its own
        // lock order is advisory → record row → cells), so locking it
        // serializes the backfill against all of them at once:
        //   - backfill locks first → the upsert blocks at its record-row
        //     UPDATE until the batch commits, then writes the new source value
        //     and its materializeExpressionsForRecord recomputes on top of the
        //     backfill's value — fresh value survives;
        //   - upsert locks first → the lock below waits for its commit, and
        //     the cell read that follows takes a fresh READ COMMITTED
        //     statement snapshot — the backfill computes from the new value.
        // Either interleaving lands on the correct final value.
        //
        // No new deadlock: on any single record every writer now takes
        // record-row → cell-rows in that order (cell.upsert: advisory →
        // record → cells; record.delete: record → referencing cells; this
        // loop: record → cells), and the backfill never holds a cell-row lock
        // before acquiring a record-row lock. Records are locked one at a
        // time, in the batch's ORDER BY record.id sequence, so two concurrent
        // backfills over the same table acquire records in the same ascending
        // order and simply serialize — a single multi-row IN-list UPDATE
        // would leave the acquisition order to the scan plan instead, and is
        // deliberately avoided. The UPDATE is value-neutral (only updated_at
        // moves, mirroring cell.upsert's own bump) but returns the locked id:
        // 0 rows means the record was deleted between pagination and the
        // lock — its cells cascaded away with it, so there is nothing to
        // materialize and the FK on the cell write below would otherwise
        // fail the whole batch.
        const locked = await tx
          .update(record)
          .set({ updatedAt: sql`now()` })
          .where(eq(record.id, r.id))
          .returning({ id: record.id });
        if (locked.length === 0) continue;
        const currentCells = await tx.select().from(cell).where(eq(cell.recordId, r.id));
        const values = new Map(currentCells.map((c) => [c.fieldId, c.value]));
        const result = evaluateExpression(expression, values);
        await writeExpressionCell(tx, r.id, expressionFieldId, result, userId);
      }
      lastId = batch[batch.length - 1]!.id;
    });
    if (exhausted) return;
  }
}
