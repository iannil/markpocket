import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { baseShare, base, table, field, view } from '../../db/schema';
import { db } from '../../db';
import { parseViewOptionsStrict, type ViewOptions } from '@/lib/view-ast';
import { publicProcedure, router } from '../init';
// Token lookup shared by all three procedures. Returns null for missing,
// consumed (deleted), or expired shares. Exported for the RSS feed route,
// which must apply the exact same fail-closed semantics (ADR-0010).
export async function findLiveShare(token: string) {
  const [share] = await db.select().from(baseShare).where(eq(baseShare.token, token)).limit(1);
  if (!share) return null;
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) return null;
  return share;
}

// Resolve the view a share is pinned to, scoped to the shared base. A share
// whose view was deleted — or whose stored options no longer parse against
// the current schema — is treated as invalid (null), never as "share
// everything": the tolerant fallback would silently drop filter AND
// hiddenFields and widen the share to the full table (review M-1).
export async function findSharedView(share: {
  baseId: string;
  viewId: string | null;
}): Promise<{ id: string; tableId: string; options: ViewOptions } | null> {
  if (!share.viewId) return null;
  const [v] = await db
    .select({ id: view.id, tableId: view.tableId, options: view.options })
    .from(view)
    .innerJoin(table, eq(view.tableId, table.id))
    .where(and(eq(view.id, share.viewId), eq(table.baseId, share.baseId)))
    .limit(1);
  if (!v) return null;
  // Strict parse on the public path: legacy option shapes the current schema
  // rejects invalidate the share (fail closed), same as a deleted view.
  const options = parseViewOptionsStrict(v.options);
  if (!options) return null;
  return { id: v.id, tableId: v.tableId, options };
}

export const publicShareRouter = router({
  getBase: publicProcedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
    const share = await findLiveShare(input.token);
    if (!share) return null;
    const [baseRow] = await db
      .select({ id: base.id, name: base.name, icon: base.icon })
      .from(base)
      .where(eq(base.id, share.baseId))
      .limit(1);
    if (!baseRow) return null;
    if (share.viewId && !(await findSharedView(share))) return null;
    // Display-only projection: internal row ids serve no client purpose and
    // are needlessly disclosed on an unauthenticated surface.
    return { name: baseRow.name, icon: baseRow.icon, viewId: share.viewId };
  }),

  getTables: publicProcedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
    const share = await findLiveShare(input.token);
    if (!share) return [];
    if (share.viewId) {
      // Same fail-closed rule as getBase/getRecords: a view-bound share whose
      // view is gone — or whose stored options fail the strict parse — exposes
      // NOTHING, not even the base's table names. [] here mirrors getBase's
      // null: an untrustworthy pinned view invalidates the whole share.
      const v = await findSharedView(share);
      if (!v) return [];
      // A view-bound share exposes exactly the view's table — listing every
      // table in the base would leak structure the share never granted.
      return db
        .select({ id: table.id, name: table.name })
        .from(table)
        .where(and(eq(table.id, v.tableId), eq(table.baseId, share.baseId)));
    }
    return db
      .select({ id: table.id, name: table.name })
      .from(table)
      .where(eq(table.baseId, share.baseId));
  }),

  getRecords: publicProcedure
    .input(
      z.object({
        token: z.string(),
        tableId: z.string(),
        limit: z.number().int().min(1).max(1000).optional(),
        // Page offset so the share page can append pages instead of growing
        // the limit forever (listRecordsPivoted pages with a deterministic
        // createdAt/id ordering, so offsets are stable across fetches).
        // Capped to keep an unauthenticated endpoint from forcing deep scans.
        offset: z.number().int().min(0).max(1_000_000).optional(),
      }),
    )
    .query(async ({ input }) => {
      const share = await findLiveShare(input.token);
      if (!share) return null;

      // Verify the requested table belongs to the shared base (scope guard).
      const [tableRow] = await db
        .select({ id: table.id, baseId: table.baseId })
        .from(table)
        .where(eq(table.id, input.tableId))
        .limit(1);
      if (!tableRow || tableRow.baseId !== share.baseId) return null;

      const fields = await db
        .select({ id: field.id, name: field.name, type: field.type, options: field.options })
        .from(field)
        .where(eq(field.tableId, input.tableId))
        // Same column order as the grid and the RSS feed (orderIndex, then
        // the id as the deterministic tiebreaker).
        .orderBy(asc(field.orderIndex), asc(field.id));

      const { listRecordsPivoted, countRecords } = await import('@/lib/db-queries');

      let records;
      let total: number;
      let visibleFields = fields;
      if (share.viewId) {
        const v = await findSharedView(share);
        // Stale viewId (view deleted) invalidates the share — never fall
        // through to an unfiltered listing of the whole table.
        if (!v) return null;
        // The share only ever exposes the pinned view's own table.
        if (v.tableId !== input.tableId) return null;

        const { compileFilter, compileSort } = await import('@/lib/view-query');
        // Options are already strictly parsed by findSharedView — a share
        // whose stored options fail the schema never reaches this point.
        const viewOptions = v.options;
        // Hidden fields are metadata + data: drop them from the field list
        // returned to the client…
        const hiddenFields = (viewOptions.hiddenFields ?? []) as string[];
        if (hiddenFields.length > 0) {
          const hidden = new Set(hiddenFields);
          visibleFields = fields.filter((f) => !hidden.has(f.id));
        }
        // …but compile filter/sort against the FULL field map so a condition
        // on a hidden field keeps filtering instead of being dropped.
        const fieldsById = new Map(
          fields.map((f) => [
            f.id,
            { type: f.type, options: f.options as Record<string, unknown> },
          ]),
        );
        const whereFrag = compileFilter(viewOptions.filter, fieldsById);
        const orderByFrag = compileSort(viewOptions.sort, fieldsById);
        [records, total] = await Promise.all([
          listRecordsPivoted(
            input.tableId,
            { where: whereFrag, orderBy: orderByFrag },
            input.offset ?? 0,
            input.limit ?? 100,
          ),
          countRecords(input.tableId, whereFrag),
        ]);
        // Project cells down to the visible whitelist (copy — never return
        // the raw row map). Field ids outside the list are hidden-field data.
        const visibleIds = new Set(visibleFields.map((f) => f.id));
        records = records.map((r: { id: string; cells: Record<string, unknown> }) => {
          const cells: Record<string, unknown> = {};
          for (const [fieldId, value] of Object.entries(r.cells)) {
            if (visibleIds.has(fieldId)) cells[fieldId] = value;
          }
          return { id: r.id, cells };
        });
      } else {
        [records, total] = await Promise.all([
          listRecordsPivoted(input.tableId, {}, input.offset ?? 0, input.limit ?? 100),
          countRecords(input.tableId),
        ]);
      }

      return { fields: visibleFields, records, total };
    }),
});
