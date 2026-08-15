import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { baseShare, base, table, field, view } from '../../db/schema';
import { db } from '../../db';
import { publicProcedure, router } from '../init';

export const publicShareRouter = router({
  getBase: publicProcedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
    const [share] = await db
      .select()
      .from(baseShare)
      .where(eq(baseShare.token, input.token))
      .limit(1);
    if (!share) return null;
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) return null;
    const [baseRow] = await db
      .select({ id: base.id, name: base.name, icon: base.icon })
      .from(base)
      .where(eq(base.id, share.baseId))
      .limit(1);
    if (!baseRow) return null;
    return { ...baseRow, viewId: share.viewId, shareId: share.id };
  }),

  getTables: publicProcedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
    const [share] = await db
      .select()
      .from(baseShare)
      .where(eq(baseShare.token, input.token))
      .limit(1);
    if (!share) return [];
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) return [];
    return db
      .select({ id: table.id, name: table.name })
      .from(table)
      .where(eq(table.baseId, share.baseId));
  }),

  getRecords: publicProcedure
    .input(z.object({ token: z.string(), tableId: z.string() }))
    .query(async ({ input }) => {
      const [share] = await db
        .select()
        .from(baseShare)
        .where(eq(baseShare.token, input.token))
        .limit(1);
      if (!share) return null;
      if (share.expiresAt && new Date(share.expiresAt) < new Date()) return null;

      const fields = await db
        .select({ id: field.id, name: field.name, type: field.type, options: field.options })
        .from(field)
        .where(eq(field.tableId, input.tableId));

      const { listRecordsPivoted } = await import('@/lib/db-queries');

      let records;
      if (share.viewId) {
        const [v] = await db.select().from(view).where(eq(view.id, share.viewId)).limit(1);
        const { compileFilter, compileSort } = await import('@/lib/view-query');
        const { parseViewOptions } = await import('@/lib/view-ast');
        const viewOptions = v ? parseViewOptions(v.options) : {};
        const fieldsById = new Map(
          fields.map((f) => [
            f.id,
            { type: f.type, options: f.options as Record<string, unknown> },
          ]),
        );
        const whereFrag = compileFilter(viewOptions.filter, fieldsById);
        const orderByFrag = compileSort(viewOptions.sort, fieldsById);
        records = await listRecordsPivoted(input.tableId, {
          where: whereFrag,
          orderBy: orderByFrag,
        });
      } else {
        records = await listRecordsPivoted(input.tableId, {});
      }

      return { fields, records };
    }),
});
