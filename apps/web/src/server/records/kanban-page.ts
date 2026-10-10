import { eq, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { countRecords, listRecordsPivoted } from '@/lib/db-queries';
import type { FieldOptions } from '@/lib/field-types';
import { KANBAN_UNAVAILABLE_CHOICE_ID, validateKanbanFields } from '@/lib/kanban-config';
import { collectReferencedFieldIds, parseViewOptionsStrict } from '@/lib/view-ast';
import { compileFilter, compileSort } from '@/lib/view-query';
import { db } from '../db';
import { field, view } from '../db/schema';

export const kanbanPageInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  choiceId: z.string().nullable(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(50).default(50),
});

/** Shared strict gate for pages and counts; stale filters must never widen a board. */
export function requireKanbanOptions(
  v: { type: string; options: unknown },
  fields: (typeof field.$inferSelect)[],
) {
  const options = parseViewOptionsStrict(v.options);
  const config = options?.kanban;
  try {
    if (v.type !== 'kanban' || !options || !config) throw Error('Missing board config');
    const alive = new Set(fields.map((f) => f.id));
    if ([...collectReferencedFieldIds(options)].some((id) => !alive.has(id)))
      throw Error('Stale field reference');
    const choices = validateKanbanFields(config, fields);
    return { options, config, choices };
  } catch {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Configure a status field for this board',
    });
  }
}

/** SQL limits the lane's record IDs before pivoting any cells. */
export async function getKanbanPage(input: z.infer<typeof kanbanPageInputSchema>) {
  return db.transaction(
    async (tx) => {
      await tx.execute(sql`set local statement_timeout = '30s'`);
      const [v] = await tx.select().from(view).where(eq(view.id, input.viewId)).limit(1);
      if (!v || v.tableId !== input.tableId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'View does not belong to this table' });
      }
      const fields = await tx.select().from(field).where(eq(field.tableId, input.tableId));
      const { options, config, choices } = requireKanbanOptions(v, fields);
      const fieldsById = new Map(
        fields.map((f) => [f.id, { type: f.type, options: f.options as FieldOptions }]),
      );
      if (
        input.choiceId !== null &&
        input.choiceId !== KANBAN_UNAVAILABLE_CHOICE_ID &&
        !choices.some((choice) => choice.id === input.choiceId)
      ) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown Kanban choice' });
      }
      // SQL NULL and JSON null are both legacy empty cells, as is the empty string.
      const nonempty = sql`k.value is not null and k.value <> 'null'::jsonb and k.value <> '""'::jsonb`;
      const lane =
        input.choiceId === null
          ? sql`not exists(select 1 from cell k where k.record_id = record.id and k.field_id = ${config.groupFieldId} and ${nonempty})`
          : input.choiceId === KANBAN_UNAVAILABLE_CHOICE_ID
            ? sql`exists(select 1 from cell k where k.record_id = record.id and k.field_id = ${config.groupFieldId} and ${nonempty} and not exists(select 1 from jsonb_array_elements(${JSON.stringify(choices.map((choice) => choice.id))}::jsonb) allowed(value) where allowed.value = k.value))`
            : sql`exists(select 1 from cell k where k.record_id = record.id and k.field_id = ${config.groupFieldId} and k.value = ${JSON.stringify(input.choiceId)}::jsonb)`;
      const filter = compileFilter(options.filter, fieldsById);
      const where = filter ? sql`(${filter}) and (${lane})` : lane;
      const records = await listRecordsPivoted(
        input.tableId,
        { where, orderBy: compileSort(options.sort, fieldsById) },
        input.offset,
        input.limit,
        tx,
      );
      const total = await countRecords(input.tableId, where, tx);
      return { records, total };
    },
    { accessMode: 'read only', isolationLevel: 'repeatable read' },
  );
}
