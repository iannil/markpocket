import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { FieldType } from '@/lib/field-types';
import { formatNumberToString } from '@/lib/format-number';
import { assertRole } from '@/lib/roles';
import { listRecordsPivoted, countRecords } from '@/lib/db-queries';
import { field, table } from '../../db/schema';
import { db } from '../../db';
import { protectedProcedure, router } from '../init';

// Re-exported from @markpocket/plugin-csv/csv — inline to avoid circular deps.
// Leading = + - @ and tab/CR are neutralized with a leading apostrophe so Excel
// / Sheets don't execute the cell as a formula (OWASP CSV injection). Import
// strips the apostrophe again, keeping the round-trip.
function csvEscape(s: string): string {
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

function cellToCsv(value: unknown, type: string, options: Record<string, unknown>): string {
  if (value == null) return '';
  switch (type) {
    case FieldType.Number:
      return formatNumberToString(value as number, options as { precision?: number });
    case FieldType.Boolean:
      return value ? 'true' : 'false';
    case FieldType.SingleSelect: {
      const choices = (options.choices as Array<{ id: string; name: string }>) ?? [];
      return choices.find((c) => c.id === value)?.name ?? '';
    }
    case FieldType.MultiSelect: {
      const choices = (options.choices as Array<{ id: string; name: string }>) ?? [];
      const ids = (value as string[]) ?? [];
      return ids
        .map((id) => choices.find((c) => c.id === id)?.name ?? '')
        .filter(Boolean)
        .join('|');
    }
    case FieldType.Link:
    case FieldType.Attachment:
    case FieldType.User:
    case FieldType.Expression:
      return '';
    default:
      return String(value);
  }
}

export const exportRouter = router({
  exportBase: protectedProcedure
    .input(z.object({ baseId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertRole(input.baseId, ctx.session.user.id, 'viewer');

      const tables = await db
        .select({ id: table.id, name: table.name })
        .from(table)
        .where(eq(table.baseId, input.baseId))
        .orderBy(table.orderIndex);

      const files: Array<{
        tableId: string;
        name: string;
        csv: string;
        truncated: boolean;
        total: number;
      }> = [];
      const EXPORT_LIMIT = 10_000;

      for (const t of tables) {
        const fields = await db
          .select({
            id: field.id,
            name: field.name,
            type: field.type,
            options: field.options,
            orderIndex: field.orderIndex,
          })
          .from(field)
          .where(eq(field.tableId, t.id));
        fields.sort((a, b) => a.orderIndex - b.orderIndex);

        const [records, total] = await Promise.all([
          listRecordsPivoted(t.id, {}, 0, EXPORT_LIMIT),
          countRecords(t.id),
        ]);

        const header = fields.map((f) => csvEscape(f.name)).join(',');
        const lines = records.map((r) =>
          fields
            .map((f) =>
              csvEscape(cellToCsv(r.cells[f.id], f.type, f.options as Record<string, unknown>)),
            )
            .join(','),
        );
        const safeName = t.name.replace(/[^a-zA-Z0-9_-]/g, '_') || t.id;
        files.push({
          tableId: t.id,
          name: `${safeName}.csv`,
          csv: [header, ...lines].join('\n'),
          truncated: total > records.length,
          total,
        });
      }

      return files;
    }),
});
