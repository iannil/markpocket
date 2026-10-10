import { describe, expect, it } from 'vitest';
import { withDbFixture } from '../testing/pg-fixture';

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('form publications', () => {
  it('rotation immediately invalidates the old capability and field deletion revokes it', async () => {
    await withDbFixture(async (f) => {
      const v = await f.caller.view.create({ tableId: f.tableId, name: 'Contact', type: 'form' });
      await f.caller.view.updateOptions({
        id: v.id,
        options: { form: { title: 'Contact', fields: [{ fieldId: f.textId, required: true }] } },
      });
      const a = await f.caller.form.publish({ viewId: v.id, expiresInDays: 30 });
      const b = await f.caller.form.publish({ viewId: v.id, expiresInDays: 30 });
      const { resolvePublication } = await import('./publications');
      expect(await resolvePublication(a.token)).toBeNull();
      expect((await resolvePublication(b.token))?.viewId).toBe(v.id);
      await f.caller.field.delete({ id: f.textId });
      expect(await resolvePublication(b.token)).toBeNull();
    });
  });
});

// All races use separate real connections and inspect PostgreSQL lock waits.
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { DbFixture } from '../testing/pg-fixture';

async function setup(f: DbFixture) {
  const v = await f.caller.view.create({ tableId: f.tableId, name: 'Contact', type: 'form' });
  const config = { title: 'Contact', fields: [{ fieldId: f.textId, required: true }] };
  await f.caller.view.updateOptions({ id: v.id, options: { form: config } });
  return { v, config };
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
  throw new Error('Expected PostgreSQL lock wait was not observed');
}
async function waitForLifecycleWait(tableId: string) {
  const { db } = await import('../db');
  await waitFor(async () => {
    const rows = await db.execute(sql`SELECT 1 FROM pg_locks WHERE locktype='advisory'
      AND objid = (hashtext('view-options:' || ${tableId})::bigint & 4294967295)::oid AND NOT granted`);
    return rows.length > 0;
  });
}

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('form publication boundaries', () => {
  it('stores only digest and prefix; list exposes metadata; validates expiry bounds', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { formPublication } = await import('../db/schema');
      const { sha256Hex } = await import('../agent-access/tokens');
      const { v } = await setup(f);
      for (const expiresInDays of [0, 366, 1.5]) {
        await expect(f.caller.form.publish({ viewId: v.id, expiresInDays })).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        });
      }
      const a = await f.caller.form.publish({ viewId: v.id, expiresInDays: 1 });
      expect(a.token).toMatch(/^mpf_[a-f0-9]{48}$/);
      const [stored] = await db
        .select()
        .from(formPublication)
        .where(eq(formPublication.id, a.publicationId));
      expect(stored.tokenHash).toBe(sha256Hex(a.token));
      expect(JSON.stringify(stored)).not.toContain(a.token);
      const list = await f.caller.form.list({ viewId: v.id });
      expect(Object.keys(list[0]).sort()).toEqual(['expiresAt', 'id', 'prefix', 'revokedAt']);
      expect(list[0].prefix).toBe(a.token.slice(0, 12));
      expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(86300000);
      await f.caller.form.revoke({ publicationId: a.publicationId });
      const { resolvePublication } = await import('./publications');
      expect(await resolvePublication(a.token)).toBeNull();
    }));

  it('restricts management to owners while editors can configure', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { baseMember } = await import('../db/schema');
      const { v, config } = await setup(f);
      const a = await f.caller.form.publish({ viewId: v.id, expiresInDays: 365 });
      for (const role of ['viewer', 'editor']) {
        await db.update(baseMember).set({ role }).where(eq(baseMember.userId, f.viewerId));
        await expect(
          f.viewer.form.publish({ viewId: v.id, expiresInDays: 30 }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(f.viewer.form.list({ viewId: v.id })).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        await expect(
          f.viewer.form.revoke({ publicationId: a.publicationId }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
      await f.viewer.view.updateOptions({
        id: v.id,
        options: { form: { ...config, title: 'Editor title' } },
      });
      await db.delete(baseMember).where(eq(baseMember.userId, f.viewerId));
      await expect(
        f.viewer.form.publish({ viewId: v.id, expiresInDays: 30 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }));

  it('rejects missing, expired, invalid config, dead field, unsupported type and non-Form publications', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { formPublication, view, field } = await import('../db/schema');
      const { resolvePublication } = await import('./publications');
      const { v, config } = await setup(f);
      expect(await resolvePublication('mpf_' + '0'.repeat(48))).toBeNull();
      expect(await resolvePublication('mpk_wrong')).toBeNull();
      const a = await f.caller.form.publish({ viewId: v.id, expiresInDays: 30 });
      await db
        .update(formPublication)
        .set({ expiresAt: new Date(0) })
        .where(eq(formPublication.id, a.publicationId));
      expect(await resolvePublication(a.token)).toBeNull();
      const b = await f.caller.form.publish({ viewId: v.id, expiresInDays: 30 });
      for (const form of [
        { ...config, fields: [] },
        { ...config, fields: [{ fieldId: 'missing', required: true }] },
      ]) {
        await db.update(view).set({ options: { form } }).where(eq(view.id, v.id));
        expect(await resolvePublication(b.token)).toBeNull();
        await expect(
          f.caller.form.publish({ viewId: v.id, expiresInDays: 30 }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }
      await db
        .update(view)
        .set({ options: { form: config } })
        .where(eq(view.id, v.id));
      await db.update(field).set({ type: 'attachment' }).where(eq(field.id, f.textId));
      expect(await resolvePublication(b.token)).toBeNull();
      await db.update(field).set({ type: 'text' }).where(eq(field.id, f.textId));
      await db.update(view).set({ type: 'grid' }).where(eq(view.id, v.id));
      expect(await resolvePublication(b.token)).toBeNull();
      await expect(
        f.caller.form.publish({ viewId: v.id, expiresInDays: 30 }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }));

  it('invalidates the link on owner demotion or removal', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { baseMember } = await import('../db/schema');
      const { resolvePublication } = await import('./publications');
      const { v } = await setup(f);
      const a = await f.caller.form.publish({ viewId: v.id, expiresInDays: 30 });
      await db.update(baseMember).set({ role: 'editor' }).where(eq(baseMember.userId, f.userId));
      expect(await resolvePublication(a.token)).toBeNull();
      await db.delete(baseMember).where(eq(baseMember.userId, f.userId));
      expect(await resolvePublication(a.token)).toBeNull();
    }));

  it('retains text changes and unselected field changes but revokes projection/required changes', async () =>
    withDbFixture(async (f) => {
      const { resolvePublication } = await import('./publications');
      const { v, config } = await setup(f);
      const a = await f.caller.form.publish({ viewId: v.id, expiresInDays: 30 });
      await f.caller.view.updateOptions({
        id: v.id,
        options: {
          form: { ...config, title: 'New title', description: 'New copy', successMessage: 'Done' },
        },
      });
      await f.caller.field.create({ tableId: f.tableId, name: 'Never included', type: 'text' });
      await f.caller.field.delete({ id: f.numberId });
      expect((await resolvePublication(a.token))?.config.fields).toEqual(config.fields);
      await f.caller.view.updateOptions({
        id: v.id,
        options: { form: { ...config, fields: [{ fieldId: f.textId, required: false }] } },
      });
      expect(await resolvePublication(a.token)).toBeNull();
      const b = await f.caller.form.publish({ viewId: v.id, expiresInDays: 30 });
      await f.caller.view.updateOptions({ id: v.id, options: {} });
      expect(await resolvePublication(b.token)).toBeNull();
    }));

  it('revokes selected select choice changes and preserves empty config and unknown extensions on delete', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { view } = await import('../db/schema');
      const { resolvePublication } = await import('./publications');
      const choice = await f.caller.field.create({
        tableId: f.tableId,
        name: 'Choice',
        type: 'single-select',
        options: { choices: [{ id: 'a', name: 'A', color: '#000000' }] },
      });
      const { v } = await setup(f);
      const form = { title: 'Select', fields: [{ fieldId: choice.id, required: true }] };
      await f.caller.view.updateOptions({ id: v.id, options: { form } });
      const a = await f.caller.form.publish({ viewId: v.id, expiresInDays: 30 });
      await f.caller.field.updateOptions({
        id: choice.id,
        options: { choices: [{ id: 'b', name: 'B', color: '#ffffff' }] },
      });
      expect(await resolvePublication(a.token)).toBeNull();
      const b = await f.caller.form.publish({ viewId: v.id, expiresInDays: 30 });
      await db
        .update(view)
        .set({
          options: {
            form: { ...form, extension: 7 },
            future: { untouched: true },
            hiddenFields: [choice.id],
          },
        })
        .where(eq(view.id, v.id));
      await f.caller.field.delete({ id: choice.id });
      expect(await resolvePublication(b.token)).toBeNull();
      const [stored] = await db.select().from(view).where(eq(view.id, v.id));
      expect(stored.options).toEqual({
        form: { ...form, fields: [], extension: 7 },
        future: { untouched: true },
      });
      await expect(
        f.caller.form.publish({ viewId: v.id, expiresInDays: 30 }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }));

  it('enforces receipt uniqueness and cascades receipts on record and view deletion', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { formPublication, formSubmission, record } = await import('../db/schema');
      const { v } = await setup(f);
      const a = await f.caller.form.publish({ viewId: v.id, expiresInDays: 30 });
      const recordId = randomUUID(),
        requestId = randomUUID();
      await db.insert(record).values({ id: recordId, tableId: f.tableId });
      await db
        .insert(formSubmission)
        .values({ id: randomUUID(), publicationId: a.publicationId, requestId, recordId });
      await expect(
        db
          .insert(formSubmission)
          .values({ id: randomUUID(), publicationId: a.publicationId, requestId, recordId }),
      ).rejects.toThrow();
      await db.delete(record).where(eq(record.id, recordId));
      expect(
        await db
          .select()
          .from(formSubmission)
          .where(eq(formSubmission.publicationId, a.publicationId)),
      ).toHaveLength(0);
      await db.insert(record).values({ id: recordId, tableId: f.tableId });
      await db
        .insert(formSubmission)
        .values({ id: randomUUID(), publicationId: a.publicationId, requestId, recordId });
      await f.caller.view.delete({ id: v.id });
      expect(
        await db.select().from(formPublication).where(eq(formPublication.id, a.publicationId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(formSubmission)
          .where(eq(formSubmission.publicationId, a.publicationId)),
      ).toHaveLength(0);
    }));

  it('serializes simultaneous rotations to exactly one live capability', async () =>
    withDbFixture(async (f) => {
      const { resolvePublication } = await import('./publications');
      const { v } = await setup(f);
      const results = await Promise.all([
        f.caller.form.publish({ viewId: v.id, expiresInDays: 30 }),
        f.caller.form.publish({ viewId: v.id, expiresInDays: 30 }),
      ]);
      expect(
        (await Promise.all(results.map((r) => resolvePublication(r.token)))).filter(Boolean),
      ).toHaveLength(1);
    }));

  it('rechecks publisher ownership after waiting for the lifecycle lock', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { baseMember } = await import('../db/schema');
      const { lockFormLifecycle } = await import('./publications');
      const { v } = await setup(f);
      const held = signal(),
        release = signal();
      const blocker = db.transaction(async (tx) => {
        await lockFormLifecycle(tx, f.tableId);
        held.resolve();
        await release.promise;
      });
      await held.promise;
      const publish = f.caller.form.publish({ viewId: v.id, expiresInDays: 30 });
      const checked = expect(publish).rejects.toMatchObject({ code: 'FORBIDDEN' });
      try {
        await waitForLifecycleWait(f.tableId);
        await db.update(baseMember).set({ role: 'editor' }).where(eq(baseMember.userId, f.userId));
      } finally {
        release.resolve();
      }
      await blocker;
      await checked;
    }));

  it('keeps owner FOR SHARE and lifecycle locks until submission transaction completes', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { baseMember } = await import('../db/schema');
      const { resolvePublication } = await import('./publications');
      const { v } = await setup(f);
      const a = await f.caller.form.publish({ viewId: v.id, expiresInDays: 30 });
      const held = signal(),
        release = signal(),
        started = signal();
      const submission = db.transaction(async (tx) => {
        expect(await resolvePublication(a.token, tx)).not.toBeNull();
        held.resolve();
        await release.promise;
      });
      await held.promise;
      let pid = 0;
      const demotion = db.transaction(async (tx) => {
        const rows = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
        pid = Number(rows[0].pid);
        started.resolve();
        await tx
          .update(baseMember)
          .set({ role: 'editor' })
          .where(and(eq(baseMember.userId, f.userId), eq(baseMember.baseId, f.baseId)));
      });
      await started.promise;
      try {
        await waitFor(
          async () =>
            (
              await db.execute(
                sql`SELECT 1 FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock'`,
              )
            ).length > 0,
        );
      } finally {
        release.resolve();
      }
      await Promise.all([submission, demotion]);
      expect(await resolvePublication(a.token)).toBeNull();
    }));

  it('serializes field deletion behind a resolved submission, then revokes its capability', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { resolvePublication } = await import('./publications');
      const { v } = await setup(f);
      const a = await f.caller.form.publish({ viewId: v.id, expiresInDays: 30 });
      const held = signal(),
        release = signal();
      const submission = db.transaction(async (tx) => {
        expect(await resolvePublication(a.token, tx)).not.toBeNull();
        held.resolve();
        await release.promise;
      });
      await held.promise;
      const deletion = f.caller.field.delete({ id: f.textId });
      try {
        await waitForLifecycleWait(f.tableId);
      } finally {
        release.resolve();
      }
      await Promise.all([submission, deletion]);
      expect(await resolvePublication(a.token)).toBeNull();
    }));
});

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('form lifecycle serialization', () => {
  it.each(['revoke', 'view-delete', 'projection', 'field-options'] as const)(
    '%s waits for the resolved transaction and invalidates subsequent resolution',
    async (operation) =>
      withDbFixture(async (f) => {
        const { db } = await import('../db');
        const { resolvePublication } = await import('./publications');
        const { v, config } = await setup(f);
        let selectedId = f.textId;
        if (operation === 'field-options') {
          const choice = await f.caller.field.create({
            tableId: f.tableId,
            name: 'Choice',
            type: 'single-select',
            options: { choices: [{ id: 'a', name: 'A', color: '#000000' }] },
          });
          selectedId = choice.id;
          await f.caller.view.updateOptions({
            id: v.id,
            options: { form: { ...config, fields: [{ fieldId: selectedId, required: true }] } },
          });
        }
        const a = await f.caller.form.publish({ viewId: v.id, expiresInDays: 30 });
        const held = signal(),
          release = signal();
        const submission = db.transaction(async (tx) => {
          expect(await resolvePublication(a.token, tx)).not.toBeNull();
          held.resolve();
          await release.promise;
        });
        await held.promise;
        const mutation =
          operation === 'revoke'
            ? f.caller.form.revoke({ publicationId: a.publicationId })
            : operation === 'view-delete'
              ? f.caller.view.delete({ id: v.id })
              : operation === 'projection'
                ? f.caller.view.updateOptions({
                    id: v.id,
                    options: {
                      form: { ...config, fields: [{ fieldId: f.numberId, required: true }] },
                    },
                  })
                : f.caller.field.updateOptions({
                    id: selectedId,
                    options: { choices: [{ id: 'b', name: 'B', color: '#ffffff' }] },
                  });
        try {
          await waitForLifecycleWait(f.tableId);
        } finally {
          release.resolve();
        }
        await Promise.all([submission, mutation]);
        expect(await resolvePublication(a.token)).toBeNull();
      }),
  );

  it('publish holds the owner row lock through transaction commit', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { baseMember } = await import('../db/schema');
      const { publishForm, resolvePublication } = await import('./publications');
      const { v } = await setup(f);
      const held = signal(),
        release = signal(),
        started = signal();
      const publishing = db.transaction(async (tx) => {
        const result = await publishForm(tx, v.id, f.userId, 30);
        held.resolve();
        await release.promise;
        return result;
      });
      await held.promise;
      let pid = 0;
      const demotion = db.transaction(async (tx) => {
        const rows = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
        pid = Number(rows[0].pid);
        started.resolve();
        await tx.update(baseMember).set({ role: 'editor' }).where(eq(baseMember.userId, f.userId));
      });
      await started.promise;
      try {
        await waitFor(
          async () =>
            (
              await db.execute(
                sql`SELECT 1 FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock'`,
              )
            ).length > 0,
        );
      } finally {
        release.resolve();
      }
      const [published] = await Promise.all([publishing, demotion]);
      expect(await resolvePublication(published.token)).toBeNull();
    }));

  it('re-reads configuration and fields after waiting behind deletion', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { field } = await import('../db/schema');
      const { lockFormLifecycle } = await import('./publications');
      const { v } = await setup(f);
      const held = signal(),
        release = signal();
      const deletion = db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext('field-order:' || ${f.tableId}))`,
        );
        await lockFormLifecycle(tx, f.tableId);
        await tx.delete(field).where(eq(field.id, f.textId));
        held.resolve();
        await release.promise;
      });
      await held.promise;
      const publish = expect(
        f.caller.form.publish({ viewId: v.id, expiresInDays: 30 }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      try {
        await waitForLifecycleWait(f.tableId);
      } finally {
        release.resolve();
      }
      await Promise.all([deletion, publish]);
    }));
});
