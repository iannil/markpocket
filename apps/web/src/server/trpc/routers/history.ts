import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { cellHistory, cell, field, table, user } from '../../db/schema';
import { db } from '../../db';
import { protectedProcedure, router } from '../init';

export const historyRouter = router({
  list: protectedProcedure
    .input(z.object({ recordId: z.string(), fieldId: z.string() }))
    .query(async ({ input }) => {
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
          changedByEmail: user.email,
        })
        .from(cellHistory)
        .leftJoin(user, eq(cellHistory.changedBy, user.id))
        .where(eq(cellHistory.cellId, cellRow.id))
        .orderBy(desc(cellHistory.changedAt))
        .limit(50);

      return rows;
    }),

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
    .query(async ({ input }) => {
      const tableConditions = [eq(table.baseId, input.baseId)];
      if (input.tableId) {
        tableConditions.push(eq(table.id, input.tableId));
      }

      const tables = await db
        .select({ id: table.id, name: table.name })
        .from(table)
        .where(and(...tableConditions));

      const tableIds = tables.map((t) => t.id);
      if (tableIds.length === 0) return { rows: [], total: 0 };

      const fields = await db
        .select({ id: field.id, name: field.name, tableId: field.tableId })
        .from(field)
        .where(inArray(field.tableId, tableIds));

      const fieldIds = fields.map((f) => f.id);
      const cells = await db
        .select({ id: cell.id, fieldId: cell.fieldId, recordId: cell.recordId })
        .from(cell)
        .where(inArray(cell.fieldId, fieldIds));

      const cellIds = cells.map((c) => c.id);
      if (cellIds.length === 0) return { rows: [], total: 0 };

      const fieldById = new Map(fields.map((f) => [f.id, f]));
      const cellToField = new Map(cells.map((c) => [c.id, c.fieldId]));
      const tableById = new Map(tables.map((t) => [t.id, t]));

      const historyConditions = [inArray(cellHistory.cellId, cellIds)];
      if (input.userId) {
        historyConditions.push(eq(cellHistory.changedBy, input.userId));
      }

      const [cnt] = await db
        .select({ value: count() })
        .from(cellHistory)
        .where(and(...historyConditions));
      const total = cnt?.value ?? 0;

      const rows = await db
        .select({
          id: cellHistory.id,
          cellId: cellHistory.cellId,
          oldValue: cellHistory.oldValue,
          newValue: cellHistory.newValue,
          changedAt: cellHistory.changedAt,
          changedByName: user.name,
          changedByEmail: user.email,
        })
        .from(cellHistory)
        .leftJoin(user, eq(cellHistory.changedBy, user.id))
        .where(and(...historyConditions))
        .orderBy(desc(cellHistory.changedAt))
        .limit(input.limit)
        .offset(input.offset);

      const enriched = rows.map((r) => {
        const fieldId = cellToField.get(r.cellId) ?? '';
        const f = fieldById.get(fieldId);
        const t = f ? tableById.get(f.tableId) : undefined;
        return {
          ...r,
          fieldName: f?.name ?? '(deleted)',
          tableName: t?.name ?? '(deleted)',
        };
      });

      return { rows: enriched, total };
    }),

  listByTable: protectedProcedure
    .input(
      z.object({
        tableId: z.string(),
        offset: z.number().int().min(0).optional().default(0),
        limit: z.number().int().min(1).max(200).optional().default(50),
      }),
    )
    .query(async ({ input }) => {
      const [tableRow] = await db
        .select({ id: table.id, name: table.name })
        .from(table)
        .where(eq(table.id, input.tableId))
        .limit(1);
      if (!tableRow) return { rows: [], total: 0 };

      const fields = await db
        .select({ id: field.id, name: field.name })
        .from(field)
        .where(eq(field.tableId, input.tableId));
      const fieldIds = fields.map((f) => f.id);
      if (fieldIds.length === 0) return { rows: [], total: 0 };

      const cells = await db
        .select({ id: cell.id, fieldId: cell.fieldId, recordId: cell.recordId })
        .from(cell)
        .where(inArray(cell.fieldId, fieldIds));
      const cellIds = cells.map((c) => c.id);
      if (cellIds.length === 0) return { rows: [], total: 0 };

      const fieldById = new Map(fields.map((f) => [f.id, f]));
      const cellToField = new Map(cells.map((c) => [c.id, c.fieldId]));

      const [cnt] = await db
        .select({ value: count() })
        .from(cellHistory)
        .where(inArray(cellHistory.cellId, cellIds));
      const total = cnt?.value ?? 0;

      const rows = await db
        .select({
          id: cellHistory.id,
          cellId: cellHistory.cellId,
          oldValue: cellHistory.oldValue,
          newValue: cellHistory.newValue,
          changedAt: cellHistory.changedAt,
          changedByName: user.name,
          changedByEmail: user.email,
        })
        .from(cellHistory)
        .leftJoin(user, eq(cellHistory.changedBy, user.id))
        .where(inArray(cellHistory.cellId, cellIds))
        .orderBy(desc(cellHistory.changedAt))
        .limit(input.limit)
        .offset(input.offset);

      const enriched = rows.map((r) => {
        const fieldId = cellToField.get(r.cellId) ?? '';
        const f = fieldById.get(fieldId);
        return {
          ...r,
          fieldName: f?.name ?? '(deleted)',
          tableName: tableRow.name,
        };
      });

      return { rows: enriched, total };
    }),
});
