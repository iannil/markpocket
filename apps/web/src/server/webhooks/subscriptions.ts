import { randomBytes, randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, count, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { baseMember, table, webhookSubscription } from '../db/schema';
import { encryptSecret, getWebhookEncryptionKey } from './crypto';
import { parseWebhookUrl } from './transport';

export type WebhookEvent = 'record.changed' | 'record.deleted';
export type WebhookTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Acquire before owner checks and subscription mutations; held through commit. */
export async function lockWebhookSubscriptions(tx: WebhookTx, tableId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('webhook-subscriptions:' || ${tableId}))`,
  );
}

export async function assertWebhookOwner(
  tx: WebhookTx,
  tableId: string,
  userId: string,
): Promise<void> {
  const [member] = await tx
    .select({ role: baseMember.role })
    .from(baseMember)
    .innerJoin(table, eq(table.baseId, baseMember.baseId))
    .where(and(eq(table.id, tableId), eq(baseMember.userId, userId)))
    .for('share', { of: baseMember });
  if (member?.role !== 'owner')
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires owner role' });
}

/** No URL mutation: changing a target requires explicitly removing the old subscription. */
export async function createSubscription(
  userId: string,
  input: { tableId: string; url: string; events: WebhookEvent[] },
): Promise<{ id: string; secret: string }> {
  const key = getWebhookEncryptionKey();
  if (!key)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Webhooks are disabled: encryption key unavailable',
    });
  try {
    parseWebhookUrl(input.url);
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid webhook URL' });
  }
  if (
    !Array.isArray(input.events) ||
    !input.events.length ||
    [...input.events].some((event) => event !== 'record.changed' && event !== 'record.deleted')
  )
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Select at least one supported webhook event',
    });
  const events = [...new Set(input.events)];
  return db.transaction(async (tx) => {
    await lockWebhookSubscriptions(tx, input.tableId);
    await assertWebhookOwner(tx, input.tableId, userId);
    const [existing] = await tx
      .select({ count: count() })
      .from(webhookSubscription)
      .where(eq(webhookSubscription.tableId, input.tableId));
    // All states consume a slot. Only explicit removal frees capacity.
    if (existing.count >= 5)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'A table can have at most 5 webhook subscriptions',
      });
    const id = randomUUID();
    const secret = randomBytes(32).toString('hex');
    await tx.insert(webhookSubscription).values({
      id,
      tableId: input.tableId,
      createdBy: userId,
      url: input.url,
      events,
      secretCiphertext: encryptSecret(secret, key),
    });
    return { id, secret };
  });
}
