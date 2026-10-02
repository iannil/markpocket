import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { TRPCError, type CoreServerApi, type ServerRouterFactory } from '@markpocket/plugin-sdk';
import { protectedProcedure, router } from '@markpocket/plugin-sdk/trpc';

import { cellToCsv, csvEscape, csvUnguard, parseCsv, parseCsvBoolean } from './csv';

type SelectOption = { id: string; name: string; color: string };

const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5MB of text — bounded input, bounded work.
const MAX_IMPORT_ROWS = 50_000;
// Rows per import transaction — the same discipline the core expression
// backfill applies: a 50k-row single transaction would amass ~500k statements.
const IMPORT_BATCH_ROWS = 500;
const EXPORT_LIMIT = 10_000;
// Mirrors the core cell router's cap (apps/web cell.ts MAX_CELL_VALUE_BYTES):
// the CSV wire limit alone (5MB) would let a single text cell store ~5MB,
// a bypass of the interactive-edit limit. Kept as a copy because the plugin
// SDK surface does not expose the core constant.
const MAX_CELL_VALUE_BYTES = 256 * 1024;

const csvServer: ServerRouterFactory<ReturnType<typeof buildRouter>> = (core) => buildRouter(core);

// CSV-level coercion only (name→id for selects, string→number/boolean); the
// empty/error/value semantics come from the core registry via
// fieldTypes.normalizeCellValue so import and interactive edits can't diverge.
function coerceCsvValue(
  raw: string,
  type: string,
  options: Record<string, unknown>,
  ft: CoreServerApi['fieldTypes'],
): unknown {
  switch (type) {
    case ft.FieldType.Number:
      return ft.parseStringToNumber(raw);
    case ft.FieldType.Boolean:
      return parseCsvBoolean(raw);
    case ft.FieldType.SingleSelect: {
      const choices = (options.choices as SelectOption[]) ?? [];
      return choices.find((c) => c.name.toLowerCase() === raw.toLowerCase())?.id ?? null;
    }
    case ft.FieldType.MultiSelect: {
      const choices = (options.choices as SelectOption[]) ?? [];
      const names = raw.split('|').map((s) => s.trim());
      return names
        .map((n) => choices.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id)
        .filter(Boolean);
    }
    default:
      return raw;
  }
}

function buildRouter(core: CoreServerApi) {
  const { schema, queries, fieldTypes, auth, realtime } = core;
  // DrizzleLike 的结构面在 `eq()`/`.insert().values()`/`.select().where()` 链上与
  // drizzle 的 Column/SQLWrapper 重载摩擦过大，此处按 brief 允许将 db 落地为 any。
  // 运行时用真实 drizzle db；tRPC I/O（input/output）类型不受影响。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = core.db as any;
  const FieldType = fieldTypes.FieldType;
  return router({
    import: protectedProcedure
      .input(
        z.object({
          tableId: z.string(),
          // Byte budget, not code units: zod's .max() on strings counts UTF-16
          // code units, so 5M CJK chars (15MB of UTF-8 on the wire) would pass
          // here while tripping the 12MB HTTP body gate — an inconsistent pair
          // of limits. Cap the bytes the transport and the DB actually see.
          csvText: z.string().refine((s) => Buffer.byteLength(s, 'utf8') <= MAX_CSV_BYTES, {
            message: 'CSV exceeds 5MB',
          }),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Same role gate as the core record router — the plugin must not be a bypass.
        await auth.assertTableRole(input.tableId, ctx.session.user.id, 'editor');
        const rows = parseCsv(input.csvText);
        if (rows.length < 2) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'CSV must have header + data' });
        }
        const [headerRow, ...dataRows] = rows;
        if (dataRows.length > MAX_IMPORT_ROWS) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `CSV import exceeds the 50,000-row limit (${dataRows.length} rows)`,
          });
        }
        // Field metadata is fetched once for the whole import — never per row
        // or per batch.
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
        const skippedHeaders: string[] = [];
        for (let i = 0; i < headerRow!.length; i++) {
          const name = csvUnguard(headerRow![i]!.trim()).toLowerCase();
          const f = fields.find((fd) => fd.name.toLowerCase() === name);
          if (f) colMap.push({ colIdx: i, field: f });
          else skippedHeaders.push(headerRow![i]!.trim());
        }
        let imported = 0;
        // Rows that landed as records but carry no cell values (all columns
        // empty/unparseable). Named for what they are — the rows were imported.
        const emptyCellRows: number[] = [];
        // Batches of IMPORT_BATCH_ROWS rows per transaction: a mid-file failure
        // leaves earlier batches committed on purpose, and the count of rows
        // already imported is carried in the thrown error so the plugin UI can
        // say "imported N rows before failing". Retrying appends from row 0
        // (imports are appends, there is no idempotency key).
        try {
          for (let i = 0; i < dataRows.length; i += IMPORT_BATCH_ROWS) {
            // Batch-local tallies: the rows of a failed batch are rolled back,
            // so `imported` may only advance once the batch's transaction has
            // committed — otherwise the error message below claims rows the
            // table no longer keeps.
            let batchImported = 0;
            const batchEmptyCellRows: number[] = [];
            await db.transaction(async (tx: typeof db) => {
              for (const row of dataRows.slice(i, i + IMPORT_BATCH_ROWS)) {
                const recId = randomUUID();
                await tx
                  .insert(schema.record)
                  .values({ id: recId, tableId: input.tableId, createdBy: ctx.session.user.id });
                let rowWritten = false;
                for (const { colIdx, field: f } of colMap) {
                  const raw = csvUnguard(row[colIdx]?.trim() ?? '');
                  if (!raw) continue;
                  if (
                    f.type === FieldType.Link ||
                    f.type === FieldType.Attachment ||
                    f.type === FieldType.User ||
                    f.type === FieldType.Expression
                  ) {
                    continue;
                  }
                  const coerced = coerceCsvValue(raw, f.type, f.options ?? {}, fieldTypes);
                  if (coerced == null || (Array.isArray(coerced) && coerced.length === 0)) continue;
                  // Core semantics (ADR-0005 empty/error/value): unparseable values
                  // are skipped, same tolerance the old inline parser had.
                  const normalized = fieldTypes.normalizeCellValue(
                    f.type,
                    f.options ?? {},
                    coerced,
                  );
                  if (!('value' in normalized)) continue;
                  // Same byte cap as an interactive cell edit (see
                  // MAX_CELL_VALUE_BYTES above). An oversized value skips the
                  // cell, not the row — the same tolerant semantics as an
                  // unparseable one, which lands the row in emptyCellRows when
                  // nothing else was written.
                  const serialized = JSON.stringify(normalized.value) ?? '';
                  if (Buffer.byteLength(serialized, 'utf8') > MAX_CELL_VALUE_BYTES) continue;
                  const cellId = randomUUID();
                  await tx.insert(schema.cell).values({
                    id: cellId,
                    recordId: recId,
                    fieldId: f.id,
                    value: normalized.value,
                  });
                  // Interactive edits write a history row; an imported cell's
                  // first value gets the same audit trail (same transaction as
                  // the cell, so batching never splits them).
                  await tx.insert(schema.cellHistory).values({
                    id: randomUUID(),
                    cellId,
                    oldValue: null,
                    newValue: normalized.value,
                    changedBy: ctx.session.user.id,
                  });
                  rowWritten = true;
                }
                // ADR-0003: imported rows go through the core write path — expression
                // cells materialize like record.create does, never blank.
                await queries.materializeExpressionsForRecord(
                  tx,
                  input.tableId,
                  recId,
                  ctx.session.user.id,
                );
                batchImported++;
                if (!rowWritten && colMap.length > 0)
                  batchEmptyCellRows.push(imported + batchImported);
              }
            });
            imported += batchImported;
            emptyCellRows.push(...batchEmptyCellRows);
          }
        } catch (err) {
          // `[partial-import]` is a stable token the plugin UI matches on to
          // detect partial-success failures. It leads the message (the root
          // errorFormatter matches with startsWith), and the driver's own
          // message is logged server-side only — never spliced into the
          // client-facing message, where it could leak schema internals.
          console.error('CSV import failed after partial commit', err);
          // The kept rows are committed writes the base's other clients can't
          // see (ADR-0002: every committed write broadcasts) — notify before
          // the error preempties the success-path publish below.
          if (imported > 0) {
            void realtime.publishTableChange(input.tableId, ctx.session.user.id);
          }
          throw new TRPCError({
            code: err instanceof TRPCError ? err.code : 'INTERNAL_SERVER_ERROR',
            message: `[partial-import] CSV import failed after ${imported} row(s) were imported${
              imported === 0 ? '' : ' — the table keeps those rows'
            }`,
            cause: err,
          });
        }
        // ADR-0002: the import committed — the base's other online clients get
        // one table-scoped notice (not one per batch: a 50k-row import is 100
        // batch transactions, and clients refetch the whole table on a notice,
        // so per-batch would just be 100 duplicate refetch storms). Echo is
        // suppressed for the importer, whose own client refetches from this
        // mutation's response. Fire-and-forget like the core routers: a failed
        // notice must not fail an import that already committed.
        void realtime.publishTableChange(input.tableId, ctx.session.user.id);
        return {
          imported,
          rowCount: dataRows.length,
          skippedHeaders,
          emptyCellRows,
        };
      }),
    export: protectedProcedure
      .input(z.object({ tableId: z.string() }))
      .query(async ({ ctx, input }) => {
        await auth.assertTableRole(input.tableId, ctx.session.user.id, 'viewer');
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
        // Fetch limit+1 to detect truncation without a second count query.
        const fetched = await queries.listRecordsPivoted(input.tableId, {}, 0, EXPORT_LIMIT + 1);
        const truncated = fetched.length > EXPORT_LIMIT;
        const records = truncated ? fetched.slice(0, EXPORT_LIMIT) : fetched;
        const header = fields.map((f) => csvEscape(f.name)).join(',');
        const lines = records.map((r) =>
          fields
            .map((f) => csvEscape(cellToCsv(r.cells[f.id], f.type, f.options, fieldTypes)))
            .join(','),
        );
        return { csv: [header, ...lines].join('\n'), truncated, exported: records.length };
      }),
  });
}

export default csvServer;
