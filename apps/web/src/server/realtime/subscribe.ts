import { sql } from '../db';
import { broadcast } from './gateway';
import { REALTIME_CHANNEL, type RealtimeNotice } from './publish';

let started = false;

// Listen on the Postgres realtime channel and fan notices out to locally
// connected ws clients. Call once per process that hosts the gateway.
export async function startRealtimeSubscription(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await sql.listen(REALTIME_CHANNEL, (payload) => {
      let notice: RealtimeNotice;
      try {
        notice = JSON.parse(payload) as RealtimeNotice;
      } catch {
        return;
      }
      const event = notice.tableId
        ? { type: 'change' as const, baseId: notice.baseId, tableId: notice.tableId }
        : { type: 'change' as const, baseId: notice.baseId };
      broadcast(notice.baseId, event, notice.exceptUserId);
    });
    console.log('> realtime pg subscription ready');
  } catch (err) {
    started = false;
    console.error('realtime LISTEN failed (postgres.js will retry on reconnect)', err);
  }
}
