import type { CoreFieldTypes } from '@markpocket/plugin-sdk';
import { cellToCsv, csvEscape } from './csv';

export type ExportField = {
  id: string;
  name: string;
  type: string;
  options: Record<string, unknown>;
};
export type ExportRow = { cells: Record<string, unknown> };
export type ExportBudget = { remainingBytes: number };
export class CsvBudgetError extends Error {}

export async function collectCsv(
  fields: ExportField[],
  readPage: (offset: number, limit: number) => Promise<ExportRow[]>,
  fieldTypes: CoreFieldTypes,
  budget: ExportBudget,
): Promise<{ csv: string; exported: number }> {
  const lines: string[] = [];
  function append(line: string) {
    const bytes = Buffer.byteLength(line, 'utf8') + (lines.length ? 1 : 0);
    if (bytes > budget.remainingBytes) {
      throw new CsvBudgetError(
        'CSV export exceeds 8 MiB. Export fewer tables or use an instance backup.',
      );
    }
    budget.remainingBytes -= bytes;
    lines.push(line);
  }
  append(fields.map((f) => csvEscape(f.name)).join(','));
  let exported = 0;
  for (;;) {
    const rows = await readPage(exported, 250);
    if (exported + rows.length > 100000) {
      throw new CsvBudgetError(
        'CSV export exceeds 100,000 records in one table. Use an instance backup.',
      );
    }
    for (const row of rows) {
      append(
        fields
          .map((f) => csvEscape(cellToCsv(row.cells[f.id], f.type, f.options, fieldTypes)))
          .join(','),
      );
    }
    exported += rows.length;
    if (rows.length < 250) break;
  }
  return { csv: lines.join('\n'), exported };
}
