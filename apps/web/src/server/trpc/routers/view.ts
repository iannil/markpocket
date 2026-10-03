import { randomUUID } from 'node:crypto';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { baseShare, field, view } from '../../db/schema';
import { db } from '../../db';
import { mapBusyToConflict } from '../../db/pg-errors';
import { publishTableChange } from '../../realtime/publish';
import { assertRole, baseIdFromTable, assertTableRole } from '@/lib/roles';
import {
  VIEW_TYPES,
  collectReferencedFieldIds,
  viewOptionsSchema,
  type ViewOptions,
} from '@/lib/view-ast';
import { protectedProcedure, router } from '../init';

// Field-liveness gate for view option configs (review N4). Returns the
// referenced fieldIds that do NOT exist in the table (empty = safe to
// persist/share). Runs on `tx` inside updateOptions' lock-protected
// transaction — READ COMMITTED takes a fresh snapshot per statement, so a
// check issued after acquiring the lock observes the post-field.delete state —
// and on plain db for share.create's defense-in-depth re-check.
export async function findDeadFieldReferences(
  tableId: string,
  options: ViewOptions,
  executor: Pick<typeof db, 'select'> = db,
): Promise<string[]> {
  const referenced = collectReferencedFieldIds(options);
  if (referenced.size === 0) return [];
  const rows = await executor
    .select({ id: field.id })
    .from(field)
    .where(and(eq(field.tableId, tableId), inArray(field.id, [...referenced])));
  const alive = new Set(rows.map((row) => row.id));
  return [...referenced].filter((id) => !alive.has(id));
}

export const viewRouter = router({
  list: protectedProcedure
    .input(z.object({ tableId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTableRole(input.tableId, ctx.session.user.id, 'viewer');
      return db
        .select()
        .from(view)
        .where(eq(view.tableId, input.tableId))
        .orderBy(asc(view.orderIndex));
    }),

  create: protectedProcedure
    .input(
      z.object({
        tableId: z.string(),
        name: z.string().trim().min(1).max(64),
        type: z.enum(VIEW_TYPES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const baseId = await baseIdFromTable(input.tableId);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      await assertRole(baseId, ctx.session.user.id, 'editor');
      const [row] = await db
        .insert(view)
        .values({
          id: randomUUID(),
          tableId: input.tableId,
          type: input.type ?? 'grid',
          name: input.name,
        })
        .returning();
      void publishTableChange(input.tableId, ctx.session.user.id);
      return row;
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(view).where(eq(view.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'View not found' });
      const baseId = await baseIdFromTable(existing.tableId);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      await assertRole(baseId, ctx.session.user.id, 'editor');
      const [row] = await db
        .update(view)
        .set({ name: input.name })
        .where(eq(view.id, input.id))
        .returning();
      if (row) void publishTableChange(row.tableId, ctx.session.user.id);
      return row;
    }),

  updateOptions: protectedProcedure
    .input(z.object({ id: z.string(), options: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      // Structural + size validation at the mutation boundary (DoS guard):
      // operator whitelist, nesting depth, node counts, serialized size.
      const parsed = viewOptionsSchema.safeParse(input.options);
      if (!parsed.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid view options: ${parsed.error.issues[0]?.message ?? 'invalid structure'}`,
        });
      }
      const [existing] = await db.select().from(view).where(eq(view.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'View not found' });
      const baseId = await baseIdFromTable(existing.tableId);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      await assertRole(baseId, ctx.session.user.id, 'editor');
      const row = await mapBusyToConflict(
        db.transaction(async (tx) => {
          // Mirror of field.delete's lock (see field.ts): serializes this
          // options write against a concurrent field deletion's view scan on
          // the same table, so a filter referencing the dying field can never
          // commit after the cleanup. pg_advisory_xact_lock only exists inside
          // a transaction (autocommit releases it immediately) — hence the
          // explicit wrapper around lock + write.
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext('view-options:' || ${existing.tableId}))`,
          );
          // Defense chain against dead field references (review N4) — the
          // advisory lock above serializes ordering against field.delete, but a
          // client that read its field list before that delete can still submit
          // a whole-package options payload containing now-dead fieldIds. The
          // lock alone would let it land; validation is what closes the path.
          // Three links together make compileFilter's silent dead-condition
          // drop unreachable:
          //   1. HERE — updateOptions rejects options referencing fields that
          //      don't exist (checked under the lock, i.e. against the
          //      post-field.delete state), gating every NEW write.
          //   2. field.delete (field.ts) — prunes dead references from stored
          //      options and revokes shares whose filter referenced the dying
          //      field, cleaning up the EXISTING stock.
          //   3. share.create (share.ts) — re-checks liveness before pinning a
          //      share to a view, so a view with pre-gate dead references can
          //      never be newly shared.
          const dead = await findDeadFieldReferences(
            existing.tableId,
            parsed.data as ViewOptions,
            tx,
          );
          if (dead.length > 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `View config references unknown field(s): ${dead.join(', ')}`,
            });
          }
          const [updated] = await tx
            .update(view)
            .set({ options: parsed.data })
            .where(eq(view.id, input.id))
            .returning();
          return updated!;
        }),
      );
      if (row) void publishTableChange(row.tableId, ctx.session.user.id);
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(view).where(eq(view.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'View not found' });
      const baseId = await baseIdFromTable(existing.tableId);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      await assertRole(baseId, ctx.session.user.id, 'editor');
      // Deleting the view must also drop the share rows pinned to it —
      // baseShare.viewId has no FK (app-layer integrity, same as field.delete's
      // cleanup), so without this a dead share lingers in share.list forever.
      // Same transaction as the view delete so a token can never outlive its
      // view by half a write.
      await db.transaction(async (tx) => {
        await tx.delete(baseShare).where(eq(baseShare.viewId, input.id));
        await tx.delete(view).where(eq(view.id, input.id));
      });
      if (existing) void publishTableChange(existing.tableId, ctx.session.user.id);
      return { ok: true };
    }),
});
