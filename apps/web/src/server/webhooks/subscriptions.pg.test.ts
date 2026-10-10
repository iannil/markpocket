import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withDbFixture } from '../testing/pg-fixture';
import { decryptSecret } from './crypto';

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('webhook subscriptions (PostgreSQL)', () => {
  const key = randomBytes(32);
  beforeEach(() => vi.stubEnv('WEBHOOK_ENCRYPTION_KEY', key.toString('base64')));
  afterEach(() => vi.unstubAllEnvs());
  const input = (tableId: string) => ({
    tableId,
    url: 'https://example.com/hook?private=value',
    events: ['record.changed' as const],
  });

  it('stores authenticated encrypted secrets, deduplicates events and cascades with table', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { webhookSubscription, table } = await import('../db/schema');
      const { createSubscription } = await import('./subscriptions');
      const created = await createSubscription(f.userId, {
        ...input(f.tableId),
        events: ['record.changed', 'record.changed', 'record.deleted'],
      });
      expect(Object.keys(created).sort()).toEqual(['id', 'secret']);
      expect(created.secret).toMatch(/^[a-f0-9]{64}$/);
      const [stored] = await db
        .select()
        .from(webhookSubscription)
        .where(eq(webhookSubscription.id, created.id));
      expect(stored.events).toEqual(['record.changed', 'record.deleted']);
      expect(stored.state).toBe('active');
      expect(stored.createdBy).toBe(f.userId);
      expect(stored.overflowAt).toBeNull();
      expect(JSON.stringify(stored)).not.toContain(created.secret);
      expect(decryptSecret(stored.secretCiphertext, key)).toBe(created.secret);
      await db.delete(table).where(eq(table.id, f.tableId));
      expect(
        await db.select().from(webhookSubscription).where(eq(webhookSubscription.id, created.id)),
      ).toHaveLength(0);
    }));

  it('rejects viewer, editor and nonmember owners without creating a subscription', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { baseMember, webhookSubscription } = await import('../db/schema');
      const { createSubscription } = await import('./subscriptions');
      for (const role of ['viewer', 'editor']) {
        await db.update(baseMember).set({ role }).where(eq(baseMember.userId, f.viewerId));
        await expect(createSubscription(f.viewerId, input(f.tableId))).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
      }
      await db.delete(baseMember).where(eq(baseMember.userId, f.viewerId));
      await expect(createSubscription(f.viewerId, input(f.tableId))).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(
        await db
          .select()
          .from(webhookSubscription)
          .where(eq(webhookSubscription.tableId, f.tableId)),
      ).toHaveLength(0);
    }));

  it('disables creation with missing/invalid key and rejects empty/unsupported events and invalid URLs', async () =>
    withDbFixture(async (f) => {
      const { createSubscription } = await import('./subscriptions');
      for (const value of [undefined, 'invalid']) {
        vi.stubEnv('WEBHOOK_ENCRYPTION_KEY', value);
        await expect(createSubscription(f.userId, input(f.tableId))).rejects.toMatchObject({
          code: 'PRECONDITION_FAILED',
          message: 'Webhooks are disabled: encryption key unavailable',
        });
      }
      vi.stubEnv('WEBHOOK_ENCRYPTION_KEY', key.toString('base64'));
      for (const events of [[], ['record.created'], ['record.changed', 'wrong']]) {
        await expect(
          createSubscription(f.userId, {
            ...input(f.tableId),
            events: events as ['record.changed'],
          }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }
      await expect(
        createSubscription(f.userId, { ...input(f.tableId), url: 'http://example.com/?secret' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Invalid webhook URL' });
    }));

  it('serializes concurrent creates at five, counting active/paused/overflow/disabled rows', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { webhookSubscription } = await import('../db/schema');
      const { createSubscription } = await import('./subscriptions');
      for (const state of ['active', 'paused', 'overflow', 'disabled'] as const) {
        const created = await createSubscription(f.userId, input(f.tableId));
        await db
          .update(webhookSubscription)
          .set({ state })
          .where(eq(webhookSubscription.id, created.id));
      }
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => createSubscription(f.userId, input(f.tableId))),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(7);
      for (const result of rejected)
        expect(result.reason).toMatchObject({
          code: 'BAD_REQUEST',
          message: 'A table can have at most 5 webhook subscriptions',
        });
      expect(
        await db
          .select()
          .from(webhookSubscription)
          .where(eq(webhookSubscription.tableId, f.tableId)),
      ).toHaveLength(5);
    }));

  it('rechecks ownership after waiting for the table lifecycle lock', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { sql } = await import('drizzle-orm');
      const { baseMember } = await import('../db/schema');
      const { createSubscription, lockWebhookSubscriptions } = await import('./subscriptions');
      let release!: () => void, held!: () => void;
      const released = new Promise<void>((r) => {
        release = r;
      });
      const acquired = new Promise<void>((r) => {
        held = r;
      });
      const blocker = db.transaction(async (tx) => {
        await lockWebhookSubscriptions(tx, f.tableId);
        held();
        await released;
      });
      await acquired;
      const creating = expect(createSubscription(f.userId, input(f.tableId))).rejects.toMatchObject(
        { code: 'FORBIDDEN' },
      );
      try {
        let waiting = false;
        for (let i = 0; i < 200; i++) {
          const locks = await db.execute(
            sql`SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=(hashtext('webhook-subscriptions:' || ${f.tableId})::bigint & 4294967295)::oid AND NOT granted`,
          );
          if (locks.length) {
            waiting = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
        expect(waiting).toBe(true);
        await db.update(baseMember).set({ role: 'editor' }).where(eq(baseMember.userId, f.userId));
      } finally {
        release();
      }
      await Promise.all([blocker, creating]);
    }));
});
