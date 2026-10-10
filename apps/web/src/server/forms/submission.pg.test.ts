import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { describe, it, expect, vi } from 'vitest';
import { withDbFixture, type DbFixture } from '../testing/pg-fixture';

async function fixture(run: (f: DbFixture) => Promise<void>) {
  return withDbFixture(async (f) => {
    try {
      await run(f);
    } finally {
      const { db } = await import('../db');
      await db.execute(sql`DELETE FROM write_receipt WHERE actor_key IN
        (SELECT 'form:' || p.id FROM form_publication p JOIN view v ON v.id=p.view_id WHERE v.table_id=${f.tableId})`);
    }
  });
}
async function publish(f: DbFixture, fields = [{ fieldId: f.numberId, required: true }]) {
  const v = await f.caller.view.create({ tableId: f.tableId, type: 'form', name: 'Amount' });
  await f.caller.view.updateOptions({ id: v.id, options: { form: { title: 'Amount', fields } } });
  return { ...(await f.caller.form.publish({ viewId: v.id, expiresInDays: 30 })), viewId: v.id };
}
async function counts(f: DbFixture, publicationId: string) {
  const { db } = await import('../db');
  const s = await import('../db/schema');
  const records = await db.select().from(s.record).where(eq(s.record.tableId, f.tableId));
  const cells = records.length
    ? await db
        .select()
        .from(s.cell)
        .where(
          inArray(
            s.cell.recordId,
            records.map((r) => r.id),
          ),
        )
    : [];
  const history = cells.length
    ? await db
        .select()
        .from(s.cellHistory)
        .where(
          inArray(
            s.cellHistory.cellId,
            cells.map((c) => c.id),
          ),
        )
    : [];
  const audits = await db
    .select()
    .from(s.formSubmission)
    .where(eq(s.formSubmission.publicationId, publicationId));
  const receipts = await db
    .select()
    .from(s.writeReceipt)
    .where(eq(s.writeReceipt.actorKey, `form:${publicationId}`));
  return { records, cells, history, audits, receipts };
}
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function waitFor(check: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('Expected database lock wait not observed');
}

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('public submission', () => {
  it('accepts zero, replays canonical UUID concurrently, and records anonymous history/expressions', async () =>
    fixture(async (f) => {
      const { submitForm, getPublicForm } = await import('./submission');
      const { db } = await import('../db');
      const { field } = await import('../db/schema');
      const expressionId = randomUUID();
      await db.insert(field).values({
        id: expressionId,
        tableId: f.tableId,
        name: 'Double',
        type: 'expression',
        options: { expression: `{${f.numberId}} * 2`, dependsOn: [f.numberId] },
      });
      const p = await publish(f);
      const input = { requestId: randomUUID(), cells: { [f.numberId]: 0 } };
      expect(
        await Promise.all([
          submitForm(p.token, input),
          submitForm(p.token, { ...input, requestId: input.requestId.toUpperCase() }),
        ]),
      ).toEqual([{ ok: true }, { ok: true }]);
      const rows = await counts(f, p.publicationId);
      expect(rows.records).toHaveLength(1);
      expect(rows.records[0].createdBy).toBeNull();
      expect(rows.cells).toHaveLength(2);
      expect(rows.cells.find((c) => c.fieldId === expressionId)?.value).toBe(0);
      expect(rows.history).toHaveLength(2);
      expect(rows.history.every((h) => h.changedBy === null)).toBe(true);
      expect(rows.audits).toHaveLength(1);
      expect(rows.audits[0].recordId).toBe(rows.records[0].id);
      expect(rows.receipts).toHaveLength(1);
      expect((await getPublicForm(p.token)).fields.map((x) => x.id)).toEqual([f.numberId]);
      await expect(
        submitForm(p.token, { ...input, cells: { [f.numberId]: 1 } }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        submitForm(p.token, { requestId: randomUUID(), cells: { [f.textId]: 'leak' } }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }));

  it('rejects extra prototype-named JSON keys before schema normalization can drop them', async () =>
    fixture(async (f) => {
      const { submitForm } = await import('./submission');
      const p = await publish(f);
      const cells = JSON.parse(`{"${f.numberId}":0,"__proto__":"extra"}`);
      await expect(submitForm(p.token, { requestId: randomUUID(), cells })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect((await counts(f, p.publicationId)).records).toHaveLength(0);
    }));

  it('projects only safe options and configured order, never source metadata or internal IDs', async () =>
    fixture(async (f) => {
      const { db } = await import('../db');
      const { field } = await import('../db/schema');
      const { getPublicForm } = await import('./submission');
      const choice = randomUUID(),
        date = randomUUID();
      await db.insert(field).values([
        {
          id: choice,
          tableId: f.tableId,
          name: 'Choice',
          type: 'single-select',
          options: {
            choices: [{ id: 'a', name: 'A', color: 'red', secret: 'private' }],
            source: { private: 'metadata' },
          },
        },
        {
          id: date,
          tableId: f.tableId,
          name: 'Date',
          type: 'date',
          options: { includeTime: true, source: 'private' },
        },
      ]);
      await db
        .update(field)
        .set({ options: { precision: 2, source: 'private' } })
        .where(eq(field.id, f.numberId));
      const p = await publish(f, [
        { fieldId: choice, required: false },
        { fieldId: date, required: false },
        { fieldId: f.numberId, required: true },
        { fieldId: f.textId, required: false },
      ]);
      const result = await getPublicForm(p.token);
      expect(Object.keys(result).sort()).toEqual([
        'description',
        'fields',
        'successMessage',
        'title',
      ]);
      expect(result.fields).toEqual([
        {
          id: choice,
          name: 'Choice',
          type: 'single-select',
          required: false,
          options: { choices: [{ id: 'a', name: 'A', color: 'red' }] },
        },
        { id: date, name: 'Date', type: 'date', required: false, options: { includeTime: true } },
        {
          id: f.numberId,
          name: 'Amount',
          type: 'number',
          required: true,
          options: { precision: 2 },
        },
        { id: f.textId, name: 'Name', type: 'text', required: false, options: {} },
      ]);
      for (const secret of [f.tableId, f.baseId, f.userId, 'private', 'metadata'])
        expect(JSON.stringify(result)).not.toContain(secret);
    }));

  it('validates required/boolean/select/date values and the strict 50-field/64KiB envelope', async () =>
    fixture(async (f) => {
      const { submitForm } = await import('./submission');
      const boolean = await f.caller.field.create({
        tableId: f.tableId,
        name: 'Agree',
        type: 'boolean',
      });
      const choice = await f.caller.field.create({
        tableId: f.tableId,
        name: 'Choice',
        type: 'multi-select',
        options: { choices: [{ id: 'a', name: 'A', color: 'red' }] },
      });
      const date = await f.caller.field.create({ tableId: f.tableId, name: 'Date', type: 'date' });
      const p = await publish(f, [
        { fieldId: f.numberId, required: true },
        { fieldId: boolean.id, required: true },
        { fieldId: choice.id, required: true },
        { fieldId: date.id, required: false },
      ]);
      const cells = { [f.numberId]: 0, [boolean.id]: true, [choice.id]: ['a'] };
      for (const invalid of [
        {},
        { ...cells, [boolean.id]: false },
        { ...cells, [boolean.id]: null },
        { ...cells, [choice.id]: [] },
        { ...cells, [choice.id]: ['unknown'] },
        { ...cells, [date.id]: 'invalid' },
        { ...cells, [f.numberId]: 'bad' },
      ])
        await expect(
          submitForm(p.token, { requestId: randomUUID(), cells: invalid }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      for (const invalid of [
        { requestId: 'bad', cells },
        { requestId: randomUUID(), cells: [] },
        { requestId: randomUUID(), cells: null },
        { requestId: randomUUID(), cells, ownerId: f.userId },
        {
          requestId: randomUUID(),
          cells: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [String(i), 'a'])),
        },
      ])
        await expect(
          submitForm(p.token, invalid as Parameters<typeof submitForm>[1]),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        submitForm(p.token, { requestId: randomUUID(), cells: { [f.textId]: '字'.repeat(22000) } }),
      ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
      expect((await counts(f, p.publicationId)).records).toHaveLength(0);
      expect(await submitForm(p.token, { requestId: randomUUID(), cells })).toEqual({ ok: true });
    }));

  it.each(['revoke', 'expire', 'demote', 'invalid-config', 'unsupported-type'] as const)(
    'rechecks %s before receipt replay',
    async (operation) =>
      fixture(async (f) => {
        const { submitForm, getPublicForm } = await import('./submission');
        const { db } = await import('../db');
        const { formPublication, baseMember, view, field } = await import('../db/schema');
        const p = await publish(f);
        const input = { requestId: randomUUID(), cells: { [f.numberId]: 1 } };
        await submitForm(p.token, input);
        if (operation === 'revoke') await f.caller.form.revoke({ publicationId: p.publicationId });
        if (operation === 'expire')
          await db
            .update(formPublication)
            .set({ expiresAt: new Date(0) })
            .where(eq(formPublication.id, p.publicationId));
        if (operation === 'demote')
          await db
            .update(baseMember)
            .set({ role: 'editor' })
            .where(and(eq(baseMember.baseId, f.baseId), eq(baseMember.userId, f.userId)));
        if (operation === 'invalid-config')
          await db
            .update(view)
            .set({ options: { form: { title: 'broken' } } })
            .where(eq(view.id, p.viewId));
        if (operation === 'unsupported-type')
          await db.update(field).set({ type: 'user' }).where(eq(field.id, f.numberId));
        await expect(submitForm(p.token, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(getPublicForm(p.token)).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect((await counts(f, p.publicationId)).records).toHaveLength(1);
      }),
  );

  it.each(['expired', 'missing'] as const)(
    'preserves audits and rejects reused IDs when the F receipt is %s',
    async (operation) =>
      fixture(async (f) => {
        const { submitForm } = await import('./submission');
        const { db } = await import('../db');
        const { writeReceipt } = await import('../db/schema');
        const p = await publish(f);
        const input = { requestId: randomUUID(), cells: { [f.numberId]: 1 } };
        await submitForm(p.token, input);
        const where = eq(writeReceipt.actorKey, `form:${p.publicationId}`);
        if (operation === 'expired')
          await db
            .update(writeReceipt)
            .set({ createdAt: new Date(Date.now() - 8 * 86400000) })
            .where(where);
        else await db.delete(writeReceipt).where(where);
        const before = await counts(f, p.publicationId);
        await expect(submitForm(p.token, input)).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(await counts(f, p.publicationId)).toEqual(before);
        expect(await submitForm(p.token, { ...input, requestId: randomUUID() })).toEqual({
          ok: true,
        });
        const after = await counts(f, p.publicationId);
        expect(after.records).toHaveLength(2);
        expect(after.audits).toHaveLength(2);
        expect(after.receipts).toHaveLength(1);
      }),
  );

  it('rolls back records/cells/history/receipt if audit insertion fails', async () =>
    fixture(async (f) => {
      const { submitForm } = await import('./submission');
      const { db } = await import('../db');
      const { cellHistory } = await import('../db/schema');
      const p = await publish(f, [{ fieldId: f.textId, required: true }]);
      const marker = randomUUID();
      const name = sql.identifier(`p3_fail_${marker.replaceAll('-', '')}`);
      await db.execute(
        sql`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''forced audit failure''; END'`,
      );
      try {
        await db.execute(
          sql`CREATE TRIGGER ${name} BEFORE INSERT ON form_submission FOR EACH ROW WHEN (NEW.publication_id = ${sql.raw(`'${p.publicationId}'::uuid`)}) EXECUTE FUNCTION ${name}()`,
        );
        await expect(
          submitForm(p.token, { requestId: randomUUID(), cells: { [f.textId]: marker } }),
        ).rejects.toThrow();
        expect(await counts(f, p.publicationId)).toEqual({
          records: [],
          cells: [],
          history: [],
          audits: [],
          receipts: [],
        });
        expect(
          await db.select().from(cellHistory).where(eq(cellHistory.newValue, marker)),
        ).toHaveLength(0);
      } finally {
        await db.execute(sql`DROP TRIGGER IF EXISTS ${name} ON form_submission`);
        await db.execute(sql`DROP FUNCTION ${name}()`);
      }
    }));

  it('acknowledges active replay after record deletion without resurrecting the record or audit', async () =>
    fixture(async (f) => {
      const { submitForm } = await import('./submission');
      const { db } = await import('../db');
      const { record, cellHistory } = await import('../db/schema');
      const p = await publish(f);
      const input = { requestId: randomUUID(), cells: { [f.numberId]: 1 } };
      await submitForm(p.token, input);
      const before = await counts(f, p.publicationId);
      try {
        await db.delete(record).where(eq(record.id, before.records[0].id));
        expect(await submitForm(p.token, input)).toEqual({ ok: true });
        const after = await counts(f, p.publicationId);
        expect(after.records).toHaveLength(0);
        expect(after.audits).toHaveLength(0);
        expect(after.receipts).toHaveLength(1);
        await expect(
          submitForm(p.token, { ...input, cells: { [f.numberId]: 2 } }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        await f.caller.form.revoke({ publicationId: p.publicationId });
        await expect(submitForm(p.token, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      } finally {
        await db.delete(cellHistory).where(
          inArray(
            cellHistory.cellId,
            before.cells.map((c) => c.id),
          ),
        );
      }
    }));

  it('publishes after commit with no excluded user', async () =>
    fixture(async (f) => {
      const { submitForm } = await import('./submission');
      const realtime = await import('../realtime/publish');
      const p = await publish(f);
      let observed: ReturnType<typeof counts> | undefined;
      const spy = vi.spyOn(realtime, 'publishTableChange').mockImplementation(async () => {
        observed = counts(f, p.publicationId);
        await observed;
      });
      try {
        await submitForm(p.token, { requestId: randomUUID(), cells: { [f.numberId]: 1 } });
        expect(spy).toHaveBeenCalledExactlyOnceWith(f.tableId);
        expect((await observed)?.audits).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    }));

  it.each(['revoke', 'demote', 'projection'] as const)(
    'holds capability through real submission commit while %s waits',
    async (operation) =>
      fixture(async (f) => {
        const { db } = await import('../db');
        const { baseMember } = await import('../db/schema');
        const { submitForm } = await import('./submission');
        const p = await publish(f);
        const input = { requestId: randomUUID(), cells: { [f.numberId]: 1 } };
        const key = `write-receipt:form:${p.publicationId}:${input.requestId}`;
        const held = signal(),
          release = signal();
        const blocker = db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
          held.resolve();
          await release.promise;
        });
        await held.promise;
        const submission = submitForm(p.token, input);
        let mutation: Promise<unknown> | undefined;
        try {
          await waitFor(
            async () =>
              (
                await db.execute(
                  sql`SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=(hashtext(${key})::bigint & 4294967295)::oid AND NOT granted`,
                )
              ).length > 0,
          );
          if (operation === 'demote') {
            const started = signal();
            let pid = 0;
            mutation = db.transaction(async (tx) => {
              pid = Number((await tx.execute(sql`SELECT pg_backend_pid() AS pid`))[0].pid);
              started.resolve();
              await tx
                .update(baseMember)
                .set({ role: 'editor' })
                .where(and(eq(baseMember.baseId, f.baseId), eq(baseMember.userId, f.userId)));
            });
            await started.promise;
            await waitFor(
              async () =>
                (
                  await db.execute(
                    sql`SELECT 1 FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock'`,
                  )
                ).length > 0,
            );
          } else {
            mutation =
              operation === 'revoke'
                ? f.caller.form.revoke({ publicationId: p.publicationId })
                : f.caller.view.updateOptions({
                    id: p.viewId,
                    options: {
                      form: { title: 'Changed', fields: [{ fieldId: f.textId, required: true }] },
                    },
                  });
            await waitFor(
              async () =>
                (
                  await db.execute(
                    sql`SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=(hashtext('view-options:' || ${f.tableId})::bigint & 4294967295)::oid AND NOT granted`,
                  )
                ).length > 0,
            );
          }
        } finally {
          release.resolve();
          await blocker;
        }
        expect(await submission).toEqual({ ok: true });
        await mutation;
        expect((await counts(f, p.publicationId)).audits).toHaveLength(1);
        await expect(submitForm(p.token, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }),
  );
});
