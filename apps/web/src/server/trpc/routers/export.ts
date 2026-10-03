import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { cellToCsv, csvEscape } from '@markpocket/plugin-csv/csv';
import { FieldType } from '@/lib/field-types';
import { formatNumberToString, parseStringToNumber } from '@/lib/format-number';
import { normalizeCellValue } from '@/server/plugins/field-value';
import { assertRole } from '@/lib/roles';
import { listRecordsPivoted, countRecords } from '@/lib/db-queries';
import { field, table } from '../../db/schema';
import { db } from '../../db';
import { protectedProcedure, router } from '../init';

// Shared with the CSV plugin package — the "avoid circular deps" note that
// justified the old inline copies is stale: apps → packages is the one-way
// dependency and plugin-csv imports nothing from the app.
const FIELD_TYPES_API = {
  FieldType,
  formatNumberToString,
  parseStringToNumber,
  normalizeCellValue,
};

export const exportRouter = router({
  exportBase: protectedProcedure
    .input(
      z.object({
        baseId: z.string(),
        // Restrict the export to the caller's selection — the UI used to
        // export EVERY table server-side and throw the unselected CSVs away
        // client-side, paying full cost for a one-table export.
        tableIds: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertRole(input.baseId, ctx.session.user.id, 'viewer');

      const tables = (
        await db
          .select({ id: table.id, name: table.name })
          .from(table)
          .where(eq(table.baseId, input.baseId))
          .orderBy(table.orderIndex)
      ).filter((t) => !input.tableIds || input.tableIds.includes(t.id));

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
              csvEscape(
                cellToCsv(
                  r.cells[f.id],
                  f.type,
                  f.options as Record<string, unknown>,
                  FIELD_TYPES_API,
                ),
              ),
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
