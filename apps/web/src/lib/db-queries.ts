import { count, desc, eq, inArray } from 'drizzle-orm';

import { cell, record, workspace } from '@/server/db/schema';
import { db } from '@/server/db';

// Single-tenant: one workspace row, created lazily.
export async function ensureDefaultWorkspace() {
  const existing = await db.select().from(workspace).limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(workspace)
    .values({ id: 'default', name: 'markpocket' })
    .returning();
  return created;
}

// Two-stage query (ADR-0005 / Q1): SQL paginates record ids, then we batch-fetch
// their cells and pivot to wide rows. Missing cell = empty (Q4: empty = no row).
export async function listRecordsPivoted(tableId: string, offset = 0, limit = 100) {
  const records = await db
    .select()
    .from(record)
    .where(eq(record.tableId, tableId))
    .orderBy(desc(record.createdAt))
    .limit(limit)
    .offset(offset);

  const recordIds = records.map((r) => r.id);
  const cells =
    recordIds.length > 0
      ? await db.select().from(cell).where(inArray(cell.recordId, recordIds))
      : [];

  const cellsByRecord = new Map<string, Record<string, unknown>>();
  for (const c of cells) {
    const map = cellsByRecord.get(c.recordId) ?? {};
    map[c.fieldId] = c.value;
    cellsByRecord.set(c.recordId, map);
  }

  return records.map((r) => ({ id: r.id, cells: cellsByRecord.get(r.id) ?? {} }));
}

export async function countRecords(tableId: string) {
  const [row] = await db.select({ value: count() }).from(record).where(eq(record.tableId, tableId));
  return row?.value ?? 0;
}
