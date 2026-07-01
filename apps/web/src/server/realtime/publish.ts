import { eq } from 'drizzle-orm';

import { table } from '../db/schema';
import { db } from '../db';
import { broadcast } from './gateway';

// Resolve the owning base and broadcast a table-scoped change.
export async function publishTableChange(tableId: string, exceptUserId?: string) {
  const [row] = await db
    .select({ baseId: table.baseId })
    .from(table)
    .where(eq(table.id, tableId))
    .limit(1);
  if (!row) return;
  broadcast(row.baseId, { type: 'change', tableId }, exceptUserId);
}

// Broadcast a base-scoped change (table/base structural changes).
export function publishBaseChange(baseId: string, exceptUserId?: string) {
  broadcast(baseId, { type: 'change' }, exceptUserId);
}
