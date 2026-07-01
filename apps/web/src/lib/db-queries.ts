import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm';

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

// Two-stage query (ADR-0005 / Q1): SQL paginates record ids with the view's
// filter/sort injected as raw SQL fragments, then we batch-fetch cells and pivot.
// Missing cell = empty (Q4: empty = no row).
export async function listRecordsPivoted(
  tableId: string,
  opts: { where?: SQL | null; orderBy?: SQL | null },
  offset = 0,
  limit = 100,
) {
  const conds: SQL[] = [eq(record.tableId, tableId)];
  if (opts.where) conds.push(opts.where);
  const orderBys: SQL[] = [];
  if (opts.orderBy) orderBys.push(opts.orderBy);
  orderBys.push(desc(record.createdAt));

  const records = await db
    .select()
    .from(record)
    .where(and(...conds))
    .orderBy(...orderBys)
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

export async function countRecords(tableId: string, where?: SQL | null) {
  const conds: SQL[] = [eq(record.tableId, tableId)];
  if (where) conds.push(where);
  const [row] = await db
    .select({ value: count() })
    .from(record)
    .where(and(...conds));
  return row?.value ?? 0;
}
