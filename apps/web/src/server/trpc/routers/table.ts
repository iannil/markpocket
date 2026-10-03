import { randomUUID } from 'node:crypto';

import { and, eq, ne, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { FieldType } from '@/lib/field-types';
import { cellHistory, field, record, table, view } from '../../db/schema';
import { db } from '../../db';
import { mapBusyToConflict } from '../../db/pg-errors';
import { publishBaseChange } from '../../realtime/publish';
import { getStorage } from '@/server/plugins';
import { assertRole, baseIdFromTable } from '@/lib/roles';
import { protectedProcedure, router } from '../init';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Dead-id probe batch size — keeps the OR-chain of `value @>` predicates
// (GIN-indexed, the same operator record.delete uses) bounded per statement.
const DEAD_ID_BATCH = 500;
// Hit cells rewritten per cleanup transaction — bounds both the statement count
// and the row-lock window of any single commit.
const REWRITE_BATCH = 500;
// Post-delete sweep passes — see the window-(a) note on table.delete.
const POST_DELETE_SWEEP_ROUNDS = 3;

// ADR-0005 decision 5, applied to table.delete: before the FK cascade runs,
// strip ids of the vanishing records from surviving link cells of the same base
// and append a cell_history row per touched cell — the identical contract
// record.delete keeps. Emptying a cell counts as a change (new null).
// Cross-base links are rejected at field validation, so the base-scoped scan is
// exhaustive.
//
// Chunked commits, not one big transaction: at the <100k-reference scale
// (ADR-0001) a single transaction would run 200k+ statements while holding row
// locks for minutes. Each chunk commits on its own, so an interrupted run
// leaves the table intact and the whole delete safely retryable — the
// `value @>` probe no longer matches cells whose dead ids were already
// stripped, making every chunk idempotent.
//
// The probe locks the hit cell rows (`FOR UPDATE OF c`): read-filter-write is
// otherwise a lost-update race between two concurrent cleaners (table.delete
// vs record.delete, or two deletes of overlapping tables) — both read
// [r1, rkeep], one writes [rkeep], the other writes [r1], and the later commit
// resurrects a dead id. Under READ COMMITTED the row lock makes the loser wait
// and re-read the winner's committed value, so the removals compose. Locking
// `c` only (not the joined field/table rows) keeps the lock surface to the
// rows actually being rewritten. Returns the number of cells rewritten, so the
// post-delete sweep in table.delete can tell "clean" from "someone reintroduced
// dead refs mid-flight".
async function clearDanglingRecordRefs(
  baseId: string,
  recordIds: string[],
  userId: string,
  opts: { excludeTableId?: string } = {},
): Promise<number> {
  if (recordIds.length === 0) return 0;
  const dead = new Set(recordIds);
  let totalHits = 0;
  for (let i = 0; i < recordIds.length; i += DEAD_ID_BATCH) {
    const batch = recordIds.slice(i, i + DEAD_ID_BATCH);
    const anyDead = sql.join(
      batch.map((id) => sql`c.value @> ${JSON.stringify([id])}::jsonb`),
      sql` OR `,
    );
    for (;;) {
      const hit = await mapBusyToConflict(
        db.transaction(async (tx) => {
          const linked = (await tx.execute(sql`
          SELECT c.id, c.value FROM cell c
          JOIN field f ON f.id = c.field_id
          JOIN "table" t ON t.id = f.table_id
          WHERE t.base_id = ${baseId}
          ${opts.excludeTableId ? sql`AND t.id <> ${opts.excludeTableId}` : sql``}
          AND (${anyDead})
          LIMIT ${REWRITE_BATCH}
          FOR UPDATE OF c
        `)) as unknown as Array<{ id: string; value: unknown }>;
          for (const row of linked) {
            const arr = Array.isArray(row.value) ? row.value : [];
            const next = arr.filter((v: unknown) => !dead.has(v as string));
            await tx.insert(cellHistory).values({
              id: randomUUID(),
              cellId: row.id,
              oldValue: row.value,
              newValue: next.length > 0 ? next : null,
              changedBy: userId,
            });
            if (next.length === 0) {
              await tx.execute(sql`DELETE FROM cell WHERE id = ${row.id}`);
            } else {
              await tx.execute(
                sql`UPDATE cell SET value = ${JSON.stringify(next)}::jsonb, updated_at = now() WHERE id = ${row.id}`,
              );
            }
          }
          totalHits += linked.length;
          return linked.length;
        }),
      );
      // A full batch means more hit cells may remain for this dead-id set;
      // rewritten cells drop out of the probe on the next scan.
      if (hit < REWRITE_BATCH) break;
    }
  }
  return totalHits;
}

// Attachment ids held by the table's attachment cells — must run before the
// table delete cascades those cells away.
async function collectTableAttachmentIds(tx: Tx, tableId: string): Promise<string[]> {
  const rows = await tx.execute(sql`
    SELECT c.value FROM cell c
    JOIN field f ON f.id = c.field_id
    WHERE f.table_id = ${tableId} AND f.type = 'attachment'
  `);
  const ids: string[] = [];
  for (const row of rows as unknown as Array<{ value: unknown }>) {
    if (Array.isArray(row.value)) ids.push(...row.value.map(String));
  }
  return [...new Set(ids)];
}

// Remove attachment rows whose last referencing cell just cascaded away.
// A row survives when any cell in any table still holds its id — attachments
// are base-scoped, not table-scoped, and can be referenced across tables.
// Returns the storage keys whose physical files should be unlinked post-commit.
async function deleteUnreferencedAttachments(tx: Tx, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const keys: string[] = [];
  // One statement per DEAD_ID_BATCH ids: Postgres caps bind parameters per
  // statement at 65,535, so a single IN (...) over a large table's attachment
  // ids would fail at the protocol layer, inside the delete transaction.
  for (let i = 0; i < ids.length; i += DEAD_ID_BATCH) {
    const batch = ids.slice(i, i + DEAD_ID_BATCH);
    const rows = await tx.execute(sql`
      DELETE FROM attachment
      WHERE id IN (${sql.join(
        batch.map((id) => sql`${id}`),
        sql`, `,
      )})
        AND NOT EXISTS (
          SELECT 1 FROM cell c WHERE c.value @> to_jsonb(ARRAY[attachment.id])
        )
      RETURNING storage_key
    `);
    keys.push(...(rows as unknown as Array<{ storage_key: string }>).map((r) => r.storage_key));
  }
  return keys;
}

// Best-effort physical file removal: DB rows are already deleted at this point,
// so a stuck file must never fail (or retry-block) the delete. Shared with
// base.delete via export.
export async function removeAttachmentFiles(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const storage = getStorage();
  await Promise.all(
    keys.map(async (key) => {
      try {
        await storage.remove(key);
      } catch (err) {
        console.error(`attachment file removal failed: ${key}`, err);
      }
    }),
  );
}

// Surviving link fields pointing at `tableId` would outlive the table as
// broken definitions: every later write to them fails with a misleading
// "Unknown record id" (their target is gone). Runs against either the pool
// (fast-fail pass) or the final delete transaction (authoritative pass).
async function findLinkReferrers(
  executor: Pick<typeof db, 'select'>,
  baseId: string,
  tableId: string,
): Promise<string[]> {
  const referrers = await executor
    .select({ name: field.name, options: field.options, tableName: table.name })
    .from(field)
    .innerJoin(table, eq(field.tableId, table.id))
    .where(and(eq(table.baseId, baseId), eq(field.type, FieldType.Link), ne(table.id, tableId)));
  return referrers
    .filter((f) => (f.options as { targetTableId?: unknown } | null)?.targetTableId === tableId)
    .map((f) => `${f.tableName}.${f.name}`);
}

function assertNoLinkReferrers(referrers: string[]): void {
  if (referrers.length > 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Table is referenced by link field(s) ${referrers.join(
        ', ',
      )} — delete or re-target them first`,
    });
  }
}

export const tableRouter = router({
  list: protectedProcedure.input(z.object({ baseId: z.string() })).query(async ({ ctx, input }) => {
    await assertRole(input.baseId, ctx.session.user.id, 'viewer');
    return db.select().from(table).where(eq(table.baseId, input.baseId)).orderBy(table.orderIndex);
  }),

  // Single-table fetch for metadata/permission checks — cheaper than list()
  // when only one name is needed (page titles).
  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const baseId = await baseIdFromTable(input.id);
    if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found' });
    await assertRole(baseId, ctx.session.user.id, 'viewer');
    const [row] = await db.select().from(table).where(eq(table.id, input.id)).limit(1);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found' });
    return row;
  }),

  create: protectedProcedure
    .input(z.object({ baseId: z.string(), name: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await assertRole(input.baseId, ctx.session.user.id, 'editor');
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(table)
          .values({ id: randomUUID(), baseId: input.baseId, name: input.name })
          .returning();
        // Each new table ships with one default Grid view...
        await tx.insert(view).values({
          id: randomUUID(),
          tableId: created!.id,
          type: 'grid',
          name: 'Grid',
        });
        // ...and one default "Name" text column. Without it a fresh table is
        // a chicken-and-egg puzzle (records need fields, fields are an
        // editor-only toolbar button) — the column gives users something to
        // type into immediately (Airtable convention).
        await tx.insert(field).values({
          id: randomUUID(),
          tableId: created!.id,
          name: 'Name',
          type: 'text',
        });
        return created!;
      });
      // Publish after commit — the notify side-query must see the committed row.
      void publishBaseChange(input.baseId, ctx.session.user.id);
      return row;
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const baseId = await baseIdFromTable(input.id);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found' });
      await assertRole(baseId, ctx.session.user.id, 'editor');
      const [row] = await db
        .update(table)
        .set({ name: input.name })
        .where(eq(table.id, input.id))
        .returning();
      if (row) void publishBaseChange(row.baseId, ctx.session.user.id);
      return row;
    }),

  // table.delete is three phases — guard (outside any transaction), chunked
  // dead-ref cleanup, final delete transaction — and each seam between them
  // opens a concurrency window. The closures, one per window:
  //
  //   (a) cell.upsert passes its in-lock existence re-check while the dying
  //       records still exist, then commits a dead id into a surviving cell
  //       after the cleanup chunks already ran → the post-delete sweep below
  //       re-runs the (idempotent) cleanup after the delete commits, looping
  //       until a round finds nothing. New dead refs cannot appear after the
  //       commit (upsert's re-check now fails), so the loop converges.
  //   (b) a link field targeting this table is created between the guard and
  //       the final transaction → the same referrer guard is re-run inside
  //       the final delete transaction, and a hit rolls it back (BAD_REQUEST).
  //       The transaction also locks the dying table's row first, and
  //       field.create/updateOptions take the same FOR UPDATE lock on their
  //       link target — the two orders are "field commits, guard sees it"
  //       (rollback) and "delete commits, validation finds no target"
  //       (reject), so no sliver remains.
  //   (c) two concurrent cleaners snapshot-read the same cell, filter in JS,
  //       and blind-write over each other (lost update) → the cleanup probe
  //       locks hit rows with FOR UPDATE (see clearDanglingRecordRefs).
  // owner-only, unlike create/rename (editor): delete is irreversible, cascades
  // across tables (dead-ref cleanup rewrites other tables' link cells), and has
  // no undo — the same standard base.delete applies. There is no UI entry yet;
  // this gates the API surface.
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const baseId = await baseIdFromTable(input.id);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found' });
      await assertRole(baseId, ctx.session.user.id, 'owner');

      // Fast-fail referrer guard, naming the referrers the way field.delete
      // names dependent expressions. Runs before the chunked cleanup so a
      // rejection does no cleanup work; the authoritative re-run happens inside
      // the final delete transaction (window b above).
      assertNoLinkReferrers(await findLinkReferrers(db, baseId, input.id));

      // Dead ids to strip from surviving cells, bounded by the <100k-row design
      // target (ADR-0001). Read outside the final transaction: the cleanup
      // commits in chunks and must not extend the delete transaction's locks.
      const recordIds = (
        await db.select({ id: record.id }).from(record).where(eq(record.tableId, input.id))
      ).map((r) => r.id);
      await clearDanglingRecordRefs(baseId, recordIds, ctx.session.user.id, {
        excludeTableId: input.id,
      });

      const { orphanedKeys, finalRecordIds } = await mapBusyToConflict(
        db.transaction(async (tx) => {
          // Lock the dying table's own row FIRST. field.create/updateOptions take
          // the same FOR UPDATE lock on their link target (assertLinkTargetInBase),
          // so only two orders are possible — the link field commits first and the
          // guard below sees it (rollback), or this delete commits first and the
          // link validation finds no target (reject). No sliver remains.
          // The lock is also verified, not just taken: when a concurrent delete of
          // the same table already committed, the loser locks 0 rows and the
          // DELETE below would match 0 rows — previously it still returned
          // {ok:true} and published a phantom base change; now it fails
          // NOT_FOUND like every other missing-table path.
          const locked = await tx
            .select({ id: table.id })
            .from(table)
            .where(eq(table.id, input.id))
            .for('update');
          if (locked.length === 0) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found' });
          }
          // Window b closure: same guard, re-run under the delete transaction.
          // A referrer that appeared since the fast-fail pass rolls everything
          // back — the table survives, the already-committed cleanup chunks were
          // idempotent strip-outs, and the user retries once the field is gone.
          assertNoLinkReferrers(await findLinkReferrers(tx, baseId, input.id));
          // Fresh record-id snapshot for the post-delete sweep, re-read inside
          // this transaction: the outer `recordIds` predates the chunked cleanup,
          // so records created during that (potentially long) interval were
          // missing from its dead-id set and the sweep below would never probe
          // for links to them. The outer snapshot still serves the pre-delete
          // cleanup chunks, which must not extend this transaction's locks.
          const finalRecordIds = (
            await tx.select({ id: record.id }).from(record).where(eq(record.tableId, input.id))
          ).map((r) => r.id);
          const attachmentIds = await collectTableAttachmentIds(tx, input.id);
          // FK cascade clears fields → cells and records.
          await tx.delete(table).where(eq(table.id, input.id));
          // Attachment rows orphaned by the cascaded cells go too (row + file).
          return {
            orphanedKeys: await deleteUnreferencedAttachments(tx, attachmentIds),
            finalRecordIds,
          };
        }),
      );
      await removeAttachmentFiles(orphanedKeys);

      // Window a closure: cells that caught a dead id between the cleanup
      // chunks and the delete commit. The sweep is the same idempotent
      // cleanup; a round that rewrites nothing proves the window's writers
      // have all landed (post-commit, cell.upsert's existence re-check rejects
      // new dead ids). The round cap is livelock insurance: failing open keeps
      // the committed delete from erroring on a pathologically slow writer,
      // at the cost of a log line for an manual re-clean.
      for (let round = 0; round < POST_DELETE_SWEEP_ROUNDS; round++) {
        const hits = await clearDanglingRecordRefs(baseId, finalRecordIds, ctx.session.user.id);
        if (hits === 0) break;
        if (round === POST_DELETE_SWEEP_ROUNDS - 1) {
          console.error(
            `table.delete post-delete sweep still finding dangling refs after ${POST_DELETE_SWEEP_ROUNDS} rounds (base ${baseId}, table ${input.id})`,
          );
        }
      }

      void publishBaseChange(baseId, ctx.session.user.id);
      return { ok: true };
    }),
});
