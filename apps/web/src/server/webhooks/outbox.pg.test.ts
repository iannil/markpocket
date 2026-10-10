import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withDbFixture, type DbFixture } from '../testing/pg-fixture';
import type { WebhookEvent } from './subscriptions';

async function subscribe(
  f: DbFixture,
  events: WebhookEvent[] = ['record.changed', 'record.deleted'],
) {
  const { createSubscription } = await import('./subscriptions');
  return createSubscription(f.userId, {
    tableId: f.tableId,
    url: 'https://example.com/hook',
    events,
  });
}

async function deliveries(subscriptionId: string) {
  const { db } = await import('../db');
  const { webhookDelivery } = await import('../db/schema');
  return db
    .select()
    .from(webhookDelivery)
    .where(eq(webhookDelivery.subscriptionId, subscriptionId));
}

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')(
  'transactional webhook outbox (PostgreSQL)',
  () => {
    beforeEach(() => vi.stubEnv('WEBHOOK_ENCRYPTION_KEY', randomBytes(32).toString('base64')));
    afterEach(() => vi.unstubAllEnvs());

    it('exposes events only after commit and rolls them back with business writes', async () =>
      withDbFixture(async (f) => {
        const { db } = await import('../db');
        const { record, webhookDelivery } = await import('../db/schema');
        const sub = await subscribe(f);
        await expect(
          db.transaction(async (tx) => {
            await tx.insert(record).values({ id: randomUUID(), tableId: f.tableId });
            expect(
              await tx
                .select()
                .from(webhookDelivery)
                .where(eq(webhookDelivery.subscriptionId, sub.id)),
            ).toHaveLength(1);
            expect(await deliveries(sub.id)).toHaveLength(0);
            throw Error('rollback');
          }),
        ).rejects.toThrow('rollback');
        expect(await deliveries(sub.id)).toHaveLength(0);
        const id = randomUUID();
        await db.transaction(async (tx) => {
          await tx.insert(record).values({ id, tableId: f.tableId });
          expect(await deliveries(sub.id)).toHaveLength(0);
        });
        expect(await deliveries(sub.id)).toEqual([
          expect.objectContaining({
            recordId: id,
            baseId: f.baseId,
            tableId: f.tableId,
            eventType: 'record.changed',
            state: 'pending',
            attempts: 0,
            leaseUntil: null,
            leaseToken: null,
            lastStatus: null,
            lastError: null,
            occurredAt: expect.any(Date),
            nextAttemptAt: expect.any(Date),
          }),
        ]);
      }));

    it('coalesces direct SQL record + two cells and gives deletion precedence including cascades', async () =>
      withDbFixture(async (f) => {
        const { db } = await import('../db');
        const { webhookDelivery } = await import('../db/schema');
        const sub = await subscribe(f);
        const id = randomUUID();
        await db.transaction(async (tx) => {
          await tx.execute(sql`insert into record(id, table_id) values (${id}, ${f.tableId})`);
          await tx.execute(sql`insert into cell(id, record_id, field_id, value) values
          (${randomUUID()}, ${id}, ${f.textId}, '"private-cell-value"'),
          (${randomUUID()}, ${id}, ${f.numberId}, '42')`);
          const rows = await tx
            .select()
            .from(webhookDelivery)
            .where(eq(webhookDelivery.subscriptionId, sub.id));
          expect(rows).toHaveLength(1);
          expect(rows[0].eventType).toBe('record.changed');
          expect(rows[0]).not.toHaveProperty('value');
          expect(rows[0]).not.toHaveProperty('cells');
          expect(rows[0]).not.toHaveProperty('secretCiphertext');
          await tx.execute(sql`delete from record where id=${id}`);
        });
        expect(await deliveries(sub.id)).toEqual([
          expect.objectContaining({ recordId: id, eventType: 'record.deleted' }),
        ]);
      }));

    it('drops changed-only events for same-transaction deletion and collects deleted-only events', async () =>
      withDbFixture(async (f) => {
        const { db } = await import('../db');
        const { record } = await import('../db/schema');
        const changed = await subscribe(f, ['record.changed']);
        const deleted = await subscribe(f, ['record.deleted']);
        const id = randomUUID();
        await db.transaction(async (tx) => {
          await tx.insert(record).values({ id, tableId: f.tableId });
          expect(await deliveries(deleted.id)).toHaveLength(0);
          await tx.delete(record).where(eq(record.id, id));
        });
        expect(await deliveries(changed.id)).toHaveLength(0);
        expect(await deliveries(deleted.id)).toEqual([
          expect.objectContaining({ recordId: id, eventType: 'record.deleted' }),
        ]);
        // Different transactions remain distinct; receivers may fetch a now-deleted record.
        await db.insert(record).values({ id, tableId: f.tableId });
        await db.delete(record).where(eq(record.id, id));
        expect(await deliveries(changed.id)).toHaveLength(1);
        expect(await deliveries(deleted.id)).toHaveLength(2);
      }));

    it('covers record updates and cell insert/update/delete even without record updates', async () =>
      withDbFixture(async (f) => {
        const { db } = await import('../db');
        const { record, cell } = await import('../db/schema');
        const id = randomUUID(),
          cellId = randomUUID();
        await db.insert(record).values({ id, tableId: f.tableId });
        const sub = await subscribe(f);
        await db.update(record).set({ updatedAt: new Date() }).where(eq(record.id, id));
        await db.insert(cell).values({ id: cellId, recordId: id, fieldId: f.textId, value: 'one' });
        await db.update(cell).set({ value: 'two' }).where(eq(cell.id, cellId));
        await db.delete(cell).where(eq(cell.id, cellId));
        const rows = await deliveries(sub.id);
        expect(rows).toHaveLength(4);
        expect(new Set(rows.map((row) => row.transactionId)).size).toBe(4);
        expect(rows.every((row) => row.recordId === id && row.eventType === 'record.changed')).toBe(
          true,
        );
      }));

    it('covers F batch, legacy cell.upsert and the real CSV plugin import', async () =>
      withDbFixture(async (f) => {
        const sub = await subscribe(f);
        await f.caller.record.writeBatch({
          tableId: f.tableId,
          requestId: randomUUID(),
          rows: [
            { cells: { [f.textId]: 'batch-one', [f.numberId]: 1 } },
            { cells: { [f.textId]: 'batch-two' } },
          ],
        });
        const first = await deliveries(sub.id);
        expect(first).toHaveLength(2);
        await f.caller.cell.upsert({
          recordId: first[0].recordId,
          fieldId: f.textId,
          value: 'legacy',
        });
        expect(await deliveries(sub.id)).toHaveLength(3);
        await f.caller.csv.import({
          tableId: f.tableId,
          csvText: 'Name,Amount\nCSV-one,10\nCSV-two,20',
        });
        expect(await deliveries(sub.id)).toHaveLength(5);
      }));

    it.each(['paused', 'overflow', 'disabled'] as const)(
      'does not collect %s subscriptions',
      async (state) =>
        withDbFixture(async (f) => {
          const { db } = await import('../db');
          const { record, webhookSubscription } = await import('../db/schema');
          const sub = await subscribe(f);
          await db
            .update(webhookSubscription)
            .set({ state })
            .where(eq(webhookSubscription.id, sub.id));
          await db.insert(record).values({ id: randomUUID(), tableId: f.tableId });
          expect(await deliveries(sub.id)).toHaveLength(0);
        }),
    );

    it.each(['table', 'base'] as const)(
      'drops subscriptions and queued deliveries on %s deletion',
      async (entity) =>
        withDbFixture(async (f) => {
          const { db } = await import('../db');
          const s = await import('../db/schema');
          const sub = await subscribe(f);
          const id = randomUUID();
          await db.insert(s.record).values({ id, tableId: f.tableId });
          await db
            .insert(s.cell)
            .values({ id: randomUUID(), recordId: id, fieldId: f.textId, value: 'value' });
          expect(await deliveries(sub.id)).toHaveLength(2);
          if (entity === 'table') await db.delete(s.table).where(eq(s.table.id, f.tableId));
          else await db.delete(s.base).where(eq(s.base.id, f.baseId));
          expect(await deliveries(sub.id)).toHaveLength(0);
          expect(
            await db
              .select()
              .from(s.webhookSubscription)
              .where(eq(s.webhookSubscription.id, sub.id)),
          ).toHaveLength(0);
        }),
    );

    it('caps pending/leased at 10000 without failing writes; terminal rows do not consume capacity', async () =>
      withDbFixture(async (f) => {
        const { db } = await import('../db');
        const { record, webhookSubscription, webhookDelivery } = await import('../db/schema');
        const sub = await subscribe(f);
        await db.execute(sql`insert into webhook_delivery(id, subscription_id, transaction_id, base_id, table_id, record_id, event_type, occurred_at, state)
        select gen_random_uuid(), ${sub.id}, txid_current(), ${f.baseId}, ${f.tableId}, 'seed-' || n, 'record.changed', now(),
          case when n <= 10000 then 'pending' when n <= 10002 then 'succeeded' else 'dead' end
        from generate_series(1, 10004) n`);
        const id = randomUUID();
        await db.insert(record).values({ id, tableId: f.tableId });
        expect(await db.select().from(record).where(eq(record.id, id))).toHaveLength(1);
        expect(await deliveries(sub.id)).toHaveLength(10004);
        expect(
          await db.select().from(webhookSubscription).where(eq(webhookSubscription.id, sub.id)),
        ).toEqual([expect.objectContaining({ state: 'overflow', overflowAt: expect.any(Date) })]);
        // A leased row still consumes the last slot; succeeded/dead do not.
        await db
          .update(webhookDelivery)
          .set({ state: 'succeeded' })
          .where(
            and(eq(webhookDelivery.subscriptionId, sub.id), eq(webhookDelivery.recordId, 'seed-1')),
          );
        await db
          .update(webhookDelivery)
          .set({ state: 'leased' })
          .where(
            and(eq(webhookDelivery.subscriptionId, sub.id), eq(webhookDelivery.recordId, 'seed-2')),
          );
        await db
          .update(webhookSubscription)
          .set({ state: 'active', overflowAt: null })
          .where(eq(webhookSubscription.id, sub.id));
        await db.insert(record).values({ id: randomUUID(), tableId: f.tableId });
        expect(await deliveries(sub.id)).toHaveLength(10005);
        await db.insert(record).values({ id: randomUUID(), tableId: f.tableId });
        expect(await deliveries(sub.id)).toHaveLength(10005);
        expect(
          (await db.select().from(webhookSubscription).where(eq(webhookSubscription.id, sub.id)))[0]
            .state,
        ).toBe('overflow');
      }));

    it('coalesces at capacity and still normalizes deletion after overflowing in the same transaction', async () =>
      withDbFixture(async (f) => {
        const { db } = await import('../db');
        const { record, cell, webhookSubscription, webhookDelivery } = await import('../db/schema');
        const changed = await subscribe(f, ['record.changed']);
        const both = await subscribe(f);
        for (const sub of [changed, both])
          await db.execute(sql`
        insert into webhook_delivery(id, subscription_id, transaction_id, base_id, table_id, record_id, event_type, occurred_at)
        select gen_random_uuid(), ${sub.id}, txid_current(), ${f.baseId}, ${f.tableId}, 'seed-' || n, 'record.changed', now()
        from generate_series(1, 9999) n`);
        const id = randomUUID(),
          spill = randomUUID();
        await db.transaction(async (tx) => {
          await tx.insert(record).values({ id, tableId: f.tableId });
          await tx
            .insert(cell)
            .values({ id: randomUUID(), recordId: id, fieldId: f.textId, value: 'last slot' });
          expect(
            (
              await tx
                .select()
                .from(webhookSubscription)
                .where(eq(webhookSubscription.tableId, f.tableId))
            ).every((s) => s.state === 'active'),
          ).toBe(true);
          await tx.insert(record).values({ id: spill, tableId: f.tableId });
          expect(
            (
              await tx
                .select()
                .from(webhookSubscription)
                .where(eq(webhookSubscription.tableId, f.tableId))
            ).every((s) => s.state === 'overflow'),
          ).toBe(true);
          await tx.delete(record).where(eq(record.id, id));
        });
        expect(await deliveries(changed.id)).toHaveLength(9999);
        expect(await deliveries(both.id)).toHaveLength(10000);
        expect(
          await db
            .select()
            .from(webhookDelivery)
            .where(
              and(eq(webhookDelivery.subscriptionId, both.id), eq(webhookDelivery.recordId, id)),
            ),
        ).toEqual([expect.objectContaining({ eventType: 'record.deleted' })]);
        expect(
          await db.select().from(webhookDelivery).where(eq(webhookDelivery.recordId, spill)),
        ).toHaveLength(0);
      }));

    it('serializes concurrent writes at the last slot and rolls back an overflow transition', async () =>
      withDbFixture(async (f) => {
        const { db } = await import('../db');
        const { record, webhookSubscription } = await import('../db/schema');
        const sub = await subscribe(f);
        await db.execute(sql`insert into webhook_delivery(id, subscription_id, transaction_id, base_id, table_id, record_id, event_type, occurred_at)
        select gen_random_uuid(), ${sub.id}, txid_current(), ${f.baseId}, ${f.tableId}, 'seed-' || n, 'record.changed', now()
        from generate_series(1, 9999) n`);
        await expect(
          db.transaction(async (tx) => {
            await tx.insert(record).values([
              { id: randomUUID(), tableId: f.tableId },
              { id: randomUUID(), tableId: f.tableId },
            ]);
            expect(
              (
                await tx
                  .select()
                  .from(webhookSubscription)
                  .where(eq(webhookSubscription.id, sub.id))
              )[0].state,
            ).toBe('overflow');
            throw Error('rollback overflow');
          }),
        ).rejects.toThrow('rollback overflow');
        expect(await deliveries(sub.id)).toHaveLength(9999);
        expect(
          (
            await db.select().from(webhookSubscription).where(eq(webhookSubscription.id, sub.id))
          )[0],
        ).toMatchObject({ state: 'active', overflowAt: null });
        const ids: string[] = [randomUUID(), randomUUID()];
        await Promise.all(ids.map((id) => db.insert(record).values({ id, tableId: f.tableId })));
        const rows = await deliveries(sub.id);
        expect(rows).toHaveLength(10000);
        expect(rows.filter((row) => ids.includes(row.recordId))).toHaveLength(1);
        expect(
          (await db.select().from(webhookSubscription).where(eq(webhookSubscription.id, sub.id)))[0]
            .state,
        ).toBe('overflow');
      }));

    it(
      'serializes concurrent bulk SQL writers across five subscriptions without lost events',
      async () =>
        withDbFixture(async (f) => {
          const { db } = await import('../db');
          const subs = [];
          for (let n = 0; n < 5; n++) subs.push(await subscribe(f));
          await Promise.all(
            Array.from({ length: 4 }, (_, batch) =>
              db.transaction(async (tx) => {
                await tx.execute(sql`insert into record(id, table_id)
          select ${f.tableId + '-' + batch + '-'} || n, ${f.tableId} from generate_series(1, 100) n`);
                await tx.execute(sql`insert into cell(id, record_id, field_id, value)
          select gen_random_uuid()::text, ${f.tableId + '-' + batch + '-'} || n, ${f.textId}, '"bulk"'::jsonb from generate_series(1, 100) n`);
              }),
            ),
          );
          for (const sub of subs) {
            const rows = await deliveries(sub.id);
            expect(rows).toHaveLength(400);
            expect(new Set(rows.map((row) => row.recordId)).size).toBe(400);
            expect(new Set(rows.map((row) => row.transactionId)).size).toBe(4);
          }
        }),
      15000,
    );
  },
);
