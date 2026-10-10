import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withDbFixture } from '../testing/pg-fixture';
describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('batch writes', () => {
  it('rejects the entire batch then safely replays successful creates', async () =>
    withDbFixture(async (f) => {
      await expect(
        f.caller.record.writeBatch({
          tableId: f.tableId,
          requestId: randomUUID(),
          rows: [{ cells: { [f.textId]: 'valid' } }, { cells: { [f.numberId]: 'not-a-number' } }],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect((await f.caller.record.list({ tableId: f.tableId })).total).toBe(0);
      const input = {
        tableId: f.tableId,
        requestId: randomUUID(),
        rows: [{ cells: { [f.textId]: 'one' } }],
      };
      const [a, b] = await Promise.all([
        f.caller.record.writeBatch(input),
        f.caller.record.writeBatch(input),
      ]);
      expect(a).toEqual(b);
      expect((await f.caller.record.list({ tableId: f.tableId })).total).toBe(1);
      await expect(
        f.caller.record.writeBatch({ ...input, rows: [{ cells: { [f.textId]: 'two' } }] }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    }));

  it('serializes concurrent mixed-case request UUIDs into one receipt', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { table, writeReceipt } = await import('../db/schema');
      const input = {
        tableId: f.tableId,
        requestId: randomUUID(),
        rows: [{ cells: { [f.textId]: 'one' } }],
      };
      let writes!: ReturnType<typeof Promise.allSettled>;
      await db.transaction(async (tx) => {
        await tx.select().from(table).where(eq(table.id, f.tableId)).for('update');
        writes = Promise.allSettled([
          f.caller.record.writeBatch(input),
          f.caller.record.writeBatch({ ...input, requestId: input.requestId.toUpperCase() }),
        ]);
        for (let n = 0; n < 200; n++) {
          await tx.execute(sql`select pg_stat_clear_snapshot()`);
          const blocked = await tx.execute(
            sql`WITH RECURSIVE blocked(pid) AS (SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pg_backend_pid()=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))) SELECT pid FROM blocked`,
          );
          if (blocked.length >= 2) return;
          if (n === 199) throw Error('Expected both mixed-case requests to be blocked');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      });
      const results = await writes;
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(results[0]).toEqual(results[1]);
      expect((await f.caller.record.list({ tableId: f.tableId })).total).toBe(1);
      expect(
        await db
          .select()
          .from(writeReceipt)
          .where(eq(writeReceipt.actorKey, `user:${f.userId}`)),
      ).toHaveLength(1);
      await expect(
        f.caller.record.writeBatch({
          ...input,
          requestId: input.requestId.toUpperCase(),
          rows: [{ cells: { [f.textId]: 'different' } }],
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    }));

  it('enforces row, cell and UTF-8 byte budgets and viewer permissions', async () =>
    withDbFixture(async (f) => {
      const input = { tableId: f.tableId, requestId: randomUUID(), rows: [{ cells: {} }] };
      await expect(f.viewer.record.writeBatch(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      for (const rows of [
        Array.from({ length: 101 }, () => ({ cells: {} })),
        [{ cells: Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`f${i}`, 1])) }],
        [{ cells: { [f.textId]: 'x'.repeat(262145) } }],
        [{ cells: { [f.textId]: '界'.repeat(90000) } }],
        Array.from({ length: 5 }, () => ({ cells: { [f.textId]: '界'.repeat(80000) } })),
      ]) {
        await expect(f.caller.record.writeBatch({ ...input, rows })).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        });
      }
      expect((await f.caller.record.list({ tableId: f.tableId })).total).toBe(0);
    }));

  it('validates table ownership even for empty cells, duplicates, unknown fields and expression writes', async () =>
    withDbFixture(async (f) =>
      withDbFixture(async (other) => {
        const { db } = await import('../db');
        const { record, field } = await import('../db/schema');
        const foreign = randomUUID(),
          local = randomUUID(),
          expression = randomUUID();
        await db.insert(record).values([
          { id: foreign, tableId: other.tableId },
          { id: local, tableId: f.tableId },
        ]);
        await db.insert(field).values({
          id: expression,
          tableId: f.tableId,
          name: 'Expr',
          type: 'expression',
          options: { expression: '1', dependsOn: [] },
        });
        const input = {
          tableId: f.tableId,
          requestId: randomUUID(),
          rows: [{ recordId: foreign, cells: {} }],
        };
        await expect(f.caller.record.writeBatch(input)).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
        await expect(
          f.caller.record.writeBatch({
            ...input,
            rows: [
              { recordId: local, cells: {} },
              { recordId: local, cells: {} },
            ],
          }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        for (const fieldId of [other.textId, randomUUID()])
          await expect(
            f.caller.record.writeBatch({ ...input, rows: [{ cells: { [fieldId]: 'bad' } }] }),
          ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(
          f.caller.record.writeBatch({ ...input, rows: [{ cells: { [expression]: 4 } }] }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }),
    ));

  it('preserves input order and canonical replay and materializes only final expressions', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { record, field, cell, cellHistory, writeReceipt } = await import('../db/schema');
      const expression = randomUUID(),
        a = randomUUID(),
        b = randomUUID();
      await db.insert(record).values([
        { id: a, tableId: f.tableId },
        { id: b, tableId: f.tableId },
      ]);
      await db.insert(field).values({
        id: expression,
        tableId: f.tableId,
        name: 'Twice',
        type: 'expression',
        options: { expression: `{${f.numberId}} * 2`, dependsOn: [f.numberId] },
      });
      const input = {
        tableId: f.tableId,
        requestId: randomUUID(),
        rows: [
          { recordId: b, cells: { [f.textId]: 'name', [f.numberId]: 4 } },
          { cells: {} },
          { recordId: a, cells: { [f.numberId]: 5 } },
        ],
      };
      const result = await f.caller.record.writeBatch(input);
      expect(result).toMatchObject({ created: 1, updated: 2 });
      expect(result.recordIds[0]).toBe(b);
      expect(result.recordIds[2]).toBe(a);
      expect(
        await f.caller.record.writeBatch({
          ...input,
          rows: input.rows.map((r) => ({
            ...r,
            cells: Object.fromEntries(Object.entries(r.cells).reverse()),
          })),
        }),
      ).toEqual(result);
      const [computed] = await db
        .select()
        .from(cell)
        .where(and(eq(cell.recordId, b), eq(cell.fieldId, expression)));
      expect(computed?.value).toBe(8);
      expect(
        await db.select().from(cellHistory).where(eq(cellHistory.cellId, computed!.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(writeReceipt)
          .where(eq(writeReceipt.actorKey, `user:${f.userId}`)),
      ).toHaveLength(1);
    }));

  it('cleans at most 100 expired actor receipts without deleting the live window', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { writeReceipt } = await import('../db/schema');
      const actorKey = `user:${f.userId}`,
        otherKey = `user:${f.viewerId}`;
      await db.insert(writeReceipt).values(
        Array.from({ length: 101 }, () => ({
          actorKey,
          requestId: randomUUID(),
          bodyHash: 'old',
          result: {},
          createdAt: new Date(Date.now() - 8 * 86400000),
        })),
      );
      const live = randomUUID(),
        foreign = randomUUID();
      await db.insert(writeReceipt).values([
        { actorKey, requestId: live, bodyHash: 'live', result: {} },
        {
          actorKey: otherKey,
          requestId: foreign,
          bodyHash: 'old',
          result: {},
          createdAt: new Date(Date.now() - 8 * 86400000),
        },
      ]);
      await f.caller.record.writeBatch({
        tableId: f.tableId,
        requestId: randomUUID(),
        rows: [{ cells: {} }],
      });
      const remaining = await db
        .select()
        .from(writeReceipt)
        .where(eq(writeReceipt.actorKey, actorKey));
      expect(remaining).toHaveLength(3);
      expect(remaining.some((r) => r.requestId === live)).toBe(true);
      expect(
        await db.select().from(writeReceipt).where(eq(writeReceipt.requestId, foreign)),
      ).toHaveLength(1);
    }));

  it('serializes the public batch API with a concurrent single-cell API writer', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { record, cell, cellHistory } = await import('../db/schema');
      const id = randomUUID();
      await db.insert(record).values({ id, tableId: f.tableId });
      let batch!: Promise<unknown>, single!: Promise<unknown>;
      await db.transaction(async (tx) => {
        await tx.select().from(record).where(eq(record.id, id)).for('update');
        const observeBlocked = async (count: number) => {
          for (let n = 0; n < 200; n++) {
            await tx.execute(sql`select pg_stat_clear_snapshot()`);
            const blocked = await tx.execute(
              sql`WITH RECURSIVE blocked(pid) AS (SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pg_backend_pid()=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))) SELECT pid FROM blocked`,
            );
            if (blocked.length >= count) return;
            if (n === 199) throw Error(`Expected ${count} blocked API writers`);
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        };
        batch = f.caller.record.writeBatch({
          tableId: f.tableId,
          requestId: randomUUID(),
          rows: [{ recordId: id, cells: { [f.textId]: 'batch' } }],
        });
        await observeBlocked(1);
        single = f.caller.cell.upsert({ recordId: id, fieldId: f.textId, value: 'single' });
        await observeBlocked(2);
      });
      await Promise.all([batch, single]);
      const [value] = await db.select().from(cell).where(eq(cell.recordId, id));
      expect(value?.value).toBe('single');
      const history = await db.select().from(cellHistory).where(eq(cellHistory.cellId, value!.id));
      expect(history).toHaveLength(2);
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ oldValue: 'batch', newValue: 'single' }),
        ]),
      );
    }));

  it('validates direct transaction calls and rolls back receipts, expressions and history; supports anonymous attribution', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { record, field, cellHistory, writeReceipt } = await import('../db/schema');
      const { writeBatchInTransaction } = await import('./write-batch');
      const actor = { key: `user:${f.userId}`, userId: null };
      const expression = randomUUID();
      await db.insert(field).values({
        id: expression,
        tableId: f.tableId,
        name: 'Double',
        type: 'expression',
        options: { expression: `{${f.numberId}} * 2`, dependsOn: [f.numberId] },
      });
      const requestId = randomUUID();
      await expect(
        db.transaction((tx) =>
          writeBatchInTransaction(tx, actor, { tableId: f.tableId, requestId, rows: [] }),
        ),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        db.transaction(async (tx) => {
          await writeBatchInTransaction(tx, actor, {
            tableId: f.tableId,
            requestId,
            rows: [{ cells: { [f.numberId]: 17 } }],
          });
          throw Error('abort batch');
        }),
      ).rejects.toThrow('abort batch');
      expect(await db.select().from(record).where(eq(record.tableId, f.tableId))).toHaveLength(0);
      expect(
        await db.select().from(writeReceipt).where(eq(writeReceipt.requestId, requestId)),
      ).toHaveLength(0);
      const result = await db.transaction((tx) =>
        writeBatchInTransaction(tx, actor, {
          tableId: f.tableId,
          requestId,
          rows: [{ cells: { [f.numberId]: 17 } }],
        }),
      );
      const [created] = await db.select().from(record).where(eq(record.id, result.recordIds[0]!));
      expect(created?.createdBy).toBeNull();
      const history = await db
        .select()
        .from(cellHistory)
        .where(
          sql`${cellHistory.cellId} in (select id from cell where record_id = ${result.recordIds[0]})`,
        );
      expect(history).toHaveLength(2);
      expect(history.every((h) => h.changedBy === null)).toBe(true);
    }));
});
