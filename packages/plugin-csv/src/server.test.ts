/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';

import csvServer from './server';
import { TRPCError, type CoreServerApi } from '@markpocket/plugin-sdk';

type FieldRow = {
  id: string;
  name: string;
  type: string;
  options: Record<string, unknown>;
  orderIndex?: number;
};

const FieldType = {
  Text: 'text',
  Number: 'number',
  Boolean: 'boolean',
  Date: 'date',
  SingleSelect: 'single-select',
  MultiSelect: 'multi-select',
  Expression: 'expression',
  User: 'user',
  Link: 'link',
  Attachment: 'attachment',
} as const;

// Minimal in-memory host: records/cells arrays act as the DB, the tx mutates
// them, and materializeExpressionsForRecord writes the expression cell the way
// the real core implementation would (value derived from the record's cells).
// `failAfterRecords` makes the record insert throw once enough rows landed,
// simulating a mid-import batch failure. The transaction carries rollback
// semantics like the real one: a failed batch's writes are truncated away.
function fakeCore(fields: FieldRow[], opts: { failAfterRecords?: number } = {}) {
  const recordTbl: any = { kind: 'record' };
  const cellTbl: any = { kind: 'cell' };
  const fieldTbl: any = { kind: 'field', tableId: {} };
  const tableTbl: any = { kind: 'table' };
  const historyTbl: any = { kind: 'cellHistory' };

  const records: Array<Record<string, any>> = [];
  const cells: Array<Record<string, any>> = [];
  const cellHistoryRows: Array<Record<string, any>> = [];
  const materialized: Array<{ tableId: string; recordId: string; userId: string }> = [];
  const exprFields = fields.filter((f) => f.type === FieldType.Expression);
  const txs: any[] = [];
  // Host-injected realtime face — the spy stands in for publishTableChange.
  const publishSpy = vi.fn().mockResolvedValue(undefined);

  const tx = {
    insert: (tbl: any) => ({
      values: async (v: any) => {
        if (tbl === recordTbl) {
          if (opts.failAfterRecords != null && records.length >= opts.failAfterRecords) {
            throw new Error('boom: db went away');
          }
          records.push(v);
        } else if (tbl === cellTbl) cells.push(v);
        else if (tbl === historyTbl) cellHistoryRows.push(v);
      },
    }),
  };
  const core = {
    db: {
      select: () => ({ from: () => ({ where: async () => fields }) }),
      transaction: async (cb: (t: any) => Promise<void>) => {
        txs.push(tx);
        const mark = {
          records: records.length,
          cells: cells.length,
          cellHistoryRows: cellHistoryRows.length,
          materialized: materialized.length,
        };
        try {
          await cb(tx);
        } catch (err) {
          records.length = mark.records;
          cells.length = mark.cells;
          cellHistoryRows.length = mark.cellHistoryRows;
          materialized.length = mark.materialized;
          throw err;
        }
      },
    },
    schema: {
      record: recordTbl,
      cell: cellTbl,
      field: fieldTbl,
      table: tableTbl,
      cellHistory: historyTbl,
    },
    queries: {
      listRecordsPivoted: async () => [],
      materializeExpressionsForRecord: async (
        _tx: unknown,
        tableId: string,
        recordId: string,
        userId: string,
      ) => {
        materialized.push({ tableId, recordId, userId });
        for (const ef of exprFields) {
          cells.push({ recordId, fieldId: ef.id, value: `computed:${recordId}` });
        }
      },
    },
    fieldTypes: {
      FieldType,
      formatNumberToString: (n: number) => String(n),
      parseStringToNumber: (s: string) => {
        const n = Number(s);
        return Number.isNaN(n) ? null : n;
      },
      normalizeCellValue: (type: string, options: Record<string, unknown>, raw: unknown) => {
        if (raw == null || raw === '') return { empty: true };
        if (type === FieldType.Number) {
          const n = Number(raw);
          return Number.isNaN(n) ? { error: 'Invalid number' } : { value: n };
        }
        if (type === FieldType.SingleSelect) {
          const choices = (options.choices as Array<{ id: string }>) ?? [];
          return choices.some((c) => c.id === raw)
            ? { value: raw as string }
            : { error: 'Unknown select option' };
        }
        return { value: raw as string };
      },
    },
    auth: { assertTableRole: vi.fn().mockResolvedValue(undefined) },
    realtime: { publishTableChange: publishSpy },
  } as unknown as CoreServerApi;
  return { core, records, cells, cellHistoryRows, materialized, txs, publishSpy };
}

function callerFor(core: CoreServerApi) {
  return csvServer(core).createCaller({ session: { user: { id: 'u1' } } } as any);
}

describe('csv plugin — import', () => {
  it('materializes expression cells for every imported row (ADR-0003)', async () => {
    const fields: FieldRow[] = [
      { id: 'f-name', name: 'Name', type: 'text', options: {} },
      { id: 'f-expr', name: 'Computed', type: 'expression', options: { expression: '{f-name}' } },
    ];
    const { core, records, cells, materialized } = fakeCore(fields);

    const res = await callerFor(core).import({
      tableId: 't1',
      csvText: 'Name,Computed\nalice,x\nbob,y',
    });

    expect(res.imported).toBe(2);
    expect(res.rowCount).toBe(2);
    expect(records).toHaveLength(2);
    // Expression column is skipped as a data column but materialized via core.
    expect(materialized).toHaveLength(2);
    expect(materialized[0]).toMatchObject({ tableId: 't1', userId: 'u1' });
    const exprCells = cells.filter((c) => c.fieldId === 'f-expr');
    expect(exprCells).toHaveLength(2);
    for (const rec of records) {
      expect(exprCells.some((c) => c.recordId === rec.id)).toBe(true);
    }
  });

  it('rejects imports above the 50,000-row limit', async () => {
    const { core } = fakeCore([{ id: 'f-name', name: 'Name', type: 'text', options: {} }]);

    const rows = ['Name', ...Array.from({ length: 50_001 }, (_, i) => `row${i}`)].join('\n');
    await expect(callerFor(core).import({ tableId: 't1', csvText: rows })).rejects.toThrow(
      /50,000-row/,
    );
  });

  it('accepts CJK text at exactly the 5MB byte cap (zod .max() would count code units)', async () => {
    const { core } = fakeCore([{ id: 'f-name', name: 'Name', type: 'text', options: {} }]);

    // "Name\n" (5 bytes) + 1,747,625 CJK chars × 3 bytes = exactly 5,242,880
    // bytes — legal input. The single 5MB cell then skips the per-cell 256KB
    // cap (row still imports, cell dropped), so the test stays fast.
    const csvText = `Name\n${'长'.repeat(1_747_625)}`;
    expect(Buffer.byteLength(csvText, 'utf8')).toBe(5 * 1024 * 1024);

    const res = await callerFor(core).import({ tableId: 't1', csvText });
    expect(res.imported).toBe(1);
    expect(res.emptyCellRows).toEqual([1]);
  });

  it('rejects CJK text one byte over the 5MB byte cap', async () => {
    const { core } = fakeCore([{ id: 'f-name', name: 'Name', type: 'text', options: {} }]);

    // Same as above plus one ASCII char → 5,242,881 bytes.
    const csvText = `Name\n${'长'.repeat(1_747_625)}x`;
    expect(Buffer.byteLength(csvText, 'utf8')).toBe(5 * 1024 * 1024 + 1);

    await expect(callerFor(core).import({ tableId: 't1', csvText })).rejects.toThrow(
      /CSV exceeds 5MB/,
    );
  });

  it('still accepts 5MB of ASCII text (the byte cap does not tighten the old limit)', async () => {
    const { core } = fakeCore([{ id: 'f-name', name: 'Name', type: 'text', options: {} }]);

    const csvText = `Name\n${'x'.repeat(5 * 1024 * 1024 - 5)}`;
    expect(Buffer.byteLength(csvText, 'utf8')).toBe(5 * 1024 * 1024);

    const res = await callerFor(core).import({ tableId: 't1', csvText });
    expect(res.imported).toBe(1);
  });

  it('rejects header-only files as BAD_REQUEST (TRPCError, not a bare Error)', async () => {
    const { core } = fakeCore([{ id: 'f-name', name: 'Name', type: 'text', options: {} }]);
    const err = await callerFor(core)
      .import({ tableId: 't1', csvText: 'Name' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe('BAD_REQUEST');
    expect((err as TRPCError).message).toBe('CSV must have header + data');
  });

  it('skips values the core normalizer rejects, keeping the row', async () => {
    const fields: FieldRow[] = [
      { id: 'f-name', name: 'Name', type: 'text', options: {} },
      { id: 'f-num', name: 'Score', type: 'number', options: {} },
    ];
    const { core, cells } = fakeCore(fields);

    const res = await callerFor(core).import({
      tableId: 't1',
      csvText: 'Name,Score\nalice,not-a-number\nbob,7',
    });

    expect(res.imported).toBe(2);
    // bob's number landed, alice's unparseable one was dropped.
    const numCells = cells.filter((c) => c.fieldId === 'f-num');
    expect(numCells).toHaveLength(1);
    expect(numCells[0]!.value).toBe(7);
  });

  it('writes a first-value cell_history row per imported cell, in the same batch', async () => {
    const { core, cellHistoryRows, cells } = fakeCore([
      { id: 'f-name', name: 'Name', type: 'text', options: {} },
    ]);

    await callerFor(core).import({ tableId: 't1', csvText: 'Name\nalice\nbob' });

    expect(cellHistoryRows).toHaveLength(2);
    for (const h of cellHistoryRows) {
      expect(h.oldValue).toBeNull();
      expect(h.changedBy).toBe('u1');
      expect(cells.some((c) => c.id === h.cellId && c.value === h.newValue)).toBe(true);
    }
  });

  it('commits in batches of 500 rows', async () => {
    const { core, records, txs } = fakeCore([
      { id: 'f-name', name: 'Name', type: 'text', options: {} },
    ]);
    const csvText = ['Name', ...Array.from({ length: 1_001 }, (_, i) => `row${i}`)].join('\n');

    const res = await callerFor(core).import({ tableId: 't1', csvText });

    expect(res.imported).toBe(1_001);
    expect(records).toHaveLength(1_001);
    // One transaction per 500-row batch: ceil(1001/500) = 3.
    expect(txs).toHaveLength(3);
  });

  it('reports only committed rows when a mid-import batch fails', async () => {
    // 600 rows = 2 batches; the failure lands inside the second one. Under a
    // real Postgres the failed batch rolls back entirely, so the message must
    // count the 500 committed rows — never the failed batch's partial writes.
    const { core, records } = fakeCore(
      [{ id: 'f-name', name: 'Name', type: 'text', options: {} }],
      {
        failAfterRecords: 550,
      },
    );
    const csvText = ['Name', ...Array.from({ length: 600 }, (_, i) => `row${i}`)].join('\n');

    const err: unknown = await callerFor(core)
      .import({ tableId: 't1', csvText })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).message).toMatch(
      /\[partial-import\] CSV import failed after 500 row\(s\) were imported — the table keeps those rows/,
    );
    // First batch committed, second rolled back.
    expect(records).toHaveLength(500);
  });

  it('reports zero imported rows when the first batch fails (no keeps-those-rows clause)', async () => {
    const { core, records } = fakeCore(
      [{ id: 'f-name', name: 'Name', type: 'text', options: {} }],
      {
        failAfterRecords: 11,
      },
    );
    const csvText = ['Name', ...Array.from({ length: 30 }, (_, i) => `row${i}`)].join('\n');

    const err: unknown = await callerFor(core)
      .import({ tableId: 't1', csvText })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    // Single batch: everything rolled back, so the counter never advanced.
    expect((err as TRPCError).message).toMatch(
      /\[partial-import\] CSV import failed after 0 row\(s\) were imported/,
    );
    expect((err as TRPCError).message).not.toContain('the table keeps those rows');
    expect(records).toHaveLength(0);
  });

  it('skips cells over the 256KB serialized cap, keeping the row importable', async () => {
    const { core, cells } = fakeCore([{ id: 'f-name', name: 'Name', type: 'text', options: {} }]);

    // ~300KB of text in one cell — over the cap the interactive cell router
    // enforces, which the import loop must mirror (byte length, not chars).
    const huge = 'x'.repeat(300 * 1024);
    const res = await callerFor(core).import({ tableId: 't1', csvText: `Name\n${huge}` });

    // Row imported, oversized cell dropped, row lands in emptyCellRows.
    expect(res.imported).toBe(1);
    expect(cells).toHaveLength(0);
    expect(res.emptyCellRows).toEqual([1]);
  });

  it('names valueless rows emptyCellRows (imported rows without cell values)', async () => {
    const { core } = fakeCore([
      { id: 'f-name', name: 'Name', type: 'text', options: {} },
      { id: 'f-lk', name: 'Lk', type: 'link', options: {} },
    ]);

    const res = await callerFor(core).import({ tableId: 't1', csvText: 'Name,Lk\n,r9\nbob,r8' });

    expect(res.imported).toBe(2);
    // Row 1's only value sat in the link column (import never writes links) —
    // the row was imported, it just carries no cell values, which is what
    // emptyCellRows reports. Row 2 has a text cell.
    expect(res.emptyCellRows).toEqual([1]);
    // The deprecated skippedRows alias was removed once the in-app consumer migrated.
    expect(res).not.toHaveProperty('skippedRows');
  });

  it('broadcasts one realtime table change after a successful import (ADR-0002)', async () => {
    const { core, publishSpy } = fakeCore([
      { id: 'f-name', name: 'Name', type: 'text', options: {} },
    ]);

    await callerFor(core).import({ tableId: 't1', csvText: 'Name\nalice\nbob' });

    // Exactly one notice for the whole import (not one per batch), addressed
    // to the table, with the importer's id as echo suppression.
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy).toHaveBeenCalledWith('t1', 'u1');
  });

  it('broadcasts for kept rows when a partial import fails mid-file', async () => {
    const { core, publishSpy } = fakeCore(
      [{ id: 'f-name', name: 'Name', type: 'text', options: {} }],
      { failAfterRecords: 550 },
    );
    const csvText = ['Name', ...Array.from({ length: 600 }, (_, i) => `row${i}`)].join('\n');

    await expect(callerFor(core).import({ tableId: 't1', csvText })).rejects.toThrow(
      /partial-import/,
    );

    // The first batch's 500 rows are committed and kept — those are real
    // writes the base's other clients must be told about.
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy).toHaveBeenCalledWith('t1', 'u1');
  });

  it('broadcasts nothing when the import fails before any commit', async () => {
    const { core, publishSpy } = fakeCore(
      [{ id: 'f-name', name: 'Name', type: 'text', options: {} }],
      {
        failAfterRecords: 0,
      },
    );

    await expect(
      callerFor(core).import({ tableId: 't1', csvText: 'Name\nalice\nbob' }),
    ).rejects.toThrow(/partial-import/);

    expect(publishSpy).not.toHaveBeenCalled();
  });
});

describe('csv plugin — export', () => {
  it('does not broadcast a realtime change (read-only query)', async () => {
    const { core, publishSpy } = fakeCore([
      { id: 'f-name', name: 'Name', type: 'text', options: {}, orderIndex: 0 },
    ]);

    const res = await callerFor(core).export({ tableId: 't1' });

    expect(res.csv).toBe('Name');
    expect(res.truncated).toBe(false);
    expect(publishSpy).not.toHaveBeenCalled();
  });
});
