import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { CoreServerApi, ServerRouterFactory } from '@markpocket/plugin-sdk';
import { protectedProcedure, router } from '@markpocket/plugin-sdk/trpc';

import { cellToCsv, csvEscape, parseCsv } from './csv';

type SelectOption = { id: string; name: string; color: string };

const csvServer: ServerRouterFactory<ReturnType<typeof buildRouter>> = (core) => buildRouter(core);

function buildRouter(core: CoreServerApi) {
  const { schema, queries, fieldTypes } = core;
  // DrizzleLike 的结构面在 `eq()`/`.insert().values()`/`.select().where()` 链上与
  // drizzle 的 Column/SQLWrapper 重载摩擦过大，此处按 brief 允许将 db 落地为 any。
  // 运行时用真实 drizzle db；tRPC I/O（input/output）类型不受影响。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = core.db as any;
  const FieldType = fieldTypes.FieldType;
  return router({
    import: protectedProcedure
      .input(z.object({ tableId: z.string(), csvText: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const rows = parseCsv(input.csvText);
        if (rows.length < 2) throw new Error('CSV must have header + data');
        const [headerRow, ...dataRows] = rows;
        const fields = (await db
          .select()
          .from(schema.field)
          .where(
            eq((schema.field as { tableId: unknown }).tableId as never, input.tableId),
          )) as Array<{
          id: string;
          name: string;
          type: string;
          options: Record<string, unknown>;
        }>;
        const colMap: Array<{ colIdx: number; field: (typeof fields)[number] }> = [];
        for (let i = 0; i < headerRow!.length; i++) {
          const name = headerRow![i]!.trim().toLowerCase();
          const f = fields.find((fd) => fd.name.toLowerCase() === name);
          if (f) colMap.push({ colIdx: i, field: f });
        }
        let imported = 0;
        for (const row of dataRows) {
          const recId = randomUUID();
          await db
            .insert(schema.record)
            .values({ id: recId, tableId: input.tableId, createdBy: ctx.session.user.id });
          for (const { colIdx, field: f } of colMap) {
            const raw = row[colIdx]?.trim() ?? '';
            if (!raw) continue;
            let value: unknown = raw;
            if (f.type === FieldType.Number) {
              const n = fieldTypes.parseStringToNumber(raw);
              if (n == null) continue;
              value = n;
            } else if (f.type === FieldType.Boolean) {
              value = raw === 'true' || raw === '1';
            } else if (f.type === FieldType.SingleSelect) {
              const choices = (f.options.choices as SelectOption[]) ?? [];
              const match = choices.find((c) => c.name.toLowerCase() === raw.toLowerCase());
              if (!match) continue;
              value = match.id;
            } else if (f.type === FieldType.MultiSelect) {
              const choices = (f.options.choices as SelectOption[]) ?? [];
              const names = raw.split('|').map((s) => s.trim());
              value = names
                .map((n) => choices.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id)
                .filter(Boolean);
              if (!(value as string[]).length) continue;
            } else if (
              f.type === FieldType.Link ||
              f.type === FieldType.Attachment ||
              f.type === FieldType.User ||
              f.type === FieldType.Expression
            ) {
              continue;
            }
            await db
              .insert(schema.cell)
              .values({ id: randomUUID(), recordId: recId, fieldId: f.id, value });
          }
          imported++;
        }
        return { imported };
      }),
    export: protectedProcedure.input(z.object({ tableId: z.string() })).query(async ({ input }) => {
      const fields = (await db
        .select()
        .from(schema.field)
        .where(
          eq((schema.field as { tableId: unknown }).tableId as never, input.tableId),
        )) as Array<{
        id: string;
        name: string;
        type: string;
        options: Record<string, unknown>;
        orderIndex: number;
      }>;
      // 保持旧 REST 导出列序：旧 route 用 `.orderBy(field.orderIndex)`。
      fields.sort((a, b) => a.orderIndex - b.orderIndex);
      const records = await queries.listRecordsPivoted(input.tableId, {}, 0, 10000);
      const header = fields.map((f) => csvEscape(f.name)).join(',');
      const lines = records.map((r) =>
        fields
          .map((f) => csvEscape(cellToCsv(r.cells[f.id], f.type, f.options, fieldTypes)))
          .join(','),
      );
      return { csv: [header, ...lines].join('\n') };
    }),
  });
}

export default csvServer;
