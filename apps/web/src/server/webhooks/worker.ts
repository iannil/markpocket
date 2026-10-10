import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../db';
import { webhookDelivery, webhookSubscription } from '../db/schema';
import { decryptSecret, getWebhookEncryptionKey, signWebhook } from './crypto';
import { assertWebhookOwner, lockWebhookSubscriptions } from './subscriptions';
import { postWebhook } from './transport';

type Delivery = typeof webhookDelivery.$inferSelect;
type DeliveryError = 'network' | 'timeout' | 'unsafe_target' | 'http_status';
type Outcome = { status: number } | { error: DeliveryError };
type BatchOptions = {
  transport?: typeof postWebhook;
  signal?: AbortSignal;
  now?: () => number;
  /** Server-only fixture isolation; production always leaves this unset. */
  subscriptionId?: string;
};

export function retryDelayMs(attempt: number): number | null {
  return [1000, 10000, 60000, 300000][attempt - 1] ?? null;
}

/** Short transaction: always subscription -> delivery, matching outbox/lifecycle locks.
 * Exported for crash/recovery tests; never called by an API with caller input. */
export async function claimWebhookDeliveries(
  signal?: AbortSignal,
  subscriptionId?: string,
): Promise<Delivery[]> {
  if (signal?.aborted) return [];
  return db.transaction(async (tx) => {
    const subscriptions = await tx
      .select()
      .from(webhookSubscription)
      .where(
        and(
          eq(webhookSubscription.state, 'active'),
          subscriptionId ? eq(webhookSubscription.id, subscriptionId) : undefined,
        ),
      )
      .orderBy(asc(webhookSubscription.id))
      .for('update', { skipLocked: true });
    const key = getWebhookEncryptionKey();
    const eligible: string[] = [];
    for (const subscription of subscriptions) {
      try {
        if (!key) throw new Error('Unavailable');
        // Preflight BEFORE claiming: wrong/missing keys must preserve attempts and leases.
        decryptSecret(subscription.secretCiphertext, key);
        eligible.push(subscription.id);
      } catch {
        await tx
          .update(webhookSubscription)
          .set({ state: 'disabled', updatedAt: new Date() })
          .where(eq(webhookSubscription.id, subscription.id));
      }
    }
    if (!eligible.length || signal?.aborted) return [];
    await tx
      .update(webhookDelivery)
      .set({ state: 'dead', leaseToken: null, leaseUntil: null })
      .where(
        and(
          inArray(webhookDelivery.subscriptionId, eligible),
          eq(webhookDelivery.state, 'leased'),
          sql`${webhookDelivery.attempts} >= 5`,
          sql`${webhookDelivery.leaseUntil} < now()`,
        ),
      );
    const picked = await tx
      .select({ id: webhookDelivery.id })
      .from(webhookDelivery)
      .where(
        and(
          inArray(webhookDelivery.subscriptionId, eligible),
          sql`${webhookDelivery.attempts} < 5`,
          sql`((${webhookDelivery.state} = 'pending' AND ${webhookDelivery.nextAttemptAt} <= now())
          OR (${webhookDelivery.state} = 'leased' AND ${webhookDelivery.leaseUntil} < now()))`,
        ),
      )
      .orderBy(asc(webhookDelivery.nextAttemptAt), asc(webhookDelivery.id))
      .limit(2)
      .for('update', { skipLocked: true });
    if (!picked.length || signal?.aborted) return [];
    return tx
      .update(webhookDelivery)
      .set({
        state: 'leased',
        leaseUntil: sql`now() + interval '30 seconds'`,
        leaseToken: sql`gen_random_uuid()`,
        attempts: sql`${webhookDelivery.attempts} + 1`,
      })
      .where(
        inArray(
          webhookDelivery.id,
          picked.map(({ id }) => id),
        ),
      )
      .returning();
  });
}

/** Token-guarded ack also serves the deterministic stale-worker regression tests. */
export async function acknowledgeWebhookDelivery(
  delivery: Delivery,
  outcome: Outcome,
  now = Date.now(),
): Promise<boolean> {
  const status = 'status' in outcome ? outcome.status : null;
  const succeeded = status !== null && status >= 200 && status < 300;
  const retryable =
    'error' in outcome
      ? outcome.error !== 'unsafe_target'
      : status === 408 || status === 429 || (status !== null && status >= 500 && status < 600);
  const delay = retryable ? retryDelayMs(delivery.attempts) : null;
  const rows = await db
    .update(webhookDelivery)
    .set({
      state: succeeded ? 'succeeded' : delay === null ? 'dead' : 'pending',
      leaseUntil: null,
      leaseToken: null,
      lastStatus: status,
      lastError: succeeded ? null : 'error' in outcome ? outcome.error : 'http_status',
      ...(delay !== null && !succeeded ? { nextAttemptAt: new Date(now + delay) } : {}),
    })
    .where(
      and(
        eq(webhookDelivery.id, delivery.id),
        eq(webhookDelivery.state, 'leased'),
        sql`${webhookDelivery.leaseToken} = ${delivery.leaseToken}::uuid`,
        sql`${webhookDelivery.leaseUntil} > now()`,
      ),
    )
    .returning({ id: webhookDelivery.id });
  return rows.length > 0;
}

async function prepareSend(delivery: Delivery) {
  return db.transaction(async (tx) => {
    // Lifecycle takes this lock, then membership, then subscription, then delivery.
    // Claim never takes membership locks, so it cannot invert that ordering.
    await lockWebhookSubscriptions(tx, delivery.tableId);
    const [initial] = await tx
      .select()
      .from(webhookSubscription)
      .where(eq(webhookSubscription.id, delivery.subscriptionId));
    if (!initial || initial.state !== 'active') return null;
    let owner = true;
    try {
      await assertWebhookOwner(tx, initial.tableId, initial.createdBy);
    } catch (error) {
      if (!(error instanceof TRPCError) || error.code !== 'FORBIDDEN') throw error;
      owner = false;
    }
    const [subscription] = await tx
      .select()
      .from(webhookSubscription)
      .where(eq(webhookSubscription.id, initial.id))
      .for('update');
    if (!subscription || subscription.state !== 'active') return null;
    if (!owner) {
      await tx
        .update(webhookSubscription)
        .set({ state: 'paused', updatedAt: new Date() })
        .where(eq(webhookSubscription.id, initial.id));
      return null;
    }
    let secret: string;
    try {
      const key = getWebhookEncryptionKey();
      if (!key) throw new Error('Unavailable');
      secret = decryptSecret(subscription.secretCiphertext, key);
    } catch {
      await tx
        .update(webhookSubscription)
        .set({ state: 'disabled', updatedAt: new Date() })
        .where(eq(webhookSubscription.id, initial.id));
      return null;
    }
    const [current] = await tx
      .select()
      .from(webhookDelivery)
      .where(
        and(
          eq(webhookDelivery.id, delivery.id),
          eq(webhookDelivery.state, 'leased'),
          sql`${webhookDelivery.leaseToken} = ${delivery.leaseToken}::uuid`,
          sql`${webhookDelivery.leaseUntil} > now()`,
        ),
      )
      .for('update');
    return current ? { secret, url: subscription.url } : null;
  });
}

function classifyError(error: unknown): DeliveryError {
  if (error instanceof Error) {
    if (error.message === 'Webhook request cancelled') return 'timeout';
    if (['Invalid webhook URL', 'Webhook address is not public'].includes(error.message))
      return 'unsafe_target';
  }
  return 'network';
}

export async function sendWebhookDelivery(
  delivery: Delivery,
  options: BatchOptions = {},
): Promise<'succeeded' | 'failed' | null> {
  if (options.signal?.aborted) return null;
  const prepared = await prepareSend(delivery);
  if (!prepared || options.signal?.aborted) return null;
  const body = JSON.stringify({
    eventId: delivery.id,
    type: delivery.eventType,
    baseId: delivery.baseId,
    tableId: delivery.tableId,
    recordId: delivery.recordId,
    occurredAt: delivery.occurredAt.toISOString(),
  });
  const now = options.now ?? Date.now;
  const timestamp = String(Math.floor(now() / 1000));
  let outcome: Outcome;
  try {
    outcome = await (options.transport ?? postWebhook)(
      prepared.url,
      body,
      {
        'Content-Type': 'application/json',
        'X-MarkPocket-Event': delivery.id,
        'X-MarkPocket-Timestamp': timestamp,
        'X-MarkPocket-Signature': `sha256=${signWebhook(prepared.secret, timestamp, body)}`,
      },
      options.signal ?? new AbortController().signal,
    );
  } catch (error) {
    outcome = { error: classifyError(error) };
  }
  if (!(await acknowledgeWebhookDelivery(delivery, outcome, now()))) return null;
  return 'status' in outcome && outcome.status >= 200 && outcome.status < 300
    ? 'succeeded'
    : 'failed';
}

/** Server-only dependency injection: tests must supply a transport, never send externally. */
export async function runWebhookBatch(options: BatchOptions = {}) {
  const result = { claimed: 0, succeeded: 0, failed: 0 };
  for (let round = 0; round < 10 && !options.signal?.aborted; round++) {
    const deliveries = await claimWebhookDeliveries(options.signal, options.subscriptionId);
    if (!deliveries.length) break;
    result.claimed += deliveries.length;
    // Wait for both sends AND acknowledgements before starting the next lease pair.
    const outcomes = await Promise.allSettled(
      deliveries.map((row) => sendWebhookDelivery(row, options)),
    );
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled' && outcome.value) result[outcome.value]++;
    }
    // Do not orphan the other send when a DB ack fails. Its lease recovers on expiry.
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    if (rejected?.status === 'rejected') throw rejected.reason;
  }
  return result;
}

export async function cleanupWebhookDeliveries(subscriptionId?: string): Promise<void> {
  await db.execute(sql`WITH expired AS (
    SELECT id FROM webhook_delivery
    WHERE state IN ('succeeded', 'dead') AND occurred_at < now() - interval '7 days'
      AND ${subscriptionId ? sql`subscription_id = ${subscriptionId}::uuid` : sql`true`}
    ORDER BY occurred_at, id FOR UPDATE SKIP LOCKED LIMIT 1000
  ) DELETE FROM webhook_delivery d USING expired WHERE d.id = expired.id`);
}

export function startWebhookWorker(
  options: BatchOptions & {
    // Test seams for scheduling/shutdown, not runtime configuration.
    runBatch?: typeof runWebhookBatch;
    cleanup?: typeof cleanupWebhookDeliveries;
  } = {},
): { stop(): Promise<void> } {
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> = Promise.resolve();
  let lastCleanup = -Infinity;
  const tick = async () => {
    try {
      if (signal.aborted) return;
      const now = (options.now ?? Date.now)();
      if (now - lastCleanup >= 60_000) {
        await (options.cleanup ?? cleanupWebhookDeliveries)(options.subscriptionId);
        lastCleanup = now;
      }
      if (!signal.aborted) await (options.runBatch ?? runWebhookBatch)({ ...options, signal });
    } catch {
      // Never log DB/transport error objects: they may contain targets or ciphertext.
      console.error('Webhook worker batch failed');
    } finally {
      if (!signal.aborted) {
        timer = setTimeout(() => {
          active = tick();
        }, 1000);
        timer.unref();
      }
    }
  };
  active = tick();
  return {
    async stop() {
      controller.abort();
      clearTimeout(timer);
      await active;
    },
  };
}
