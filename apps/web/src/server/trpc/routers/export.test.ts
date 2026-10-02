/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { session } from './__test-utils';

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  // publish.ts (pulled in transitively by the plugins barrel export.ts loads)
  // imports { db, sql } — the mock must carry both or module eval fails.
  sql: { notify: vi.fn().mockResolvedValue(undefined) },
}));
const rolesMock = vi.hoisted(() => ({
  // Full surface of the real module: the plugins barrel's core-api.ts also
  // imports assertTableRole from '@/lib/roles' at module scope.
  assertRole: vi.fn().mockResolvedValue(undefined),
  assertTableRole: vi.fn().mockResolvedValue(undefined),
  getMembership: vi.fn().mockResolvedValue('owner'),
  baseIdFromTable: vi.fn().mockResolvedValue('b1'),
}));
vi.mock('@/server/db', () => ({ db: dbMock }));
vi.mock('@/lib/roles', () => rolesMock);
// exportBase's data path is fully covered by these two (pivoted rows + total);
// the CSV assembly itself runs against the real @markpocket/plugin-csv/csv.
vi.mock('@/lib/db-queries', () => ({
  listRecordsPivoted: vi.fn().mockResolvedValue([]),
  countRecords: vi.fn().mockResolvedValue(0),
}));

import { exportRouter } from './export';
import { countRecords, listRecordsPivoted } from '@/lib/db-queries';

// exportBase issues db.select in a fixed order: the base's tables first, then
// one fields select per table (loop order). Each call pops the next queued
// result; the last entry repeats.
function queueSelects(values: unknown[][]) {
  let i = 0;
  (dbMock.select as any).mockImplementation(() => {
    const v = values[Math.min(i++, values.length - 1)] ?? [];
    const chain: Record<string, any> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      then: (onfulfilled: any) => Promise.resolve(v).then(onfulfilled),
    };
    return chain;
  });
}

const TABLES = [{ id: 't1', name: 'My Table!' }];
// Deliberately out of order — the router must sort by orderIndex, not trust
// the DB's return order (it has no ORDER BY on the fields select).
const FIELDS = [
  { id: 'f2', name: 'Qty', type: 'number', options: { precision: 2 }, orderIndex: 1 },
  { id: 'f1', name: 'Name', type: 'text', options: {}, orderIndex: 0 },
  { id: 'f3', name: 'Note', type: 'text', options: {}, orderIndex: 2 },
];

beforeEach(() => {
  vi.clearAllMocks();
  rolesMock.assertRole.mockResolvedValue(undefined);
  vi.mocked(listRecordsPivoted).mockResolvedValue([]);
  vi.mocked(countRecords).mockResolvedValue(0);
});

describe('exportRouter.exportBase — authorization', () => {
  it('gates on base membership with viewer as the minimum role (viewers may export)', async () => {
    queueSelects([TABLES, []]); // tables select, then a fields select for t1

    await exportRouter.createCaller(session()).exportBase({ baseId: 'b1' });

    expect(rolesMock.assertRole).toHaveBeenCalledWith('b1', 'u1', 'viewer');
  });

  it('rejects with FORBIDDEN and touches no data when the user is not a member', async () => {
    rolesMock.assertRole.mockRejectedValueOnce(
      new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this base' }),
    );

    await expect(exportRouter.createCaller(session()).exportBase({ baseId: 'b1' })).rejects.toThrow(
      'Not a member of this base',
    );

    // The gate runs before any table/field/record read.
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(listRecordsPivoted).not.toHaveBeenCalled();
  });
});

describe('exportRouter.exportBase — CSV assembly', () => {
  it('builds one file per table: fields sorted by orderIndex, rows via cellToCsv, sanitized filename', async () => {
    queueSelects([TABLES, FIELDS]);
    vi.mocked(listRecordsPivoted).mockResolvedValue([
      { id: 'r1', createdAt: new Date(), cells: { f1: 'Widget, "Pro"', f2: 42, f3: '=SUM(A1)' } },
      { id: 'r2', createdAt: new Date(), cells: {} },
    ]);
    vi.mocked(countRecords).mockResolvedValue(2);

    const files = await exportRouter.createCaller(session()).exportBase({ baseId: 'b1' });

    expect(files).toHaveLength(1);
    const [file] = files;
    expect(file.tableId).toBe('t1');
    // Unsafe filename characters collapse to '_'; a fully-sanitized-empty
    // name would fall back to the table id.
    expect(file.name).toBe('My_Table_.csv');
    // Header order follows orderIndex (Name, Qty, Note — not the select's
    // Qty, Name, Note). Quoting/injection-guarding is the plugin's
    // csvEscape: comma+quote cells quoted, '=…' prefixed with an apostrophe.
    expect(file.csv).toBe('Name,Qty,Note\n"Widget, ""Pro""",42.00,\'=SUM(A1)\n,,');
    expect(file.truncated).toBe(false);
    expect(file.total).toBe(2);
    expect(listRecordsPivoted).toHaveBeenCalledWith('t1', {}, 0, 10_000);
  });

  it('marks a file truncated when the row total exceeds the exported page', async () => {
    queueSelects([TABLES, FIELDS]);
    vi.mocked(listRecordsPivoted).mockResolvedValue([
      { id: 'r1', createdAt: new Date(), cells: {} },
    ]);
    vi.mocked(countRecords).mockResolvedValue(3);

    const files = await exportRouter.createCaller(session()).exportBase({ baseId: 'b1' });

    expect(files[0].truncated).toBe(true);
    expect(files[0].total).toBe(3);
  });

  it('exports an empty table as the header line only (no trailing newline)', async () => {
    queueSelects([TABLES, FIELDS]);
    vi.mocked(listRecordsPivoted).mockResolvedValue([]);
    vi.mocked(countRecords).mockResolvedValue(0);

    const files = await exportRouter.createCaller(session()).exportBase({ baseId: 'b1' });

    expect(files[0].csv).toBe('Name,Qty,Note');
    expect(files[0].truncated).toBe(false);
    expect(files[0].total).toBe(0);
  });

  it('exports one file per table across multiple tables in order', async () => {
    const tables = [
      { id: 't1', name: 'Alpha' },
      { id: 't2', name: 'Beta' },
    ];
    queueSelects([
      tables, // tables select
      FIELDS, // fields for t1
      [{ id: 'g1', name: 'Solo', type: 'text', options: {}, orderIndex: 0 }], // fields for t2
    ]);
    vi.mocked(listRecordsPivoted)
      .mockResolvedValueOnce([{ id: 'r1', createdAt: new Date(), cells: { f1: 'a' } }])
      .mockResolvedValueOnce([{ id: 'r2', createdAt: new Date(), cells: { g1: 'b' } }]);
    vi.mocked(countRecords).mockResolvedValue(1);

    const files = await exportRouter.createCaller(session()).exportBase({ baseId: 'b1' });

    expect(files.map((f) => f.tableId)).toEqual(['t1', 't2']);
    expect(files[0].name).toBe('Alpha.csv');
    expect(files[1].name).toBe('Beta.csv');
    expect(files[0].csv).toBe('Name,Qty,Note\na,,');
    expect(files[1].csv).toBe('Solo\nb');
  });
});
