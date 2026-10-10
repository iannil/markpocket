import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withDbFixture, type DbFixture } from '../testing/pg-fixture';

async function workerFor(subscriptionId: string) {
  const worker = await import('./worker');
  return {
    ...worker,
    runWebhookBatch: (options: Parameters<typeof worker.runWebhookBatch>[0] = {}) =>
      worker.runWebhookBatch({ ...options, subscriptionId }),
    claimWebhookDeliveries: () => worker.claimWebhookDeliveries(undefined, subscriptionId),
    cleanupWebhookDeliveries: () => worker.cleanupWebhookDeliveries(subscriptionId),
    startWebhookWorker: (options: Parameters<typeof worker.startWebhookWorker>[0] = {}) =>
      worker.startWebhookWorker({ ...options, subscriptionId }),
  };
}

async function seed(f: DbFixture, count = 1) {
  const { db } = await import('../db');
  const { record } = await import('../db/schema');
  const { createSubscription } = await import('./subscriptions');
  const sub = await createSubscription(f.userId, {
    tableId: f.tableId,
    url: 'https://example.com/hook?private=never-log',
    events: ['record.changed', 'record.deleted'],
  });
  await db
    .insert(record)
    .values(Array.from({ length: count }, () => ({ id: randomUUID(), tableId: f.tableId })));
  return sub;
}

async function rows(subscriptionId: string) {
  const { db } = await import('../db');
  const { webhookDelivery } = await import('../db/schema');
  return db
    .select()
    .from(webhookDelivery)
    .where(eq(webhookDelivery.subscriptionId, subscriptionId));
}

async function expire(subscriptionId: string) {
  const { db } = await import('../db');
  const { webhookDelivery } = await import('../db/schema');
  await db
    .update(webhookDelivery)
    .set({ leaseUntil: new Date(0), nextAttemptAt: new Date(0) })
    .where(eq(webhookDelivery.subscriptionId, subscriptionId));
}

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('webhook worker (PostgreSQL)', () => {
  beforeEach(() => vi.stubEnv('WEBHOOK_ENCRYPTION_KEY', randomBytes(32).toString('base64')));
  afterEach(() => vi.unstubAllEnvs());

  it.each(['wrong', 'missing'] as const)(
    'disables a %s key before consuming any pending attempt',
    async (keyState) =>
      withDbFixture(async (f) => {
        const { db } = await import('../db');
        const { webhookDelivery, webhookSubscription } = await import('../db/schema');
        const { createSubscription } = await import('./subscriptions');
        const sub = await createSubscription(f.userId, {
          tableId: f.tableId,
          url: 'https://example.com/hook',
          events: ['record.changed'],
        });
        await f.caller.record.create({ tableId: f.tableId });
        const before = await db
          .select()
          .from(webhookDelivery)
          .where(eq(webhookDelivery.subscriptionId, sub.id));
        const originalKey = process.env.WEBHOOK_ENCRYPTION_KEY!;
        vi.stubEnv(
          'WEBHOOK_ENCRYPTION_KEY',
          keyState === 'wrong' ? randomBytes(32).toString('base64') : '',
        );
        const { runWebhookBatch } = await workerFor(sub.id);
        const transport = vi.fn();
        expect(await runWebhookBatch({ transport })).toEqual({
          claimed: 0,
          succeeded: 0,
          failed: 0,
        });
        expect(transport).not.toHaveBeenCalled();
        expect(
          await db.select().from(webhookDelivery).where(eq(webhookDelivery.subscriptionId, sub.id)),
        ).toEqual(before);
        expect(
          (await db.select().from(webhookSubscription).where(eq(webhookSubscription.id, sub.id)))[0]
            .state,
        ).toBe('disabled');
        vi.stubEnv('WEBHOOK_ENCRYPTION_KEY', originalKey);
        expect(await runWebhookBatch({ transport })).toEqual({
          claimed: 0,
          succeeded: 0,
          failed: 0,
        });
        expect(await rows(sub.id)).toEqual(before);
        // Only an explicit owner lifecycle action may restore activity (I6 owns that API).
        await db
          .update(webhookSubscription)
          .set({ state: 'active' })
          .where(eq(webhookSubscription.id, sub.id));
        transport.mockResolvedValue({ status: 200 });
        expect(await runWebhookBatch({ transport })).toEqual({
          claimed: 1,
          succeeded: 1,
          failed: 0,
        });
        expect((await rows(sub.id))[0]).toMatchObject({ id: before[0].id, attempts: 1 });
      }),
  );

  it('signs only stable public metadata, serializes two-send lease pairs, and caps a batch at twenty', async () =>
    withDbFixture(async (f) => {
      const sub = await seed(f, 25);
      const { runWebhookBatch } = await workerFor(sub.id);
      let active = 0,
        maximum = 0;
      const transport = vi.fn(
        async (_url: string, body: string, headers: Record<string, string>) => {
          active++;
          maximum = Math.max(maximum, active);
          const payload = JSON.parse(body);
          expect(Object.keys(payload)).toEqual([
            'eventId',
            'type',
            'baseId',
            'tableId',
            'recordId',
            'occurredAt',
          ]);
          expect(payload).toMatchObject({
            type: 'record.changed',
            baseId: f.baseId,
            tableId: f.tableId,
          });
          expect(headers).toMatchObject({
            'X-MarkPocket-Event': payload.eventId,
            'X-MarkPocket-Timestamp': '1800000000',
            'X-MarkPocket-Signature':
              'sha256=' +
              createHmac('sha256', sub.secret)
                .update('1800000000.' + body)
                .digest('hex'),
          });
          const leased = (await rows(sub.id)).filter((row) => row.state === 'leased');
          expect(leased.length).toBeLessThanOrEqual(2);
          // Keep each pair in flight long enough to observe actual concurrency.
          await new Promise((resolve) => setTimeout(resolve, 5));
          active--;
          return { status: 204 };
        },
      );
      expect(await runWebhookBatch({ transport, now: () => 1800000000000 })).toEqual({
        claimed: 20,
        succeeded: 20,
        failed: 0,
      });
      expect(maximum).toBe(2);
      expect(transport).toHaveBeenCalledTimes(20);
      expect((await rows(sub.id)).filter((row) => row.state === 'pending')).toHaveLength(5);
    }));

  it('reclaims an expired lease once across concurrent workers and rejects the old token ack', async () =>
    withDbFixture(async (f) => {
      const sub = await seed(f);
      const { claimWebhookDeliveries, acknowledgeWebhookDelivery } = await workerFor(sub.id);
      const [old] = await claimWebhookDeliveries();
      expect(old.attempts).toBe(1);
      expect(await claimWebhookDeliveries()).toEqual([]);
      await expire(sub.id);
      const claims = (
        await Promise.all([claimWebhookDeliveries(), claimWebhookDeliveries()])
      ).flat();
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({ id: old.id, attempts: 2, state: 'leased' });
      expect(claims[0].leaseToken).not.toBe(old.leaseToken);
      expect(await acknowledgeWebhookDelivery(old, { status: 200 })).toBe(false);
      expect(await acknowledgeWebhookDelivery(claims[0], { status: 200 })).toBe(true);
      expect((await rows(sub.id))[0].state).toBe('succeeded');
    }));

  it('redelivers the same event and body after send succeeds but acknowledgement is lost', async () =>
    withDbFixture(async (f) => {
      const sub = await seed(f);
      const { claimWebhookDeliveries, sendWebhookDelivery, runWebhookBatch } = await workerFor(
        sub.id,
      );
      const [delivery] = await claimWebhookDeliveries();
      const bodies: string[] = [];
      expect(
        await sendWebhookDelivery(delivery, {
          transport: async (_url, body) => {
            bodies.push(body);
            // Represent a process that sent successfully but lost its lease before ack.
            await expire(sub.id);
            return { status: 200 };
          },
        }),
      ).toBeNull();
      expect((await rows(sub.id))[0]).toMatchObject({
        id: delivery.id,
        state: 'leased',
        attempts: 1,
      });
      expect(
        await runWebhookBatch({
          transport: async (_url, body) => {
            bodies.push(body);
            return { status: 200 };
          },
        }),
      ).toEqual({ claimed: 1, succeeded: 1, failed: 0 });
      expect(bodies[1]).toBe(bodies[0]);
      expect((await rows(sub.id))[0]).toMatchObject({
        id: delivery.id,
        state: 'succeeded',
        attempts: 2,
      });
    }));

  it.each([408, 429, 500, 503, 302, 400, 401, 404])(
    'handles HTTP %s without persisting response details',
    async (status) =>
      withDbFixture(async (f) => {
        const sub = await seed(f);
        const { runWebhookBatch } = await workerFor(sub.id);
        const now = Date.now();
        expect(
          await runWebhookBatch({ transport: async () => ({ status }), now: () => now }),
        ).toEqual({ claimed: 1, succeeded: 0, failed: 1 });
        const [row] = await rows(sub.id);
        const retryable = status === 408 || status === 429 || status >= 500;
        expect(row).toMatchObject({
          state: retryable ? 'pending' : 'dead',
          attempts: 1,
          lastStatus: status,
          lastError: 'http_status',
          leaseToken: null,
        });
        if (retryable) expect(row.nextAttemptAt.getTime()).toBe(now + 1000);
      }),
  );

  it.each([
    ['https://example.com/hook?secret=do-not-store', 'network', 'pending'],
    ['Webhook request cancelled', 'timeout', 'pending'],
    ['Webhook address is not public', 'unsafe_target', 'dead'],
  ])('stores only the fixed error category for %s', async (message, lastError, state) =>
    withDbFixture(async (f) => {
      const sub = await seed(f);
      const { runWebhookBatch } = await workerFor(sub.id);
      await runWebhookBatch({
        transport: async () => {
          throw new Error(message);
        },
      });
      expect((await rows(sub.id))[0]).toMatchObject({ lastError, state, lastStatus: null });
    }),
  );

  it('backs off at every attempt and stops at five, including an exhausted crashed lease', async () =>
    withDbFixture(async (f) => {
      const sub = await seed(f);
      const { runWebhookBatch, claimWebhookDeliveries } = await workerFor(sub.id);
      const { db } = await import('../db');
      const { webhookDelivery } = await import('../db/schema');
      const now = Date.now();
      const transport = vi.fn(async () => ({ status: 503 }));
      for (const delay of [1000, 10000, 60000, 300000]) {
        await runWebhookBatch({ transport, now: () => now });
        expect((await rows(sub.id))[0].nextAttemptAt.getTime()).toBe(now + delay);
        await expire(sub.id);
      }
      await runWebhookBatch({ transport });
      expect((await rows(sub.id))[0]).toMatchObject({ state: 'dead', attempts: 5 });
      expect(transport).toHaveBeenCalledTimes(5);
      await db
        .update(webhookDelivery)
        .set({ state: 'leased', leaseToken: randomUUID(), leaseUntil: new Date(0) })
        .where(eq(webhookDelivery.subscriptionId, sub.id));
      expect(await claimWebhookDeliveries()).toEqual([]);
      expect((await rows(sub.id))[0]).toMatchObject({
        state: 'dead',
        attempts: 5,
        leaseToken: null,
        leaseUntil: null,
      });
    }));

  it.each(['paused', 'overflow', 'disabled', 'deleted', 'owner_lost', 'lease_cleared'] as const)(
    'rechecks %s immediately before dispatch',
    async (change) =>
      withDbFixture(async (f) => {
        const sub = await seed(f);
        const { claimWebhookDeliveries, sendWebhookDelivery } = await workerFor(sub.id);
        const { db } = await import('../db');
        const { webhookDelivery, webhookSubscription, baseMember } = await import('../db/schema');
        const [delivery] = await claimWebhookDeliveries();
        if (change === 'deleted')
          await db.delete(webhookSubscription).where(eq(webhookSubscription.id, sub.id));
        else if (change === 'owner_lost')
          await db
            .update(baseMember)
            .set({ role: 'editor' })
            .where(and(eq(baseMember.baseId, f.baseId), eq(baseMember.userId, f.userId)));
        else if (change === 'lease_cleared')
          await db
            .update(webhookDelivery)
            .set({ state: 'pending', leaseToken: null, leaseUntil: null })
            .where(eq(webhookDelivery.id, delivery.id));
        else
          await db
            .update(webhookSubscription)
            .set({ state: change })
            .where(eq(webhookSubscription.id, sub.id));
        const transport = vi.fn();
        expect(await sendWebhookDelivery(delivery, { transport })).toBeNull();
        expect(transport).not.toHaveBeenCalled();
        if (change === 'owner_lost')
          expect(
            (
              await db.select().from(webhookSubscription).where(eq(webhookSubscription.id, sub.id))
            )[0].state,
          ).toBe('paused');
      }),
  );

  it('uses the current secret after rotation clears old leases', async () =>
    withDbFixture(async (f) => {
      const sub = await seed(f);
      const { db } = await import('../db');
      const { webhookDelivery, webhookSubscription } = await import('../db/schema');
      const { encryptSecret, getWebhookEncryptionKey } = await import('./crypto');
      const { claimWebhookDeliveries, sendWebhookDelivery, runWebhookBatch } = await workerFor(
        sub.id,
      );
      const [old] = await claimWebhookDeliveries();
      const secret = 'rotated-secret';
      await db.transaction(async (tx) => {
        await tx
          .update(webhookSubscription)
          .set({ secretCiphertext: encryptSecret(secret, getWebhookEncryptionKey()!) })
          .where(eq(webhookSubscription.id, sub.id));
        await tx
          .update(webhookDelivery)
          .set({ state: 'pending', leaseToken: null, leaseUntil: null })
          .where(eq(webhookDelivery.subscriptionId, sub.id));
      });
      const transport = vi.fn(
        async (_url: string, body: string, headers: Record<string, string>) => {
          expect(headers['X-MarkPocket-Signature']).toBe(
            'sha256=' +
              createHmac('sha256', secret)
                .update(headers['X-MarkPocket-Timestamp'] + '.' + body)
                .digest('hex'),
          );
          return { status: 200 };
        },
      );
      expect(await sendWebhookDelivery(old, { transport })).toBeNull();
      expect(await runWebhookBatch({ transport })).toEqual({ claimed: 1, succeeded: 1, failed: 0 });
      expect(transport).toHaveBeenCalledTimes(1);
    }));

  it('stops an active transport, persists its failed ack, and leaves the next pair unclaimed', async () =>
    withDbFixture(async (f) => {
      const sub = await seed(f, 4);
      const { startWebhookWorker } = await workerFor(sub.id);
      let bothStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        bothStarted = resolve;
      });
      let count = 0;
      const transport = vi.fn(
        async (
          _url: string,
          _body: string,
          _headers: Record<string, string>,
          signal: AbortSignal,
        ) => {
          count++;
          if (count === 2) bothStarted();
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener('abort', () => resolve(), { once: true });
          });
          throw new Error('Webhook request cancelled');
        },
      );
      const worker = startWebhookWorker({ transport });
      try {
        await started;
      } finally {
        await worker.stop();
      }
      expect(transport).toHaveBeenCalledTimes(2);
      const deliveries = await rows(sub.id);
      expect(deliveries.filter((row) => row.attempts === 0)).toHaveLength(2);
      expect(
        deliveries.filter(
          (row) => row.attempts === 1 && row.state === 'pending' && row.lastError === 'timeout',
        ),
      ).toHaveLength(2);
      expect(deliveries.every((row) => row.leaseToken === null)).toBe(true);
    }));

  it('preserves an expired leased event when key preflight fails and scopes fixture mutations', async () =>
    withDbFixture(async (f) => {
      const sub = await seed(f);
      const other = await seed(f);
      const { db } = await import('../db');
      const { webhookSubscription } = await import('../db/schema');
      const { claimWebhookDeliveries, runWebhookBatch } = await workerFor(sub.id);
      await claimWebhookDeliveries();
      await expire(sub.id);
      const before = await rows(sub.id);
      vi.stubEnv('WEBHOOK_ENCRYPTION_KEY', '');
      const transport = vi.fn();
      expect(await runWebhookBatch({ transport })).toEqual({ claimed: 0, succeeded: 0, failed: 0 });
      expect(await rows(sub.id)).toEqual(before);
      expect(
        (await db.select().from(webhookSubscription).where(eq(webhookSubscription.id, other.id)))[0]
          .state,
      ).toBe('active');
      expect((await rows(other.id))[0].attempts).toBe(0);
    }));

  it('shares subscription-before-delivery ordering with concurrent triggers and owner lifecycle transactions', async () =>
    withDbFixture(async (f) => {
      const sub = await seed(f);
      const { db } = await import('../db');
      const { record, webhookSubscription, webhookDelivery } = await import('../db/schema');
      const { createSubscription, lockWebhookSubscriptions, assertWebhookOwner } =
        await import('./subscriptions');
      for (let n = 0; n < 4; n++)
        await createSubscription(f.userId, {
          tableId: f.tableId,
          url: 'https://example.com/hook',
          events: ['record.changed'],
        });
      const { claimWebhookDeliveries, acknowledgeWebhookDelivery } = await workerFor(sub.id);
      await Promise.all([
        ...Array.from({ length: 3 }, () =>
          db.transaction(async (tx) => {
            await tx
              .insert(record)
              .values(Array.from({ length: 20 }, () => ({ id: randomUUID(), tableId: f.tableId })));
          }),
        ),
        (async () => {
          for (let n = 0; n < 4; n++) {
            const claimed = await claimWebhookDeliveries();
            for (const delivery of claimed)
              await acknowledgeWebhookDelivery(delivery, { status: 200 });
          }
        })(),
        (async () => {
          for (let n = 0; n < 4; n++)
            await db.transaction(async (tx) => {
              await lockWebhookSubscriptions(tx, f.tableId);
              await assertWebhookOwner(tx, f.tableId, f.userId);
              await tx
                .select()
                .from(webhookSubscription)
                .where(eq(webhookSubscription.id, sub.id))
                .for('update');
              await tx
                .update(webhookDelivery)
                .set({ state: 'pending', leaseToken: null, leaseUntil: null })
                .where(
                  and(
                    eq(webhookDelivery.subscriptionId, sub.id),
                    eq(webhookDelivery.state, 'leased'),
                  ),
                );
            });
        })(),
      ]);
      expect(await rows(sub.id)).toHaveLength(61);
    }));

  it('cleans at most 1000 old terminal rows and preserves pending events and overflow markers', async () =>
    withDbFixture(async (f) => {
      const sub = await seed(f);
      const { db } = await import('../db');
      const { webhookSubscription } = await import('../db/schema');
      const { cleanupWebhookDeliveries } = await workerFor(sub.id);
      await db.execute(sql`insert into webhook_delivery(id, subscription_id, transaction_id, base_id, table_id, record_id, event_type, occurred_at, state)
      select gen_random_uuid(), ${sub.id}, txid_current(), ${f.baseId}, ${f.tableId}, 'old-' || n, 'record.changed', now() - interval '8 days',
      case when n = 1003 then 'pending' when n % 2 = 0 then 'succeeded' else 'dead' end
      from generate_series(1, 1003) n`);
      await db
        .update(webhookSubscription)
        .set({ state: 'overflow', overflowAt: new Date(0) })
        .where(eq(webhookSubscription.id, sub.id));
      await cleanupWebhookDeliveries();
      const remaining = await rows(sub.id);
      expect(remaining).toHaveLength(4);
      expect(remaining.filter((row) => row.state === 'pending')).toHaveLength(2);
      expect(
        (await db.select().from(webhookSubscription).where(eq(webhookSubscription.id, sub.id)))[0],
      ).toMatchObject({ state: 'overflow', overflowAt: new Date(0) });
    }));
});
