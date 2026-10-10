import { randomBytes, randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db';
import { webhookDelivery, webhookSubscription } from '../../db/schema';
import { decryptSecret, encryptSecret, getWebhookEncryptionKey } from '../../webhooks/crypto';
import {
  assertWebhookOwner,
  createSubscription,
  lockWebhookSubscriptions,
  type WebhookTx,
} from '../../webhooks/subscriptions';
import { protectedProcedure, router } from '../init';

const idInput = z.object({ id: z.string().uuid() });
const forbidden = () => new TRPCError({ code: 'FORBIDDEN', message: 'Requires owner role' });
type Subscription = typeof webhookSubscription.$inferSelect;

// Identity lookup reveals nothing to callers. Membership is held through commit,
// then subscription and delivery rows are locked in the worker's shared order.
async function withSubscription<T>(
  userId: string,
  id: string,
  run: (tx: WebhookTx, row: Subscription) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const [identity] = await tx
      .select({ tableId: webhookSubscription.tableId })
      .from(webhookSubscription)
      .where(eq(webhookSubscription.id, id));
    if (!identity) throw forbidden();
    await lockWebhookSubscriptions(tx, identity.tableId);
    await assertWebhookOwner(tx, identity.tableId, userId);
    const [row] = await tx
      .select()
      .from(webhookSubscription)
      .where(eq(webhookSubscription.id, id))
      .for('update');
    if (!row) throw forbidden();
    return run(tx, row);
  });
}

function requireKey() {
  const key = getWebhookEncryptionKey();
  if (!key)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Ask an administrator to configure WEBHOOK_ENCRYPTION_KEY (32-byte base64).',
    });
  return key;
}

async function invalidateLeases(tx: WebhookTx, id: string) {
  await tx
    .update(webhookDelivery)
    .set({
      // Lifecycle changes invalidate the lease, not its automatic attempt budget.
      state: sql`case when ${webhookDelivery.attempts} >= 5 then 'dead' else 'pending' end`,
      leaseUntil: null,
      leaseToken: randomUUID(),
      nextAttemptAt: new Date(),
    })
    .where(and(eq(webhookDelivery.subscriptionId, id), eq(webhookDelivery.state, 'leased')));
}

export const webhookRouter = router({
  list: protectedProcedure.input(z.object({ tableId: z.string() })).query(({ ctx, input }) =>
    db.transaction(async (tx) => {
      await assertWebhookOwner(tx, input.tableId, ctx.session.user.id);
      return tx
        .select({
          id: webhookSubscription.id,
          url: webhookSubscription.url,
          events: webhookSubscription.events,
          state: webhookSubscription.state,
          overflowAt: webhookSubscription.overflowAt,
          createdAt: webhookSubscription.createdAt,
        })
        .from(webhookSubscription)
        .where(eq(webhookSubscription.tableId, input.tableId))
        .orderBy(webhookSubscription.createdAt, webhookSubscription.id);
    }),
  ),
  create: protectedProcedure
    .input(
      z.object({
        tableId: z.string(),
        url: z.string().max(2048),
        events: z
          .array(z.enum(['record.changed', 'record.deleted']))
          .min(1)
          .max(2),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Authorize before exposing key/configuration errors; create rechecks under lock.
      await db.transaction((tx) => assertWebhookOwner(tx, input.tableId, ctx.session.user.id));
      return createSubscription(ctx.session.user.id, input);
    }),
  pause: protectedProcedure.input(idInput).mutation(({ ctx, input }) =>
    withSubscription(ctx.session.user.id, input.id, async (tx, row) => {
      await tx
        .update(webhookSubscription)
        .set({
          state: row.state === 'overflow' || row.overflowAt ? 'overflow' : 'paused',
          updatedAt: new Date(),
        })
        .where(eq(webhookSubscription.id, row.id));
      await invalidateLeases(tx, row.id);
      return { ok: true as const };
    }),
  ),
  resume: protectedProcedure
    .input(idInput.extend({ acknowledgeGap: z.boolean() }))
    .mutation(({ ctx, input }) =>
      withSubscription(ctx.session.user.id, input.id, async (tx, row) => {
        if ((row.state === 'overflow' || row.overflowAt) && !input.acknowledgeGap)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Reconcile your records and acknowledge the gap before resuming.',
          });
        const key = requireKey();
        try {
          decryptSecret(row.secretCiphertext, key);
        } catch {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              'Restore the original WEBHOOK_ENCRYPTION_KEY or rotate the signing secret before resuming.',
          });
        }
        // An explicit recovery adopts the current owner as the configuring owner.
        await tx
          .update(webhookSubscription)
          .set({
            state: 'active',
            overflowAt: null,
            createdBy: ctx.session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(webhookSubscription.id, row.id));
        await invalidateLeases(tx, row.id);
        return { ok: true as const };
      }),
    ),
  rotate: protectedProcedure.input(idInput).mutation(({ ctx, input }) =>
    withSubscription(ctx.session.user.id, input.id, async (tx, row) => {
      const secret = randomBytes(32).toString('hex');
      await tx
        .update(webhookSubscription)
        .set({ secretCiphertext: encryptSecret(secret, requireKey()), updatedAt: new Date() })
        .where(eq(webhookSubscription.id, row.id));
      await invalidateLeases(tx, row.id);
      return { secret };
    }),
  ),
  remove: protectedProcedure.input(idInput).mutation(({ ctx, input }) =>
    withSubscription(ctx.session.user.id, input.id, async (tx, row) => {
      await tx.delete(webhookSubscription).where(eq(webhookSubscription.id, row.id));
      return { ok: true as const };
    }),
  ),
  deliveries: protectedProcedure
    .input(
      idInput.extend({
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(({ ctx, input }) =>
      withSubscription(ctx.session.user.id, input.id, async (tx) =>
        tx
          .select({
            id: webhookDelivery.id,
            type: webhookDelivery.eventType,
            state: webhookDelivery.state,
            attempts: webhookDelivery.attempts,
            lastStatus: webhookDelivery.lastStatus,
            lastError: webhookDelivery.lastError,
            time: webhookDelivery.occurredAt,
          })
          .from(webhookDelivery)
          .where(eq(webhookDelivery.subscriptionId, input.id))
          .orderBy(desc(webhookDelivery.occurredAt), desc(webhookDelivery.id))
          .offset(input.offset)
          .limit(input.limit),
      ),
    ),
  retry: protectedProcedure
    .input(z.object({ deliveryId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [identity] = await db
        .select({ subscriptionId: webhookDelivery.subscriptionId })
        .from(webhookDelivery)
        .where(eq(webhookDelivery.id, input.deliveryId));
      if (!identity) throw forbidden();
      return withSubscription(ctx.session.user.id, identity.subscriptionId, async (tx, row) => {
        const [delivery] = await tx
          .select({ state: webhookDelivery.state })
          .from(webhookDelivery)
          .where(
            and(
              eq(webhookDelivery.id, input.deliveryId),
              eq(webhookDelivery.subscriptionId, row.id),
            ),
          )
          .for('update');
        if (!delivery) throw forbidden();
        if (delivery.state !== 'dead')
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Only dead deliveries can be retried.',
          });
        const [queued] = await tx
          .select({ count: count() })
          .from(webhookDelivery)
          .where(
            and(
              eq(webhookDelivery.subscriptionId, row.id),
              inArray(webhookDelivery.state, ['pending', 'leased']),
            ),
          );
        if (queued.count >= 10000)
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'The delivery queue is full. Drain queued deliveries before retrying.',
          });
        await tx
          .update(webhookDelivery)
          .set({
            state: 'pending',
            attempts: 0,
            nextAttemptAt: new Date(),
            leaseUntil: null,
            leaseToken: null,
            lastStatus: null,
            lastError: null,
          })
          .where(eq(webhookDelivery.id, input.deliveryId));
        return { ok: true as const };
      });
    }),
});
