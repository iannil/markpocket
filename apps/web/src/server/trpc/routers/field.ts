import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { asc, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { FIELD_TYPES, FieldType, type FieldOptions } from '@/lib/field-types';
import { extractDependsOn } from '@/lib/expression-eval';
import { filterReferencesField, parseViewOptions, removeFieldReferences } from '@/lib/view-ast';
import { defaultOptions, parseOptions } from '@/server/plugins/field-value';
import { backfillExpressionField } from '@/server/expression';
import { baseShare, cell, field, table, view } from '../../db/schema';
import { db } from '../../db';
import { mapBusyToConflict } from '../../db/pg-errors';
import { publishTableChange } from '../../realtime/publish';
import { assertRole, assertTableRole, baseIdFromTable } from '@/lib/roles';
import {
  lockFormLifecycle,
  formReferencesField,
  revokeFieldPublications,
  revokeViewPublications,
} from '../../forms/publications';
import { protectedProcedure, router } from '../init';

// Hard ceiling independent of type-specific schemas — future field types must
// not be able to smuggle megabyte option blobs into every field.list payload.
const MAX_OPTIONS_BYTES = 64 * 1024;

function assertOptionsBounded(options: unknown): void {
  const serialized = JSON.stringify(options) ?? '';
  if (Buffer.byteLength(serialized, 'utf8') > MAX_OPTIONS_BYTES) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Field options too large (limit ${MAX_OPTIONS_BYTES / 1024}KB serialized)`,
    });
  }
}

// Link targets must live in the same base — cross-base links would dangle
// outside every base-scoped cleanup scan (table/base delete, record.delete).
// The FOR UPDATE row lock serializes against table.delete's final
// transaction (which locks the target row before its referrer guard):
// whichever side commits first, the other sees either the new referrer
// field (delete aborts) or a missing target (create/retarget aborts).
async function assertLinkTargetInBase(
  targetTableId: unknown,
  baseId: string,
  executor: Pick<typeof db, 'select'> = db,
): Promise<void> {
  if (typeof targetTableId !== 'string' || !targetTableId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Link field requires a target table' });
  }
  const [target] = await executor
    .select({ baseId: table.baseId })
    .from(table)
    .where(eq(table.id, targetTableId))
    .limit(1)
    .for('update');
  if (!target || target.baseId !== baseId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Link target table must exist and belong to the same base',
    });
  }
}

// ADR-0003: expressions may only reference existing non-expression fields of
// their own table — expression-on-expression would need recursive evaluation
// and dependsOn would never settle.
async function assertDependsOnValid(tableId: string, dependsOn: string[]): Promise<void> {
  if (dependsOn.length === 0) return;
  const fields = await db
    .select({ id: field.id, type: field.type })
    .from(field)
    .where(eq(field.tableId, tableId));
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const id of dependsOn) {
    const ref = byId.get(id);
    if (!ref) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Expression references unknown field ${id}`,
      });
    }
    if (ref.type === FieldType.Expression) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Expression cannot reference expression field ${id}`,
      });
    }
  }
}

export const fieldRouter = router({
  list: protectedProcedure
    .input(z.object({ tableId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTableRole(input.tableId, ctx.session.user.id, 'viewer');
      return db
        .select()
        .from(field)
        .where(eq(field.tableId, input.tableId))
        .orderBy(asc(field.orderIndex), asc(field.createdAt), asc(field.id));
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        tableId: z.string(),
        fieldIds: z
          .array(z.string().min(1))
          .min(1)
          .max(1000)
          .refine((ids) => new Set(ids).size === ids.length, 'Duplicate field IDs'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTableRole(input.tableId, ctx.session.user.id, 'editor');
      await mapBusyToConflict(
        db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext('field-order:' || ${input.tableId}))`,
          );
          const rows = await tx
            .select({ id: field.id })
            .from(field)
            .where(eq(field.tableId, input.tableId));
          const allowed = new Set(rows.map((row) => row.id));
          if (
            rows.length !== input.fieldIds.length ||
            input.fieldIds.some((id) => !allowed.has(id))
          ) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Fields changed; reload before reordering',
            });
          }
          for (const [orderIndex, id] of input.fieldIds.entries()) {
            await tx.update(field).set({ orderIndex }).where(eq(field.id, id));
          }
        }),
      );
      void publishTableChange(input.tableId, ctx.session.user.id);
      return { ok: true };
    }),

  create: protectedProcedure
    .input(
      z.object({
        tableId: z.string(),
        name: z.string().trim().min(1).max(64),
        type: z.enum(FIELD_TYPES),
        options: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTableRole(input.tableId, ctx.session.user.id, 'editor');
      const options = parseOptions(input.type, input.options ?? defaultOptions(input.type));
      assertOptionsBounded(options);
      // dependsOn is server-derived — a client-supplied value is never trusted.
      if (input.type === FieldType.Expression) {
        const dependsOn = extractDependsOn((options as { expression?: string }).expression ?? '');
        (options as { dependsOn?: string[] }).dependsOn = dependsOn;
        await assertDependsOnValid(input.tableId, dependsOn);
      }
      const baseId = input.type === FieldType.Link ? await baseIdFromTable(input.tableId) : null;
      if (input.type === FieldType.Link && !baseId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      }
      const row = await mapBusyToConflict(
        db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext('field-order:' || ${input.tableId}))`,
          );
          const [last] = await tx
            .select({ orderIndex: field.orderIndex })
            .from(field)
            .where(eq(field.tableId, input.tableId))
            .orderBy(sql`${field.orderIndex} DESC`)
            .limit(1);
          // Link validation runs in-transaction with the FOR UPDATE target-row
          // lock (see assertLinkTargetInBase) so it serializes against
          // table.delete's final transaction.
          if (input.type === FieldType.Link) {
            await assertLinkTargetInBase(
              (options as { targetTableId?: unknown }).targetTableId,
              baseId!,
              tx,
            );
          }
          const [created] = await tx
            .insert(field)
            .values({
              id: randomUUID(),
              tableId: input.tableId,
              name: input.name,
              orderIndex: (last?.orderIndex ?? -1) + 1,
              type: input.type,
              options,
            })
            .returning();
          return created!;
        }),
      );
      // New expression field: materialize values for existing records. Runs
      // after the definition commit — the backfill batches its own
      // transactions and must not nest inside the field's.
      if (input.type === FieldType.Expression) {
        const exprOpts = options as { expression?: string };
        await backfillExpressionField(
          input.tableId,
          row.id,
          exprOpts.expression ?? '',
          ctx.session.user.id,
        );
      }
      void publishTableChange(input.tableId, ctx.session.user.id);
      return row;
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(field).where(eq(field.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' });
      await assertTableRole(existing.tableId, ctx.session.user.id, 'editor');
      const [row] = await db
        .update(field)
        .set({ name: input.name })
        .where(eq(field.id, input.id))
        .returning();
      if (row) void publishTableChange(row.tableId, ctx.session.user.id);
      return row;
    }),

  // Note (deferred): removing a select option does NOT cascade-clear cells holding
  // that option id in Phase 1 — such cells render blank until re-edited. Lands later.
  updateOptions: protectedProcedure
    .input(z.object({ id: z.string(), options: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(field).where(eq(field.id, input.id)).limit(1);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' });
      }
      await assertTableRole(existing.tableId, ctx.session.user.id, 'editor');
      const options = parseOptions(existing.type as FieldType, input.options) as FieldOptions;
      assertOptionsBounded(options);
      // dependsOn is server-derived on every expression write.
      if (existing.type === FieldType.Expression) {
        const dependsOn = extractDependsOn((options as { expression?: string }).expression ?? '');
        (options as { dependsOn?: string[] }).dependsOn = dependsOn;
        await assertDependsOnValid(existing.tableId, dependsOn);
      }
      const linkBaseId =
        existing.type === FieldType.Link ? await baseIdFromTable(existing.tableId) : null;
      if (existing.type === FieldType.Link && !linkBaseId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      }
      const row = await mapBusyToConflict(
        db.transaction(async (tx) => {
          await lockFormLifecycle(tx, existing.tableId);
          const [current] = await tx.select().from(field).where(eq(field.id, input.id));
          if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' });
          if (!isDeepStrictEqual(current.options, options)) {
            await revokeFieldPublications(tx, existing.tableId, input.id);
          }
          if (existing.type === FieldType.Link) {
            // In-transaction with the FOR UPDATE target-row lock — same
            // serialization against table.delete as field.create.
            await assertLinkTargetInBase(
              (options as { targetTableId?: unknown }).targetTableId,
              linkBaseId!,
              tx,
            );
            // Retargeting a link that already stores values would orphan them: the
            // cells keep pointing at the old table's records (dead links rendered,
            // every future write rejected against the new target). Redirecting an
            // empty column is fine — there is nothing to orphan.
            const oldTarget = (existing.options as { targetTableId?: unknown } | null)
              ?.targetTableId;
            const newTarget = (options as { targetTableId?: unknown }).targetTableId;
            if (newTarget !== oldTarget) {
              const [stored] = await tx
                .select({ id: cell.id })
                .from(cell)
                .where(eq(cell.fieldId, input.id))
                .limit(1);
              if (stored) {
                throw new TRPCError({
                  code: 'BAD_REQUEST',
                  message:
                    'Cannot retarget a link field with existing values. Clear the column first.',
                });
              }
            }
          }
          const [updated] = await tx
            .update(field)
            .set({ options })
            .where(eq(field.id, input.id))
            .returning();
          // The pre-transaction read is long stale by now: a concurrent
          // field.delete commits in between and this update matches 0 rows.
          // Returning [] must surface as NOT_FOUND, not fall through the old
          // non-null assertion and blow up on row.tableId after commit (500).
          if (!updated) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' });
          }
          return updated;
        }),
      );
      // Expression definition changed: re-materialize every existing record.
      // Runs after the definition commit (the backfill owns its transactions).
      if (existing.type === FieldType.Expression) {
        const exprOpts = options as { expression?: string };
        await backfillExpressionField(
          existing.tableId,
          input.id,
          exprOpts.expression ?? '',
          ctx.session.user.id,
        );
      }
      void publishTableChange(row.tableId, ctx.session.user.id);
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(field).where(eq(field.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' });
      const baseId = await baseIdFromTable(existing.tableId);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      await assertRole(baseId, ctx.session.user.id, 'editor');
      // ADR-0003: a field referenced by a live expression can't vanish — the
      // dependent expression would evaluate against a missing input forever.
      const siblings = await db
        .select({ id: field.id, name: field.name, options: field.options })
        .from(field)
        .where(eq(field.tableId, existing.tableId));
      const dependentNames = siblings
        .filter(
          (f) =>
            f.id !== input.id &&
            ((f.options as { dependsOn?: string[] } | null)?.dependsOn ?? []).includes(input.id),
        )
        .map((f) => f.name);
      if (dependentNames.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Field is referenced by expression field(s) ${dependentNames.join(', ')} — delete or edit them first`,
        });
      }
      // Review M-2: deleting a field its views still reference would let
      // compileCondition silently drop the filter condition (unknown fieldId
      // → null) and widen every share pinned to those views. Cleanup instead:
      // prune the references from every view of the table, and invalidate the
      // shares of views whose FILTER referenced the field — losing a condition
      // widens the row set, so those shares must not outlive the field. Views
      // without a bound share only get their options pruned (sort/group/
      // hiddenFields references don't change which rows a share exposes).
      await mapBusyToConflict(
        db.transaction(async (tx) => {
          // Always acquire field-order before view-options to avoid deadlocks.
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext('field-order:' || ${existing.tableId}))`,
          );
          // Serialize against view.updateOptions writers on this table: under
          // READ COMMITTED an options write committing after the view scan below
          // stays invisible to this transaction — a filter referencing the dying
          // field would land post-cleanup and every share pinned to the view
          // silently widens (compileFilter drops the dead condition). The
          // 'view-options:' namespace keeps this lock disjoint from cell.ts's
          // per-cell locks; view.ts takes the same lock around options writes.
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext('view-options:' || ${existing.tableId}))`,
          );
          const views = await tx
            .select({ id: view.id, options: view.options })
            .from(view)
            .where(eq(view.tableId, existing.tableId));
          const filterHitViewIds: string[] = [];
          for (const v of views) {
            // Parse known Grid keys separately: an invalid Form/Kanban draft (including
            // an emptied projection) must not hide Grid references or lose opaque
            // extension keys. Cleanup preserves raw config; publication validates it.
            const raw =
              v.options && typeof v.options === 'object' && !Array.isArray(v.options)
                ? (v.options as Record<string, unknown>)
                : {};
            const parsed = parseViewOptions({ ...raw, form: undefined, kanban: undefined });
            if (filterReferencesField(parsed.filter, input.id)) filterHitViewIds.push(v.id);
            const cleaned = removeFieldReferences(parsed, input.id);
            const formHit = formReferencesField(raw, input.id);
            if (formHit) await revokeViewPublications(tx, v.id);
            if (cleaned === parsed && !formHit) continue;
            const next = { ...raw };
            for (const key of ['filter', 'sort', 'group', 'hiddenFields'] as const) {
              if (parsed[key] === undefined) continue;
              if (cleaned[key] === undefined) delete next[key];
              else next[key] = cleaned[key];
            }
            if (formHit) {
              const form = raw.form as { fields: { fieldId?: string }[] };
              next.form = {
                ...form,
                fields: form.fields.filter((entry) => entry?.fieldId !== input.id),
              };
            }
            await tx.update(view).set({ options: next }).where(eq(view.id, v.id));
          }
          if (filterHitViewIds.length > 0) {
            // Fail-closed: revoke the share rows outright (same end state the
            // holder sees as shareRouter.delete — token dead, recreate to
            // re-share). baseShare.viewId has no FK, so this is manual.
            await tx.delete(baseShare).where(inArray(baseShare.viewId, filterHitViewIds));
          }
          // FK cascade clears cells; cell_history rows persist (no FK on cellId).
          await tx.delete(field).where(eq(field.id, input.id));
        }),
      );
      void publishTableChange(existing.tableId, ctx.session.user.id);
      return { ok: true };
    }),
});
