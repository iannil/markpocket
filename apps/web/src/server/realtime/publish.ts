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
  // Echo suppression: the user whose mutation caused the change (their own
  // client refetches via the tRPC response instead).
  exceptUserId?: string;
  // Control signal — force-close a user's subscriptions on baseId (membership
  // revoked or role changed). Not forwarded to clients.
  kick?: { userId: string };
}

function emit(notice: RealtimeNotice): void {
  // Fire-and-forget by callers; a failed NOTIFY must never crash the process.
  sql
    .notify(REALTIME_CHANNEL, JSON.stringify(notice))
    .catch((err) => console.error('realtime notify failed', err));
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

// Kick a user off a base's channel (member.remove / member.updateRole).
// Existing subscriptions were authorized when opened; this closes the
// TOCTOU window until the client reconnects and re-authorizes.
export function publishKick(baseId: string, userId: string): void {
  emit({ baseId, kick: { userId } });
}
