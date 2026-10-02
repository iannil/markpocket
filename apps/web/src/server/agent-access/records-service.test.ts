/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { mockQuery } from '../trpc/routers/__test-utils';

vi.mock('@/server/db', () => {
  const chain = mockQuery([]);
  return {
    db: {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
    },
  };
});
const dbQueriesMock = vi.hoisted(() => ({
  listRecordsPivoted: vi.fn().mockResolvedValue([{ id: 'r1', cells: { f1: 'v1' } }]),
}));
vi.mock('@/lib/db-queries', () => dbQueriesMock);
const rolesMock = vi.hoisted(() => ({
  assertTableRole: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/roles', () => rolesMock);

import { db } from '@/server/db';
import {
  MAX_CELLS_PER_REQUEST,
  createRecordWithCells,
  deleteRecord,
  getRecord,
  updateRecordCells,
} from './records-service';

function caller(overrides: Record<string, any> = {}) {
  return {
    record: {
      create: vi.fn().mockResolvedValue({ id: 'r1', tableId: 'tb1' }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
    },
    cell: {
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbQueriesMock.listRecordsPivoted.mockResolvedValue([{ id: 'r1', cells: { f1: 'v1' } }]);
  (db.select as any).mockReturnValue(
    mockQuery([{ id: 'r1', tableId: 'tb1', createdAt: new Date(), updatedAt: new Date() }]),
  );
});

describe('createRecordWithCells', () => {
  it('creates the record then writes every cell', async () => {
    const c = caller();
    const result = await createRecordWithCells(c, 'u1', 'tb1', { f1: 'a', f2: 2 });
    expect(c.record.create).toHaveBeenCalledWith({ tableId: 'tb1' });
    expect(c.cell.upsert).toHaveBeenCalledTimes(2);
    expect(result.cellErrors).toEqual({});
    expect(result.record.cells).toEqual({ f1: 'v1' });
  });

  it('collects per-cell rejections instead of failing the request', async () => {
    const c = caller();
    c.cell.upsert.mockImplementation(async ({ fieldId }: { fieldId: string }) => {
      if (fieldId === 'fBad') throw new TRPCError({ code: 'BAD_REQUEST', message: 'not a number' });
      return undefined;
    });
    const result = await createRecordWithCells(c, 'u1', 'tb1', { f1: 'ok', fBad: 'x' });
    expect(result.cellErrors).toEqual({ fBad: 'not a number' });
    expect(result.record.id).toBe('r1');
  });

  it('rejects cells maps above the fan-out cap', async () => {
    const cells = Object.fromEntries(
      Array.from({ length: MAX_CELLS_PER_REQUEST + 1 }, (_, i) => [`f${i}`, i]),
    );
    await expect(createRecordWithCells(caller(), 'u1', 'tb1', cells)).rejects.toThrow(TRPCError);
  });
});

describe('updateRecordCells', () => {
  it('pre-checks membership then upserts cells', async () => {
    const c = caller();
    await updateRecordCells(c, 'u1', 'r1', { f1: 'next' });
    expect(rolesMock.assertTableRole).toHaveBeenCalledWith('tb1', 'u1', 'editor');
    expect(c.cell.upsert).toHaveBeenCalledWith({ recordId: 'r1', fieldId: 'f1', value: 'next' });
  });

  it('answers NOT_FOUND for an unknown record', async () => {
    (db.select as any).mockReturnValue(mockQuery([]));
    await expect(updateRecordCells(caller(), 'u1', 'missing', {})).rejects.toThrow(TRPCError);
  });
});

describe('getRecord', () => {
  it('requires viewer+ on the owning table', async () => {
    await getRecord('u1', 'r1');
    expect(rolesMock.assertTableRole).toHaveBeenCalledWith('tb1', 'u1', 'viewer');
  });
});

describe('deleteRecord', () => {
  it('resolves the table and delegates to record.delete', async () => {
    const c = caller();
    await deleteRecord(c, 'r1');
    expect(c.record.delete).toHaveBeenCalledWith({ id: 'r1', tableId: 'tb1' });
  });
});
