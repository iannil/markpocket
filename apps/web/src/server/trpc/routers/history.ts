import { and, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { cellHistory, cell, field, record, table, user } from '../../db/schema';
import { db } from '../../db';
import { assertRole, assertTableRole } from '@/lib/roles';
import { protectedProcedure, router } from '../init';

// Email is member-visible data (member.list only ever shows current members),
// yet cell_history rows outlive memberships: a removed member's past edits
// would keep exposing their email to every remaining viewer. Null the email
// unless the author is STILL a member of the base being read. Name stays —
// it is the display field the history UIs consume (name ?? email fallback),
// so removing it too would only degrade the UI without reducing identifiers
// that member.list doesn't already gate. Correlated EXISTS against the
// joined `user` row; base_id is a bound param.
function memberScopedEmail(baseId: string) {
  return sql<
    string | null
  >`CASE WHEN EXISTS (SELECT 1 FROM base_member bm WHERE bm.base_id = ${baseId} AND bm.user_id = ${user.id}) THEN ${user.email} END`;
}

export const historyRouter = router({
  list: protectedProcedure
    .input(z.object({ recordId: z.string(), fieldId: z.string() }))
    .query(async ({ ctx, input }) => {
      // The cell's record must live in a table the user can read. The base
      // id rides along — the email gate below scopes membership to it.
      const [rec] = await db
        .select({ tableId: record.tableId, baseId: table.baseId })
        .from(record)
        .innerJoin(table, eq(record.tableId, table.id))
        .where(eq(record.id, input.recordId))
        .limit(1);
      if (!rec) return [];
      await assertTableRole(rec.tableId, ctx.session.user.id, 'viewer');

      const [cellRow] = await db
        .select({ id: cell.id })
        .from(cell)
        .where(and(eq(cell.recordId, input.recordId), eq(cell.fieldId, input.fieldId)))
        .limit(1);
      if (!cellRow) return [];

      const rows = await db
        .select({
          id: cellHistory.id,
          oldValue: cellHistory.oldValue,
          newValue: cellHistory.newValue,
          changedAt: cellHistory.changedAt,
          changedByName: user.name,
          changedByEmail: memberScopedEmail(rec.baseId),
        })
        .from(cellHistory)
        .leftJoin(user, eq(cellHistory.changedBy, user.id))
        .where(eq(cellHistory.cellId, cellRow.id))
        .orderBy(desc(cellHistory.changedAt))
        .limit(50);

      return rows;
    }),

  // Joined in SQL (cell_history → cell → field → table) — never loads every cell
  // of the base into memory just to map ids.
  listByBase: protectedProcedure
    .input(
      z.object({
        baseId: z.string(),
        offset: z.number().int().min(0).optional().default(0),
        limit: z.number().int().min(1).max(200).optional().default(50),
        tableId: z.string().optional(),
        userId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertRole(input.baseId, ctx.session.user.id, 'viewer');

      const conds = [eq(table.baseId, input.baseId)];
      if (input.tableId) conds.push(eq(table.id, input.tableId));
      if (input.userId) conds.push(eq(cellHistory.changedBy, input.userId));

      const [cnt] = await db
        .select({ value: count() })
        .from(cellHistory)
        .innerJoin(cell, eq(cellHistory.cellId, cell.id))
        .innerJoin(field, eq(cell.fieldId, field.id))
        .innerJoin(table, eq(field.tableId, table.id))
        .where(and(...conds));
      const total = cnt?.value ?? 0;

      const rows = await db
        .select({
          id: cellHistory.id,
          cellId: cellHistory.cellId,
          oldValue: cellHistory.oldValue,
          newValue: cellHistory.newValue,
          changedAt: cellHistory.changedAt,
          changedByName: user.name,
          changedByEmail: memberScopedEmail(input.baseId),
          fieldName: field.name,
          tableName: table.name,
        })
        .from(cellHistory)
        .innerJoin(cell, eq(cellHistory.cellId, cell.id))
        .innerJoin(field, eq(cell.fieldId, field.id))
        .innerJoin(table, eq(field.tableId, table.id))
        .leftJoin(user, eq(cellHistory.changedBy, user.id))
        .where(and(...conds))
        // changed_at is the statement clock: one transaction (dead-ref cleanup,
        // backfill, bulk import) writes many rows stamped identically, so
        // offset paging on changed_at alone repeats/drops rows across pages.
        // The unique history id is the deterministic tiebreaker.
        .orderBy(desc(cellHistory.changedAt), desc(cellHistory.id))
        .limit(input.limit)
        .offset(input.offset);

      return { rows, total };
    }),

  listByTable: protectedProcedure
    .input(
      z.object({
        tableId: z.string(),
        offset: z.number().int().min(0).optional().default(0),
        limit: z.number().int().min(1).max(200).optional().default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertTableRole(input.tableId, ctx.session.user.id, 'viewer');

      const [tableRow] = await db
        .select({ id: table.id, name: table.name, baseId: table.baseId })
        .from(table)
        .where(eq(table.id, input.tableId))
        .limit(1);
      if (!tableRow) return { rows: [], total: 0 };

      const [cnt] = await db
        .select({ value: count() })
        .from(cellHistory)
        .innerJoin(cell, eq(cellHistory.cellId, cell.id))
        .innerJoin(field, eq(cell.fieldId, field.id))
        .where(eq(field.tableId, input.tableId));
      const total = cnt?.value ?? 0;

      const rows = await db
        .select({
          id: cellHistory.id,
          cellId: cellHistory.cellId,
          oldValue: cellHistory.oldValue,
          newValue: cellHistory.newValue,
          changedAt: cellHistory.changedAt,
          changedByName: user.name,
          changedByEmail: memberScopedEmail(tableRow.baseId),
          fieldName: field.name,
        })
        .from(cellHistory)
        .innerJoin(cell, eq(cellHistory.cellId, cell.id))
        .innerJoin(field, eq(cell.fieldId, field.id))
        .leftJoin(user, eq(cellHistory.changedBy, user.id))
        .where(eq(field.tableId, input.tableId))
        // Same tiebreaker as listByBase: equal changed_at stamps from bulk
        // writes would make offset paging non-deterministic without it.
        .orderBy(desc(cellHistory.changedAt), desc(cellHistory.id))
        .limit(input.limit)
        .offset(input.offset);

      return {
        rows: rows.map((r) => ({ ...r, tableName: tableRow.name })),
        total,
      };
    }),
});
