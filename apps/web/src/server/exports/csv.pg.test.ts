import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';

const pgIt = it.skipIf(process.env.EXPORT_PG_TEST !== '1');

pgIt(
  'exports 10001 rows with stable ties from PostgreSQL',
  async () => {
    const { db } = await import('../db');
    const s = await import('../db/schema');
    const { readCsvFiles } = await import('./csv');
    const id = randomUUID();
    const rollback = new Error('fixture rollback');
    try {
      await db.transaction(async (tx) => {
        await tx.insert(s.workspace).values({ id, name: 'export-test' });
        await tx.insert(s.base).values({ id, workspaceId: id, name: 'export-test' });
        await tx.insert(s.table).values({ id, baseId: id, name: 'Test' });
        await tx.insert(s.field).values({ id, tableId: id, name: 'Name', type: 'text' });
        const now = new Date('2026-01-01T00:00:00Z');
        for (let start = 0; start < 10001; start += 250) {
          const rows = Array.from({ length: Math.min(250, 10001 - start) }, (_, i) => ({
            id: `${id}-${String(start + i).padStart(5, '0')}`,
            tableId: id,
            createdAt: now,
          }));
          await tx.insert(s.record).values(rows);
          await tx.insert(s.cell).values(
            rows.map((r) => ({
              id: randomUUID(),
              recordId: r.id,
              fieldId: id,
              value: r.id,
            })),
          );
        }
        const [file] = await readCsvFiles(tx, [{ id, name: 'Test' }]);
        expect(file!.total).toBe(10001);
        expect(file!.truncated).toBe(false);
        const lines = file!.csv.split('\n');
        expect(lines).toHaveLength(10002);
        expect(new Set(lines.slice(1)).size).toBe(10001);
        expect(lines[1]).toBe(`${id}-10000`);
        expect(lines.at(-1)).toBe(`${id}-00000`);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  },
  60000,
);

pgIt(
  'retains a snapshot while another connection updates a cell',
  async () => {
    const { db } = await import('../db');
    const s = await import('../db/schema');
    const { readCsvFiles } = await import('./csv');
    const id = randomUUID();
    try {
      await db.insert(s.workspace).values({ id, name: 'snapshot-test' });
      await db.insert(s.base).values({ id, workspaceId: id, name: 'snapshot-test' });
      await db.insert(s.table).values({ id, baseId: id, name: 'Test' });
      await db.insert(s.field).values({ id, tableId: id, name: 'Name', type: 'text' });
      await db.insert(s.record).values({ id, tableId: id });
      await db.insert(s.cell).values({ id, recordId: id, fieldId: id, value: 'before' });
      await db.transaction(
        async (tx) => {
          await tx.select().from(s.field).where(eq(s.field.id, id));
          await db.update(s.cell).set({ value: 'after' }).where(eq(s.cell.id, id));
          const [file] = await readCsvFiles(tx, [{ id, name: 'Test' }]);
          expect(file!.csv).toBe('Name\nbefore');
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    } finally {
      await db.delete(s.base).where(eq(s.base.id, id));
      await db.delete(s.workspace).where(eq(s.workspace.id, id));
    }
  },
  60000,
);

pgIt(
  'rejects a raw cell page over 16 MiB before returning a file',
  async () => {
    const { db } = await import('../db');
    const s = await import('../db/schema');
    const { CsvBudgetError } = await import('@markpocket/plugin-csv/export');
    const { readCsvFiles } = await import('./csv');
    const id = randomUUID();
    const rollback = new Error('fixture rollback');
    try {
      await db.transaction(async (tx) => {
        await tx.insert(s.workspace).values({ id, name: 'large-page-test' });
        await tx.insert(s.base).values({ id, workspaceId: id, name: 'large-page-test' });
        await tx.insert(s.table).values({ id, baseId: id, name: 'Test' });
        await tx.insert(s.field).values({ id, tableId: id, name: 'Name', type: 'text' });
        await tx.insert(s.record).values({ id, tableId: id });
        await tx
          .insert(s.cell)
          .values({ id, recordId: id, fieldId: id, value: 'x'.repeat(16 * 1024 * 1024 + 1) });
        await expect(readCsvFiles(tx, [{ id, name: 'Test' }])).rejects.toBeInstanceOf(
          CsvBudgetError,
        );
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  },
  60000,
);

pgIt(
  'rejects concurrent exports, redacts database errors, and frees the active slot',
  async () => {
    const { db } = await import('../db');
    const s = await import('../db/schema');
    const { exportBaseCsv } = await import('./csv');
    const id = randomUUID();
    await db.insert(s.workspace).values({ id, name: 'wrapper-test' });
    try {
      await db.insert(s.base).values({ id, workspaceId: id, name: 'wrapper-test' });
      await db.insert(s.baseMember).values({ baseId: id, userId: id, role: 'viewer' });
      let rejectPending!: (reason: Error) => void;
      const pending = new Promise<never>((_resolve, reject) => {
        rejectPending = reject;
      });
      const transaction = vi.spyOn(db, 'transaction').mockImplementationOnce(() => pending);
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const first = exportBaseCsv(id, id);
        await vi.waitFor(() => expect(transaction).toHaveBeenCalledOnce());
        await expect(exportBaseCsv(id, id)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
        rejectPending(new Error('secret database detail'));
        await expect(first).rejects.toMatchObject({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'CSV export failed. No files were exported.',
        });
        expect(await exportBaseCsv(id, id)).toEqual([]);
      } finally {
        transaction.mockRestore();
        log.mockRestore();
      }
    } finally {
      await db.delete(s.base).where(eq(s.base.id, id));
      await db.delete(s.workspace).where(eq(s.workspace.id, id));
    }
  },
  60000,
);

pgIt(
  'reports a deadline through the authenticated wrapper',
  async () => {
    const { db } = await import('../db');
    const s = await import('../db/schema');
    const { exportBaseCsv } = await import('./csv');
    const id = randomUUID();
    await db.insert(s.workspace).values({ id, name: 'deadline-test' });
    try {
      await db.insert(s.base).values({ id, workspaceId: id, name: 'deadline-test' });
      await db.insert(s.baseMember).values({ baseId: id, userId: id, role: 'viewer' });
      await db.insert(s.table).values({ id, baseId: id, name: 'Test' });
      const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(60_000);
      try {
        await expect(exportBaseCsv(id, id)).rejects.toMatchObject({ code: 'TIMEOUT' });
      } finally {
        clock.mockRestore();
      }
      expect(await exportBaseCsv(id, id)).toMatchObject([{ tableId: id, total: 0 }]);
    } finally {
      await db.delete(s.base).where(eq(s.base.id, id));
      await db.delete(s.workspace).where(eq(s.workspace.id, id));
    }
  },
  60000,
);
