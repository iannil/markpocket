import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { baseShare, base, table, field, view } from '../../db/schema';
import { db } from '../../db';
import { publicProcedure, router } from '../init'; // Token lookup shared by all three procedures. Returns null for missing,
// consumed (deleted), or expired shares.
async function findLiveShare(token: string) {
  const [share] = await db.select().from(baseShare).where(eq(baseShare.token, token)).limit(1);
  if (!share) return null;
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) return null;
  return share;
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
    return { ...baseRow, viewId: share.viewId, shareId: share.id };
  }),

  getTables: publicProcedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
    const share = await findLiveShare(input.token);
    if (!share) return [];
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

      let fields = await db
        .select({ id: field.id, name: field.name, type: field.type, options: field.options })
        .from(field)
        .where(eq(field.tableId, input.tableId));

      const { listRecordsPivoted, countRecords } = await import('@/lib/db-queries');

      let records;
      let total: number;
      if (share.viewId) {
        // The view must belong to the shared base — a stale cross-base viewId
        // must not leak another base's view config.
        const [v] = await db
          .select({ id: view.id, options: view.options })
          .from(view)
          .innerJoin(table, eq(view.tableId, table.id))
          .where(and(eq(view.id, share.viewId), eq(table.baseId, share.baseId)))
          .limit(1);
        const { compileFilter, compileSort } = await import('@/lib/view-query');
        const { parseViewOptions } = await import('@/lib/view-ast');
        const viewOptions = v ? parseViewOptions(v.options) : {};
        // Apply hiddenFields from the view
        const hiddenFields = (viewOptions.hiddenFields ?? []) as string[];
        if (hiddenFields.length > 0) {
          fields = fields.filter((f) => !hiddenFields.includes(f.id));
        }
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
            0,
            input.limit ?? 100,
          ),
          countRecords(input.tableId, whereFrag),
        ]);
      } else {
        [records, total] = await Promise.all([
          listRecordsPivoted(input.tableId, {}, 0, input.limit ?? 100),
          countRecords(input.tableId),
        ]);
      }

      return { fields, records, total };
    }),
});
