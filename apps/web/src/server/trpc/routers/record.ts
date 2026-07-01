import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { type FieldOptions } from '@/lib/field-types';
import { countRecords, listRecordsPivoted } from '@/lib/db-queries';
import { applyGroup, compileFilter, compileSort } from '@/lib/view-query';
import { parseViewOptions } from '@/lib/view-ast';
import { field, record, view } from '../../db/schema';
import { db } from '../../db';
import { publishTableChange } from '../../realtime/publish';
import { protectedProcedure, router } from '../init';

export const recordRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        tableId: z.string(),
        viewId: z.string().optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .query(async ({ input }) => {
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
      const [records, total] = await Promise.all([
        listRecordsPivoted(input.tableId, { where: whereFrag, orderBy: orderByFrag }, offset, 100),
        countRecords(input.tableId, whereFrag),
      ]);

      const groups = applyGroup(records, viewOptions.group);
      return { groups, total };
    }),

  create: protectedProcedure
    .input(z.object({ tableId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .insert(record)
        .values({
          id: randomUUID(),
          tableId: input.tableId,
          createdBy: ctx.session.user.id,
        })
        .returning();
      void publishTableChange(input.tableId, ctx.session.user.id);
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string(), tableId: z.string() }))
    .mutation(async ({ input }) => {
      // Q6 cascade-clear: find all link cells referencing this record id and remove it.
      await db.transaction(async (tx) => {
        // GIN scan: cells whose value (JSONB array) contains this record id.
        const linked = await tx.execute(
          sql`SELECT id, value FROM cell WHERE value @> ${JSON.stringify([input.id])}::jsonb`,
        );
        for (const row of linked as unknown as Array<{ id: string; value: unknown }>) {
          const arr = Array.isArray(row.value) ? row.value : [];
          const next = arr.filter((v: unknown) => v !== input.id);
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
