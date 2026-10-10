import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withDbFixture } from '../testing/pg-fixture';

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('atomic cell', () => {
  it('rolls back value and history together', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { record, cell, cellHistory } = await import('../db/schema');
      const { writeCellInTransaction } = await import('./write-cell');
      const id = randomUUID(),
        value = randomUUID();
      await db.insert(record).values({ id, tableId: f.tableId });
      await expect(
        db.transaction(async (tx) => {
          await writeCellInTransaction(tx, {
            recordId: id,
            fieldId: f.textId,
            value,
            actorId: null,
          });
          throw Error('abort');
        }),
      ).rejects.toThrow('abort');
      expect(await db.select().from(cell).where(eq(cell.recordId, id))).toHaveLength(0);
      expect(
        await db.select().from(cellHistory).where(eq(cellHistory.newValue, value)),
      ).toHaveLength(0);
    }));

  it('keeps anonymous clear history and reports a recent authenticated overwrite', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { record, cell, cellHistory } = await import('../db/schema');
      const { writeCellInTransaction } = await import('./write-cell');
      const id = randomUUID();
      await db.insert(record).values({ id, tableId: f.tableId });
      await f.caller.cell.upsert({ recordId: id, fieldId: f.textId, value: 'first' });
      const [before] = await db.select().from(cell).where(eq(cell.recordId, id));
      try {
        const result = await db.transaction((tx) =>
          writeCellInTransaction(tx, {
            recordId: id,
            fieldId: f.textId,
            value: null,
            actorId: null,
          }),
        );
        expect(result.normalized).toEqual({ empty: true });
        expect(result.overwroteRecentBy).toEqual({ userId: f.userId });
        expect(await db.select().from(cell).where(eq(cell.recordId, id))).toHaveLength(0);
        const history = await db
          .select()
          .from(cellHistory)
          .where(eq(cellHistory.cellId, before!.id));
        expect(history).toHaveLength(2);
        expect(history).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ oldValue: 'first', newValue: null, changedBy: null }),
          ]),
        );
      } finally {
        // Cleared cells no longer exist for fixture cleanup; history has no FK.
        await db.delete(cellHistory).where(eq(cellHistory.cellId, before!.id));
      }
    }));

  it('materializes anonymous expressions, supports deferred recomputation, and rejects direct expression writes', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { record, field, cell, cellHistory } = await import('../db/schema');
      const { writeCellInTransaction } = await import('./write-cell');
      const id = randomUUID(),
        expressionId = randomUUID();
      await db.insert(record).values({ id, tableId: f.tableId });
      await db.insert(field).values({
        id: expressionId,
        tableId: f.tableId,
        name: 'Twice',
        type: 'expression',
        options: { expression: `{${f.numberId}} * 2`, dependsOn: [f.numberId] },
      });
      const input = { recordId: id, fieldId: f.numberId, value: 4, actorId: null };
      expect(
        (await db.transaction((tx) => writeCellInTransaction(tx, { ...input, recompute: false })))
          .recomputed,
      ).toEqual([]);
      expect(await db.select().from(cell).where(eq(cell.fieldId, expressionId))).toHaveLength(0);
      const result = await db.transaction((tx) => writeCellInTransaction(tx, input));
      expect(result.recomputed).toEqual([{ fieldId: expressionId, value: 8 }]);
      const rows = await db.select().from(cell).where(eq(cell.recordId, id));
      for (const row of rows) {
        const history = await db.select().from(cellHistory).where(eq(cellHistory.cellId, row.id));
        expect(history.length).toBeGreaterThan(0);
        expect(history.every((h) => h.changedBy === null)).toBe(true);
      }
      await expect(
        db.transaction((tx) => writeCellInTransaction(tx, { ...input, fieldId: expressionId })),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(f.viewer.cell.upsert(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }));

  it('rejects cross-table records, wrong-target links, and foreign-base attachments', async () =>
    withDbFixture(async (f) =>
      withDbFixture(async (other) => {
        const { db } = await import('../db');
        const { record, field, attachment, cell } = await import('../db/schema');
        const { writeCellInTransaction } = await import('./write-cell');
        const id = randomUUID(),
          foreign = randomUUID(),
          linkId = randomUUID(),
          attachmentId = randomUUID(),
          fileId = randomUUID();
        await db.insert(record).values([
          { id, tableId: f.tableId },
          { id: foreign, tableId: other.tableId },
        ]);
        await db.insert(field).values([
          {
            id: linkId,
            tableId: f.tableId,
            name: 'Link',
            type: 'link',
            options: { targetTableId: f.tableId },
          },
          { id: attachmentId, tableId: f.tableId, name: 'File', type: 'attachment' },
        ]);
        await db.insert(attachment).values({
          id: fileId,
          baseId: other.baseId,
          filename: 'test',
          mime: 'text/plain',
          size: 1,
          storageKey: randomUUID(),
        });
        const write = (recordId: string, fieldId: string, value: unknown) =>
          db.transaction((tx) =>
            writeCellInTransaction(tx, { recordId, fieldId, value, actorId: f.userId }),
          );
        await expect(write(foreign, f.textId, 'bad')).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(write(id, linkId, [foreign])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(write(id, attachmentId, [fileId])).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        });
        expect(await db.select().from(cell).where(eq(cell.recordId, id))).toHaveLength(0);
      }),
    ));

  it('serializes a single-cell writer with a transaction that prelocks the record', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { record, cell } = await import('../db/schema');
      const { writeCellInTransaction } = await import('./write-cell');
      const id = randomUUID();
      await db.insert(record).values({ id, tableId: f.tableId });
      let startSingle!: () => void, singleStarted!: () => void;
      const ready = new Promise<void>((resolve) => {
        startSingle = resolve;
      });
      const started = new Promise<void>((resolve) => {
        singleStarted = resolve;
      });
      const batch = db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
        await tx.select().from(record).where(eq(record.id, id)).for('update');
        startSingle();
        await started;
        // Wait until the single writer is blocked, then request its cell key.
        // advisory-before-record would deadlock against this prelocked caller.
        for (let n = 0; n < 100; n++) {
          const waiting = await tx.execute(
            sql`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pg_backend_pid() = ANY(pg_blocking_pids(pid))`,
          );
          if (waiting.length > 0) break;
          if (n === 99) throw new Error('Single writer never blocked');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await writeCellInTransaction(tx, {
          recordId: id,
          fieldId: f.textId,
          value: 'batch',
          actorId: f.userId,
          recompute: false,
        });
      });
      const single = (async () => {
        await ready;
        singleStarted();
        return f.caller.cell.upsert({ recordId: id, fieldId: f.textId, value: 'single' });
      })();
      await Promise.all([batch, single]);
      expect((await db.select().from(cell).where(eq(cell.recordId, id)))[0]?.value).toBe('single');
    }));

  it('keeps no dead link when a referenced record is concurrently deleted', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { record, field, cell } = await import('../db/schema');
      const { writeCellInTransaction } = await import('./write-cell');
      const source = randomUUID(),
        target = randomUUID(),
        linkId = randomUUID();
      await db.insert(record).values([
        { id: source, tableId: f.tableId },
        { id: target, tableId: f.tableId },
      ]);
      await db.insert(field).values({
        id: linkId,
        tableId: f.tableId,
        name: 'Link',
        type: 'link',
        options: { targetTableId: f.tableId },
      });
      let beginDelete!: () => void;
      const ready = new Promise<void>((resolve) => {
        beginDelete = resolve;
      });
      const writer = db.transaction(async (tx) => {
        await writeCellInTransaction(tx, {
          recordId: source,
          fieldId: linkId,
          value: [target],
          actorId: f.userId,
        });
        beginDelete();
        for (let n = 0; n < 100; n++) {
          const waiting = await tx.execute(
            sql`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pg_backend_pid() = ANY(pg_blocking_pids(pid))`,
          );
          if (waiting.length > 0) return;
          if (n === 99) throw new Error('Delete never blocked on reference lock');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      });
      const deletion = (async () => {
        await ready;
        return f.caller.record.delete({ id: target, tableId: f.tableId });
      })();
      await Promise.all([writer, deletion]);
      const rows = await db.select().from(cell).where(eq(cell.recordId, source));
      expect(rows.every((row) => !Array.isArray(row.value) || !row.value.includes(target))).toBe(
        true,
      );
    }));
});
