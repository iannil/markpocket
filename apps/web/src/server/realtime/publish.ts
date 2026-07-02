import { eq } from 'drizzle-orm';

import { table } from '../db/schema';
import { db, sql } from '../db';

// Realtime change notices travel over a Postgres LISTEN/NOTIFY channel so the
// process that hosts the ws gateway (a separate process in dev) can broadcast
// them, regardless of which process ran the mutation.
export const REALTIME_CHANNEL = 'markpocket_realtime';

export interface RealtimeNotice {
  baseId: string;
  tableId?: string;
  exceptUserId?: string;
}

function emit(notice: RealtimeNotice): Promise<unknown> {
  return sql.notify(REALTIME_CHANNEL, JSON.stringify(notice));
}

// Resolve the owning base and broadcast a table-scoped change.
export async function publishTableChange(tableId: string, exceptUserId?: string) {
  const [row] = await db
    .select({ baseId: table.baseId })
    .from(table)
    .where(eq(table.id, tableId))
    .limit(1);
  if (!row) return;
  await emit({ baseId: row.baseId, tableId, exceptUserId });
}

// Broadcast a base-scoped change (table/base structural changes).
export async function publishBaseChange(baseId: string, exceptUserId?: string) {
  await emit({ baseId, exceptUserId });
}
