import { TRPCError } from '@trpc/server';
import { collectCsv, CsvBudgetError } from '@markpocket/plugin-csv/export';
import { asc, desc, eq, inArray, sql as querySql } from 'drizzle-orm';

import { FieldType } from '@/lib/field-types';
import { formatNumberToString, parseStringToNumber } from '@/lib/format-number';
import { assertRole, assertTableRole } from '@/lib/roles';
import { db } from '@/server/db';
import { cell, field, record, table } from '@/server/db/schema';
import { normalizeCellValue } from '@/server/plugins/field-value';

export type ExportTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ExportTable = { id: string; name: string };
export type CsvFile = {
  tableId: string;
  name: string;
  csv: string;
  truncated: false;
  total: number;
};

const fieldTypes = { FieldType, formatNumberToString, parseStringToNumber, normalizeCellValue };
const RAW_PAGE_LIMIT = 16 * 1024 * 1024;
const EXPORT_DEADLINE_MS = 60_000;
const PAGE_TIMEOUT_MESSAGE = 'CSV export timed out. Export fewer tables or use an instance backup.';

export async function readCsvFiles(tx: ExportTx, tables: ExportTable[]): Promise<CsvFile[]> {
  const deadline = Date.now() + EXPORT_DEADLINE_MS;
  const budget = { remainingBytes: 8 * 1024 * 1024 };
  const files: CsvFile[] = [];
  for (const selectedTable of tables) {
    const fields = await tx
      .select()
      .from(field)
      .where(eq(field.tableId, selectedTable.id))
      .orderBy(asc(field.orderIndex), asc(field.id));
    const exportFields = fields.map((entry) => ({
      ...entry,
      options: entry.options as Record<string, unknown>,
    }));
    const result = await collectCsv(
      exportFields,
      async (offset, limit) => {
        if (Date.now() >= deadline) {
          throw new TRPCError({ code: 'TIMEOUT', message: PAGE_TIMEOUT_MESSAGE });
        }
        const rows = await tx
          .select({ id: record.id })
          .from(record)
          .where(eq(record.tableId, selectedTable.id))
          .orderBy(desc(record.createdAt), desc(record.id))
          .limit(limit)
          .offset(offset);
        if (!rows.length) return [];
        const recordIds = rows.map((row) => row.id);
        // Check JSON text size in PostgreSQL before transferring a page to Node. A single
        // oversized cell could otherwise bypass the 8 MiB output budget during fetch.
        const [pageSize] = await tx
          .select({
            bytes: querySql<string>`coalesce(sum(octet_length(${cell.value}::text)), 0)::bigint`,
          })
          .from(cell)
          .where(inArray(cell.recordId, recordIds));
        if (Number(pageSize?.bytes ?? 0) > RAW_PAGE_LIMIT) {
          throw new CsvBudgetError(
            'CSV source page exceeds 16 MiB. Export fewer fields or use an instance backup.',
          );
        }
        const values = await tx.select().from(cell).where(inArray(cell.recordId, recordIds));
        const pivot = new Map<string, Record<string, unknown>>();
        for (const value of values) {
          const cells = pivot.get(value.recordId) ?? {};
          cells[value.fieldId] = value.value;
          pivot.set(value.recordId, cells);
        }
        return rows.map((row) => ({ cells: pivot.get(row.id) ?? {} }));
      },
      fieldTypes,
      budget,
    );
    const safeName = selectedTable.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'table';
    const safeId = selectedTable.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    files.push({
      tableId: selectedTable.id,
      name: `${safeName}-${safeId}.csv`,
      csv: result.csv,
      total: result.exported,
      truncated: false,
    });
  }
  return files;
}

let active = false;
async function snapshot(tables: (tx: ExportTx) => Promise<ExportTable[]>): Promise<CsvFile[]> {
  if (active) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Another CSV export is running. Retry shortly.',
    });
  }
  active = true;
  try {
    return await db.transaction(
      async (tx) => {
        await tx.execute(querySql`set local statement_timeout = '30s'`);
        return readCsvFiles(tx, await tables(tx));
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  } catch (error) {
    if (error instanceof CsvBudgetError) {
      throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: error.message });
    }
    if (error instanceof TRPCError) throw error;
    console.error('CSV export failed', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'CSV export failed. No files were exported.',
    });
  } finally {
    active = false;
  }
}

export async function exportTableCsv(tableId: string, userId: string) {
  await assertTableRole(tableId, userId, 'viewer');
  const [file] = await snapshot((tx) =>
    tx.select({ id: table.id, name: table.name }).from(table).where(eq(table.id, tableId)),
  );
  if (!file) throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found' });
  return { csv: file.csv, exported: file.total, truncated: false as const };
}

export async function exportBaseCsv(baseId: string, userId: string, tableIds?: string[]) {
  await assertRole(baseId, userId, 'viewer');
  return snapshot(async (tx) => {
    const rows = await tx
      .select({ id: table.id, name: table.name })
      .from(table)
      .where(eq(table.baseId, baseId))
      .orderBy(asc(table.orderIndex), asc(table.id));
    return rows.filter((row) => !tableIds || tableIds.includes(row.id));
  });
}
