import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import { listRecordsPivoted } from '@/lib/db-queries';
import { assertTableRole } from '@/lib/roles';
import { record } from '../db/schema';
import { db } from '../db';
import type { AgentCaller } from './agent-caller';

// A cells map per create/update request. Above this the fan-out into
// individual cell.upsert calls (each a transaction) becomes a wall-clock
// problem for the single-process deployment; legit tables stay well under it.
export const MAX_CELLS_PER_REQUEST = 200;

export interface PivotedRecord {
  id: string;
  tableId: string;
  createdAt: Date;
  updatedAt: Date;
  cells: Record<string, unknown>;
}

async function fetchPivotedRecord(recordId: string, tableId: string): Promise<PivotedRecord> {
  const [row] = await db.select().from(record).where(eq(record.id, recordId)).limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found' });
  const [pivoted] = await listRecordsPivoted(tableId, { where: eq(record.id, recordId) }, 0, 1);
  return {
    id: row.id,
    tableId: row.tableId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cells: pivoted?.cells ?? {},
  };
}

async function requireRecordTableId(recordId: string): Promise<string> {
  const [row] = await db
    .select({ tableId: record.tableId })
    .from(record)
    .where(eq(record.id, recordId))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found' });
  return row.tableId;
}

/**
 * Write a cells map through cell.upsert one field at a time, collecting
 * per-field rejections instead of failing the whole request — the record
 * exists after create, so "3 of 4 cells stored" is more useful to an agent
 * than an opaque rollback. Each upsert re-runs its own editor role check and
 * value normalization, exactly as a UI edit would.
 */
async function upsertCells(
  caller: AgentCaller,
  recordId: string,
  cells: Record<string, unknown>,
): Promise<Record<string, string>> {
  const cellErrors: Record<string, string> = {};
  for (const [fieldId, value] of Object.entries(cells)) {
    try {
      await caller.cell.upsert({ recordId, fieldId, value });
    } catch (err) {
      cellErrors[fieldId] = err instanceof TRPCError ? err.message : 'Write failed';
    }
  }
  return cellErrors;
}

function assertCellsBounded(cells: Record<string, unknown>): void {
  const count = Object.keys(cells).length;
  if (count > MAX_CELLS_PER_REQUEST) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Too many cells in one request (limit ${MAX_CELLS_PER_REQUEST}, got ${count})`,
    });
  }
}

export interface RecordWriteResult {
  record: PivotedRecord;
  /** fieldId → rejection message for cells that did not store. */
  cellErrors: Record<string, string>;
}

export async function getRecord(userId: string, recordId: string): Promise<PivotedRecord> {
  const tableId = await requireRecordTableId(recordId);
  await assertTableRole(tableId, userId, 'viewer');
  return fetchPivotedRecord(recordId, tableId);
}

export async function createRecordWithCells(
  caller: AgentCaller,
  userId: string,
  tableId: string,
  cells: Record<string, unknown>,
): Promise<RecordWriteResult> {
  assertCellsBounded(cells);
  // record.create runs assertTableRole(editor) itself; the empty record lands
  // (with expression cells materialized) before any user cells are written.
  const created = await caller.record.create({ tableId });
  const cellErrors = await upsertCells(caller, created.id, cells);
  return { record: await fetchPivotedRecord(created.id, tableId), cellErrors };
}

export async function updateRecordCells(
  caller: AgentCaller,
  userId: string,
  recordId: string,
  cells: Record<string, unknown>,
): Promise<RecordWriteResult> {
  assertCellsBounded(cells);
  // Pre-checks give a clean NOT_FOUND/FORBIDDEN before any write; each
  // cell.upsert still re-checks both against its own field.
  const tableId = await requireRecordTableId(recordId);
  await assertTableRole(tableId, userId, 'editor');
  const cellErrors = await upsertCells(caller, recordId, cells);
  return { record: await fetchPivotedRecord(recordId, tableId), cellErrors };
}

export async function deleteRecord(caller: AgentCaller, recordId: string): Promise<{ ok: true }> {
  const tableId = await requireRecordTableId(recordId);
  await caller.record.delete({ id: recordId, tableId });
  return { ok: true };
}
