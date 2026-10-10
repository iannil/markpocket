import { eq, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { groupKey } from '@/lib/group-key';
import { KANBAN_UNAVAILABLE_CHOICE_ID } from '@/lib/kanban-config';
import type { FieldOptions } from '@/lib/field-types';
import { parseViewOptions } from '@/lib/view-ast';
import { compileFilter } from '@/lib/view-query';
import { db } from '../db';
import { field, view } from '../db/schema';
import { requireKanbanOptions } from './kanban-page';

/** Aggregate the complete filtered view without loading record cells. */
export async function getGroupCounts(
  tableId: string,
  viewId: string,
): Promise<{ total: number; groups: { key: string | null; count: number }[] }> {
  return db.transaction(
    async (tx) => {
      await tx.execute(sql`set local statement_timeout = '30s'`);
      const [v] = await tx.select().from(view).where(eq(view.id, viewId)).limit(1);
      if (!v || v.tableId !== tableId)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'View does not belong to this table' });
      const fields = await tx.select().from(field).where(eq(field.tableId, tableId));
      const options =
        v.type === 'kanban' ? requireKanbanOptions(v, fields).options : parseViewOptions(v.options);
      const where = compileFilter(
        options.filter,
        new Map(fields.map((f) => [f.id, { type: f.type, options: f.options as FieldOptions }])),
      );
      const groupFieldId =
        v.type === 'kanban' ? options.kanban!.groupFieldId : options.group?.[0]?.fieldId;
      // A legacy JSON number/array can stringify to a real choice ID. Classify
      // nonstring statuses before aggregation so counts match kanbanPage lanes.
      // JSON/SQL null and empty strings retain the shared empty-key semantics.
      const groupValue =
        v.type === 'kanban'
          ? sql`case when jsonb_typeof(c.value) not in ('string', 'null') then ${JSON.stringify(KANBAN_UNAVAILABLE_CHOICE_ID)}::jsonb else c.value end`
          : sql`c.value`;
      const rows = groupFieldId
        ? await tx.execute(
            sql`select ${groupValue} as value, count(*)::int as count from record left join cell c on c.record_id = record.id and c.field_id = ${groupFieldId} where record.table_id = ${tableId} ${where ? sql`and (${where})` : sql``} group by 1`,
          )
        : await tx.execute(
            sql`select null as value, count(*)::int as count from record where record.table_id = ${tableId} ${where ? sql`and (${where})` : sql``}`,
          );
      const counts = new Map<string | null, number>();
      for (const row of rows) {
        const key = groupKey(row.value);
        const count = Number(row.count);
        if (count) counts.set(key, (counts.get(key) ?? 0) + count);
      }
      const groups = Array.from(counts, ([key, count]) => ({ key, count })).sort((a, b) =>
        a.key === b.key ? 0 : a.key === null ? -1 : b.key === null ? 1 : a.key < b.key ? -1 : 1,
      );
      return { total: groups.reduce((sum, g) => sum + g.count, 0), groups };
    },
    { accessMode: 'read only', isolationLevel: 'repeatable read' },
  );
}
