import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withDbFixture } from '../../testing/pg-fixture';

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('webhook management', () => {
  beforeEach(() => vi.stubEnv('WEBHOOK_ENCRYPTION_KEY', randomBytes(32).toString('base64')));
  afterEach(() => vi.unstubAllEnvs());
  it.each(
    (['rotate', 'pause', 'resume'] as const).flatMap((action) =>
      [0, 4].map((attempts) => ({ action, attempts })),
    ),
  )(
    '$action invalidates attempt $attempts without stranding exhausted events',
    async ({ action, attempts }) =>
      withDbFixture(async (f) => {
        const { db } = await import('../../db');
        const { webhookDelivery } = await import('../../db/schema');
        const worker = await import('../../webhooks/worker');
        const { signWebhook } = await import('../../webhooks/crypto');
        const sub = await f.caller.webhook.create({
          tableId: f.tableId,
          url: 'https://example.com/hook',
          events: ['record.changed'],
        });
        await f.caller.record.create({ tableId: f.tableId });
        await db
          .update(webhookDelivery)
          .set({ attempts })
          .where(eq(webhookDelivery.subscriptionId, sub.id));
        const [lease] = await worker.claimWebhookDeliveries(undefined, sub.id);
        expect(lease.attempts).toBe(attempts + 1);
        let secret = sub.secret;
        if (action === 'rotate') secret = (await f.caller.webhook.rotate({ id: sub.id })).secret;
        else if (action === 'pause') await f.caller.webhook.pause({ id: sub.id });
        else await f.caller.webhook.resume({ id: sub.id, acknowledgeGap: false });
        expect(await worker.acknowledgeWebhookDelivery(lease, { status: 200 })).toBe(false);
        const [invalidated] = await db
          .select()
          .from(webhookDelivery)
          .where(eq(webhookDelivery.id, lease.id));
        expect(invalidated).toMatchObject({
          state: attempts === 4 ? 'dead' : 'pending',
          attempts: attempts + 1,
          leaseUntil: null,
        });
        expect(invalidated.leaseToken).not.toBe(lease.leaseToken);
        if (attempts === 4) {
          expect(await worker.claimWebhookDeliveries(undefined, sub.id)).toEqual([]);
          await f.caller.webhook.retry({ deliveryId: lease.id });
          const [retried] = await db
            .select()
            .from(webhookDelivery)
            .where(eq(webhookDelivery.id, lease.id));
          expect(retried).toMatchObject({ id: lease.id, state: 'pending', attempts: 0 });
        }
        if (action === 'pause')
          await f.caller.webhook.resume({ id: sub.id, acknowledgeGap: false });
        const transport = vi.fn(
          async (_url: string, body: string, headers: Record<string, string>) => {
            expect(JSON.parse(body).eventId).toBe(lease.id);
            expect(headers['X-MarkPocket-Signature']).toBe(
              `sha256=${signWebhook(secret, headers['X-MarkPocket-Timestamp'], body)}`,
            );
            return { status: 200 };
          },
        );
        expect(
          (await worker.runWebhookBatch({ subscriptionId: sub.id, transport })).succeeded,
        ).toBe(1);
        expect(transport).toHaveBeenCalledOnce();
      }),
  );
  it('refuses dead retry when pending/leased queue is full', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../../db');
      const { webhookDelivery } = await import('../../db/schema');
      const sub = await f.caller.webhook.create({
        tableId: f.tableId,
        url: 'https://example.com/hook',
        events: ['record.changed'],
      });
      await f.caller.record.create({ tableId: f.tableId });
      const [delivery] = await f.caller.webhook.deliveries({ id: sub.id });
      await db
        .update(webhookDelivery)
        .set({ state: 'dead', attempts: 5 })
        .where(eq(webhookDelivery.id, delivery.id));
      await db.execute(
        sql`INSERT INTO webhook_delivery (id, subscription_id, transaction_id, base_id, table_id, record_id, event_type, occurred_at, state) SELECT gen_random_uuid(), ${sub.id}::uuid, -n, ${f.baseId}, ${f.tableId}, 'capacity-' || n, 'record.changed', now(), CASE WHEN n = 1 THEN 'leased' ELSE 'pending' END FROM generate_series(1, 10000) AS n`,
      );
      await expect(f.caller.webhook.retry({ deliveryId: delivery.id })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(
        (await db.select().from(webhookDelivery).where(eq(webhookDelivery.id, delivery.id)))[0],
      ).toMatchObject({ state: 'dead', attempts: 5 });
    }));
  it('restricts management to owners and returns secrets only once', async () =>
    withDbFixture(async (f) => {
      await expect(f.viewer.webhook.list({ tableId: f.tableId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        f.viewer.webhook.create({
          tableId: f.tableId,
          url: 'https://example.com/hook',
          events: ['record.changed'],
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const created = await f.caller.webhook.create({
        tableId: f.tableId,
        url: 'https://example.com/hook',
        events: ['record.changed'],
      });
      expect(created.secret).toMatch(/^[a-f0-9]{64}$/);
      const [listed] = await f.caller.webhook.list({ tableId: f.tableId });
      expect(Object.keys(listed).sort()).toEqual(
        ['id', 'url', 'events', 'state', 'overflowAt', 'createdAt'].sort(),
      );
    }));

  it('denies all lifecycle and log operations to editors, viewers and outsiders', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../../db');
      const { baseMember } = await import('../../db/schema');
      const sub = await f.caller.webhook.create({
        tableId: f.tableId,
        url: 'https://example.com/hook',
        events: ['record.changed'],
      });
      await f.caller.record.create({ tableId: f.tableId });
      const [delivery] = await f.caller.webhook.deliveries({ id: sub.id });
      for (const role of ['viewer', 'editor', 'removed'] as const) {
        if (role === 'removed')
          await db.delete(baseMember).where(eq(baseMember.userId, f.viewerId));
        else await db.update(baseMember).set({ role }).where(eq(baseMember.userId, f.viewerId));
        for (const call of [
          () => f.viewer.webhook.list({ tableId: f.tableId }),
          () =>
            f.viewer.webhook.create({
              tableId: f.tableId,
              url: 'https://example.com/hook',
              events: ['record.changed'],
            }),
          () => f.viewer.webhook.pause({ id: sub.id }),
          () => f.viewer.webhook.resume({ id: sub.id, acknowledgeGap: true }),
          () => f.viewer.webhook.rotate({ id: sub.id }),
          () => f.viewer.webhook.remove({ id: sub.id }),
          () => f.viewer.webhook.deliveries({ id: sub.id }),
          () => f.viewer.webhook.retry({ deliveryId: delivery.id }),
        ]) {
          await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
        }
      }
      await expect(f.caller.webhook.pause({ id: randomUUID() })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(f.caller.webhook.retry({ deliveryId: randomUUID() })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }));

  it('invalidates old acknowledgements on rotate and pause, retaining event IDs', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../../db');
      const { webhookDelivery } = await import('../../db/schema');
      const worker = await import('../../webhooks/worker');
      const { signWebhook } = await import('../../webhooks/crypto');
      const sub = await f.caller.webhook.create({
        tableId: f.tableId,
        url: 'https://example.com/hook',
        events: ['record.changed'],
      });
      await f.caller.record.create({ tableId: f.tableId });
      const [old] = await worker.claimWebhookDeliveries(undefined, sub.id);
      const rotated = await f.caller.webhook.rotate({ id: sub.id });
      expect(rotated.secret).not.toBe(sub.secret);
      expect(await worker.acknowledgeWebhookDelivery(old, { status: 200 })).toBe(false);
      const [pending] = await db
        .select()
        .from(webhookDelivery)
        .where(eq(webhookDelivery.id, old.id));
      expect(pending).toMatchObject({ state: 'pending', leaseUntil: null, attempts: 1 });
      expect(pending.leaseToken).not.toBe(old.leaseToken);
      const [leased] = await worker.claimWebhookDeliveries(undefined, sub.id);
      await f.caller.webhook.pause({ id: sub.id });
      expect(await worker.acknowledgeWebhookDelivery(leased, { status: 200 })).toBe(false);
      const transport = vi.fn(
        async (_url: string, body: string, headers: Record<string, string>) => {
          expect(JSON.parse(body).eventId).toBe(old.id);
          expect(headers['X-MarkPocket-Signature']).toBe(
            `sha256=${signWebhook(rotated.secret, headers['X-MarkPocket-Timestamp'], body)}`,
          );
          return { status: 200 };
        },
      );
      expect((await worker.runWebhookBatch({ subscriptionId: sub.id, transport })).claimed).toBe(0);
      await f.caller.webhook.resume({ id: sub.id, acknowledgeGap: false });
      expect((await worker.runWebhookBatch({ subscriptionId: sub.id, transport })).succeeded).toBe(
        1,
      );
      expect(transport).toHaveBeenCalledOnce();
    }));

  it('retries only a dead event and projects bounded redacted logs', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../../db');
      const { webhookDelivery } = await import('../../db/schema');
      const sub = await f.caller.webhook.create({
        tableId: f.tableId,
        url: 'https://example.com/hook',
        events: ['record.changed'],
      });
      await f.caller.record.create({ tableId: f.tableId });
      const [delivery] = await f.caller.webhook.deliveries({ id: sub.id, offset: 0, limit: 50 });
      expect(Object.keys(delivery).sort()).toEqual(
        ['id', 'type', 'state', 'attempts', 'lastStatus', 'lastError', 'time'].sort(),
      );
      for (const state of ['pending', 'leased', 'succeeded'] as const) {
        await db.update(webhookDelivery).set({ state }).where(eq(webhookDelivery.id, delivery.id));
        await expect(f.caller.webhook.retry({ deliveryId: delivery.id })).rejects.toMatchObject({
          code: 'CONFLICT',
        });
      }
      await db
        .update(webhookDelivery)
        .set({
          state: 'dead',
          attempts: 5,
          leaseToken: randomUUID(),
          leaseUntil: new Date(),
          lastStatus: 500,
        })
        .where(eq(webhookDelivery.id, delivery.id));
      const results = await Promise.allSettled([
        f.caller.webhook.retry({ deliveryId: delivery.id }),
        f.caller.webhook.retry({ deliveryId: delivery.id }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [retried] = await db
        .select()
        .from(webhookDelivery)
        .where(eq(webhookDelivery.id, delivery.id));
      expect(retried).toMatchObject({
        id: delivery.id,
        state: 'pending',
        attempts: 0,
        leaseUntil: null,
        leaseToken: null,
        lastStatus: null,
      });
      expect(await f.caller.webhook.deliveries({ id: sub.id, offset: 1, limit: 50 })).toEqual([]);
      await expect(f.caller.webhook.deliveries({ id: sub.id, limit: 51 })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      await f.caller.webhook.remove({ id: sub.id });
      expect(
        await db.select().from(webhookDelivery).where(eq(webhookDelivery.id, delivery.id)),
      ).toEqual([]);
    }));

  it('requires acknowledged overflow and explicit current-owner recovery after role loss or key failure', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../../db');
      const { baseMember, webhookSubscription } = await import('../../db/schema');
      const worker = await import('../../webhooks/worker');
      const sub = await f.caller.webhook.create({
        tableId: f.tableId,
        url: 'https://example.com/hook',
        events: ['record.changed'],
      });
      await f.caller.record.create({ tableId: f.tableId });
      await db.update(baseMember).set({ role: 'owner' }).where(eq(baseMember.userId, f.viewerId));
      await db.update(baseMember).set({ role: 'viewer' }).where(eq(baseMember.userId, f.userId));
      const transport = vi.fn(async () => ({ status: 200 }));
      await worker.runWebhookBatch({ subscriptionId: sub.id, transport });
      expect(transport).not.toHaveBeenCalled();
      expect((await f.viewer.webhook.list({ tableId: f.tableId }))[0].state).toBe('paused');
      const gap = new Date();
      await db
        .update(webhookSubscription)
        .set({ state: 'overflow', overflowAt: gap })
        .where(eq(webhookSubscription.id, sub.id));
      await f.viewer.webhook.pause({ id: sub.id });
      await f.viewer.webhook.rotate({ id: sub.id });
      await expect(
        f.viewer.webhook.resume({ id: sub.id, acknowledgeGap: false }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect((await f.viewer.webhook.list({ tableId: f.tableId }))[0].overflowAt).toEqual(gap);
      vi.stubEnv('WEBHOOK_ENCRYPTION_KEY', '');
      await expect(
        f.viewer.webhook.resume({ id: sub.id, acknowledgeGap: true }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      vi.stubEnv('WEBHOOK_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
      await expect(
        f.viewer.webhook.resume({ id: sub.id, acknowledgeGap: true }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      await f.viewer.webhook.rotate({ id: sub.id });
      await f.viewer.webhook.resume({ id: sub.id, acknowledgeGap: true });
      const [active] = await db
        .select()
        .from(webhookSubscription)
        .where(eq(webhookSubscription.id, sub.id));
      expect(active).toMatchObject({ state: 'active', overflowAt: null, createdBy: f.viewerId });
      expect((await worker.runWebhookBatch({ subscriptionId: sub.id, transport })).succeeded).toBe(
        1,
      );
    }));

  it('serializes five slots across all states and concurrent lifecycle with collection/claims', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../../db');
      const { record, webhookDelivery, webhookSubscription } = await import('../../db/schema');
      const worker = await import('../../webhooks/worker');
      const subscriptions = await Promise.all(
        Array.from({ length: 5 }, () =>
          f.caller.webhook.create({
            tableId: f.tableId,
            url: 'https://example.com/hook',
            events: ['record.changed'],
          }),
        ),
      );
      for (const [index, state] of (['paused', 'overflow', 'disabled'] as const).entries())
        await db
          .update(webhookSubscription)
          .set({ state })
          .where(eq(webhookSubscription.id, subscriptions[index].id));
      await expect(
        f.caller.webhook.create({
          tableId: f.tableId,
          url: 'https://example.com/hook',
          events: ['record.changed'],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const id = subscriptions[4].id;
      await Promise.all([
        ...Array.from({ length: 3 }, () =>
          db
            .insert(record)
            .values(Array.from({ length: 10 }, () => ({ id: randomUUID(), tableId: f.tableId }))),
        ),
        f.caller.webhook.rotate({ id }),
        worker.runWebhookBatch({ subscriptionId: id, transport: async () => ({ status: 200 }) }),
      ]);
      expect(
        await db.select().from(webhookDelivery).where(eq(webhookDelivery.subscriptionId, id)),
      ).toHaveLength(30);
      await f.caller.webhook.remove({ id: subscriptions[0].id });
      await expect(
        f.caller.webhook.create({
          tableId: f.tableId,
          url: 'https://example.com/new',
          events: ['record.deleted'],
        }),
      ).resolves.toHaveProperty('secret');
    }));

  it('rechecks owner membership after waiting for the lifecycle lock', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../../db');
      const { baseMember, webhookSubscription } = await import('../../db/schema');
      const { lockWebhookSubscriptions } = await import('../../webhooks/subscriptions');
      const sub = await f.caller.webhook.create({
        tableId: f.tableId,
        url: 'https://example.com/hook',
        events: ['record.changed'],
      });
      let locked!: () => void;
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blocker = db.transaction(async (tx) => {
        await lockWebhookSubscriptions(tx, f.tableId);
        locked();
        await gate;
      });
      await ready;
      const mutation = f.caller.webhook.pause({ id: sub.id }).then(
        () => 'accepted',
        (error) => error.code,
      );
      try {
        // Observe an actual PostgreSQL advisory wait, not a timing assumption.
        let waiting = false;
        for (let i = 0; i < 100; i++) {
          const result = await db.execute(
            sql`SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = hashtext('webhook-subscriptions:' || ${f.tableId})::oid`,
          );
          if (result.length) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(waiting).toBe(true);
        await db
          .update(baseMember)
          .set({ role: 'viewer' })
          .where(and(eq(baseMember.userId, f.userId), eq(baseMember.baseId, f.baseId)));
      } finally {
        release();
        await blocker;
      }
      expect(await mutation).toBe('FORBIDDEN');
      expect(
        (await db.select().from(webhookSubscription).where(eq(webhookSubscription.id, sub.id)))[0]
          .state,
      ).toBe('active');
    }));
});
