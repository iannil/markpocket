import { sql } from '../db';
import { broadcast, closeBaseForUser, rebroadcastAllChannels } from './gateway';
import { REALTIME_CHANNEL, type RealtimeNotice } from './publish';

let started = false;
const RETRY_DELAY_START_MS = 5_000;
const RETRY_DELAY_MAX_MS = 60_000;

function handleNotice(payload: string): void {
  let notice: RealtimeNotice;
  try {
    notice = JSON.parse(payload) as RealtimeNotice;
  } catch {
    return;
  }
  // Control event: revoke open subscriptions instead of forwarding.
  if (notice.kick) {
    closeBaseForUser(notice.baseId, notice.kick.userId);
    return;
  }
  const event = notice.tableId
    ? { type: 'change' as const, baseId: notice.baseId, tableId: notice.tableId }
    : { type: 'change' as const, baseId: notice.baseId };
  broadcast(notice.baseId, event, notice.exceptUserId);
}

// Listen on the Postgres realtime channel and fan notices out to locally
// connected ws clients. Call once per process that hosts the gateway.
// postgres.js re-runs LISTEN itself when the dedicated listener connection
// drops, and this retry loop covers the initial LISTEN (e.g. the DB isn't up
// yet when the process boots) with backoff.
export async function startRealtimeSubscription(): Promise<void> {
  if (started) return;
  started = true;
  let retryDelayMs = RETRY_DELAY_START_MS;
  // postgres.js fires the onlisten callback on every successful LISTEN —
  // the initial one and each re-listen after a connection drop. That
  // distinction is exactly the reconciliation point we need: a *repeat*
  // callback means the listener was down while ws clients stayed connected,
  // and Postgres does not replay notifications sent in that gap — those
  // clients are now stale with no signal ever coming. So on every repeat we
  // synthesize a change per active channel to force a refetch. The initial
  // callback reconciles nothing: nothing was missed before the subscription
  // existed, and a client that connected during the first LISTEN's retry
  // window went through its own (post-subscription) refetch on connect.
  let everListened = false;
  const onListenReady = (): void => {
    if (everListened) rebroadcastAllChannels();
    everListened = true;
  };
  const listen = async (): Promise<void> => {
    try {
      await sql.listen(REALTIME_CHANNEL, handleNotice, onListenReady);
      console.log('> realtime pg subscription ready');
      retryDelayMs = RETRY_DELAY_START_MS;
    } catch (err) {
      console.error(`realtime LISTEN failed — retrying in ${retryDelayMs}ms`, err);
      const delay = retryDelayMs;
      retryDelayMs = Math.min(retryDelayMs * 2, RETRY_DELAY_MAX_MS);
      setTimeout(() => void listen(), delay).unref?.();
    }
  };
  await listen();
}
