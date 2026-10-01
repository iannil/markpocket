import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { type FieldOptions } from '@/lib/field-types';
import { countRecords, listRecordsPivoted } from '@/lib/db-queries';
import { applyGroup, compileFilter, compileSort } from '@/lib/view-query';
import { parseViewOptions } from '@/lib/view-ast';
import { materializeExpressionsForRecord } from '@/server/expression';
import { cellHistory, field, record, view } from '../../db/schema';
import { db } from '../../db';
import { publishTableChange } from '../../realtime/publish';
import { assertTableRole, baseIdFromTable } from '@/lib/roles';
import { protectedProcedure, router } from '../init';

export const recordRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        tableId: z.string(),
        viewId: z.string().optional(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertTableRole(input.tableId, ctx.session.user.id, 'viewer');
      let viewOptions = parseViewOptions({});
      if (input.viewId) {
        const [v] = await db.select().from(view).where(eq(view.id, input.viewId)).limit(1);
        if (v) viewOptions = parseViewOptions(v.options);
      }

      const fields = await db.select().from(field).where(eq(field.tableId, input.tableId));
      const fieldsById = new Map(
        fields.map((f) => [f.id, { type: f.type, options: f.options as FieldOptions }]),
      );

      const whereFrag = compileFilter(viewOptions.filter, fieldsById);
      const orderByFrag = compileSort(viewOptions.sort, fieldsById);

      const offset = input.offset ?? 0;
      const limit = input.limit ?? 100;
      const [records, total] = await Promise.all([
        listRecordsPivoted(
          input.tableId,
          { where: whereFrag, orderBy: orderByFrag },
          offset,
          limit,
        ),
        countRecords(input.tableId, whereFrag),
      ]);

      const groups = applyGroup(records, viewOptions.group);
      return { groups, total };
    }),

  create: protectedProcedure
    .input(z.object({ tableId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTableRole(input.tableId, ctx.session.user.id, 'editor');
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(record)
          .values({
            id: randomUUID(),
            tableId: input.tableId,
            createdBy: ctx.session.user.id,
          })
          .returning();
        // Materialize expression cells so the new record isn't blank until an edit.
        await materializeExpressionsForRecord(tx, input.tableId, created!.id, ctx.session.user.id);
        return created!;
      });
      void publishTableChange(input.tableId, ctx.session.user.id);
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string(), tableId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const baseId = await baseIdFromTable(input.tableId);
      if (!baseId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      await assertTableRole(input.tableId, ctx.session.user.id, 'editor');

      // The record must actually belong to the authorized table — otherwise the
      // tableId above is just a role-check token for deleting in some other base.
      const [target] = await db
        .select({ tableId: record.tableId })
        .from(record)
        .where(eq(record.id, input.id))
        .limit(1);
      if (!target || target.tableId !== input.tableId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found in this table' });
      }

      // Q6 cascade-clear: find all link cells referencing this record id and
      // remove it. Scoped to the same base so the scan can't touch other bases.
      await db.transaction(async (tx) => {
        const linked = await tx.execute(
          sql`SELECT c.id, c.value FROM cell c
              JOIN field f ON f.id = c.field_id
              JOIN "table" t ON t.id = f.table_id
              WHERE t.base_id = ${baseId} AND c.value @> ${JSON.stringify([input.id])}::jsonb`,
        );
        for (const row of linked as unknown as Array<{ id: string; value: unknown }>) {
          const arr = Array.isArray(row.value) ? row.value : [];
          const next = arr.filter((v: unknown) => v !== input.id);
          // ADR-0005 decision 5: every value change appends a cell_history row.
          await tx.insert(cellHistory).values({
            id: randomUUID(),
            cellId: row.id,
            oldValue: row.value,
            newValue: next.length > 0 ? next : null,
            changedBy: ctx.session.user.id,
          });
          if (next.length === 0) {
            await tx.execute(sql`DELETE FROM cell WHERE id = ${row.id}`);
          } else {
            await tx.execute(
              sql`UPDATE cell SET value = ${JSON.stringify(next)}::jsonb, updated_at = now() WHERE id = ${row.id}`,
            );
          }
        }
        // Delete the record (FK cascade clears its cells).
        await tx.delete(record).where(eq(record.id, input.id));
      });
      void publishTableChange(input.tableId);
      return { ok: true };
    }),
});
