import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withDbFixture, type DbFixture } from '../testing/pg-fixture';

async function board(f: DbFixture) {
  const status = await f.caller.field.create({
    tableId: f.tableId,
    name: 'Status',
    type: 'single-select',
    options: {
      choices: [
        { id: 'todo', name: 'Todo', color: 'blue' },
        { id: 'done', name: 'Done', color: 'green' },
        { id: '__empty__', name: 'Literal', color: 'gray' },
      ],
    },
  });
  const v = await f.caller.view.create({ tableId: f.tableId, name: 'Board', type: 'kanban' });
  const kanban = { groupFieldId: status.id, titleFieldId: f.textId };
  await f.caller.view.updateOptions({ id: v.id, options: { kanban } });
  return { status, v, kanban };
}

const badConfig = { code: 'BAD_REQUEST', message: 'Configure a status field for this board' };

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('kanban pages', () => {
  it(
    'paginates each lane beyond 50, ANDs nested filters, and deterministically sorts ties',
    async () =>
      withDbFixture(async (f) => {
        const { status, v, kanban } = await board(f);
        await f.caller.record.writeBatch({
          tableId: f.tableId,
          requestId: randomUUID(),
          rows: Array.from({ length: 60 }, (_, i) => ({
            cells: { [status.id]: 'todo', [f.textId]: `Card ${i}`, [f.numberId]: i % 2 },
          })),
        });
        await f.caller.record.writeBatch({
          tableId: f.tableId,
          requestId: randomUUID(),
          rows: [
            { cells: { [status.id]: 'done', [f.numberId]: 1 } },
            { cells: { [f.textId]: 'Unassigned', [f.numberId]: 1 } },
          ],
        });
        const { db } = await import('../db');
        const { record } = await import('../db/schema');
        await db
          .update(record)
          .set({ createdAt: new Date('2026-01-01') })
          .where(eq(record.tableId, f.tableId));
        const lane = { tableId: f.tableId, viewId: v.id, choiceId: 'todo' };
        const first = await f.viewer.record.kanbanPage(lane);
        const second = await f.viewer.record.kanbanPage({ ...lane, offset: 50 });
        expect(first.total).toBe(60);
        expect(first.records).toHaveLength(50);
        expect(second.total).toBe(60);
        expect(second.records).toHaveLength(10);
        const ids = [...first.records, ...second.records].map((r) => r.id);
        expect(new Set(ids).size).toBe(60);
        expect(ids).toEqual([...ids].sort().reverse());
        expect(await f.viewer.record.kanbanPage(lane)).toEqual(first);
        expect((await f.caller.record.kanbanPage({ ...lane, offset: 100 })).records).toEqual([]);
        const empty = await f.viewer.record.kanbanPage({ ...lane, choiceId: null });
        expect(empty.total).toBe(1);
        expect(empty.records[0]?.cells[f.textId]).toBe('Unassigned');
        expect((await f.viewer.record.kanbanPage({ ...lane, choiceId: 'done' })).total).toBe(1);
        await f.caller.view.updateOptions({
          id: v.id,
          options: { kanban, sort: [{ fieldId: f.numberId, direction: 'asc' }] },
        });
        const sorted = [
          ...(await f.viewer.record.kanbanPage(lane)).records,
          ...(await f.viewer.record.kanbanPage({ ...lane, offset: 50 })).records,
        ];
        expect(sorted.map((r) => r.cells[f.numberId])).toEqual([
          ...Array(30).fill(0),
          ...Array(30).fill(1),
        ]);
        for (const n of [0, 1]) {
          const group = sorted.filter((r) => r.cells[f.numberId] === n).map((r) => r.id);
          expect(group).toEqual([...group].sort().reverse());
        }
        await f.caller.view.updateOptions({
          id: v.id,
          options: {
            kanban,
            group: [{ fieldId: f.textId }],
            filter: {
              op: 'or',
              conditions: [
                {
                  op: 'and',
                  conditions: [
                    { fieldId: f.numberId, operator: 'gte', operand: 1 },
                    { fieldId: f.numberId, operator: 'lte', operand: 1 },
                  ],
                },
              ],
            },
          },
        });
        const filtered = await f.viewer.record.kanbanPage(lane);
        expect(filtered.total).toBe(30);
        expect(filtered.records).toHaveLength(30);
        expect(
          filtered.records.every((r) => r.cells[status.id] === 'todo' && r.cells[f.numberId] === 1),
        ).toBe(true);
        expect(await f.viewer.record.groupCounts({ tableId: f.tableId, viewId: v.id })).toEqual({
          total: 32,
          groups: [
            { key: null, count: 1 },
            { key: 'done', count: 1 },
            { key: 'todo', count: 30 },
          ],
        });
        for (const input of [{ limit: 0 }, { limit: 51 }, { offset: -1 }, { limit: 1.5 }])
          await expect(f.viewer.record.kanbanPage({ ...lane, ...input })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
          });
        await expect(
          f.viewer.view.updateOptions({ id: v.id, options: { kanban } }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }),
    30000,
  );

  it('keeps missing, SQL null, JSON null and empty strings separate from unavailable and literal keys', async () =>
    withDbFixture(async (f) => {
      const { status, v } = await board(f);
      const { db } = await import('../db');
      const { record, cell } = await import('../db/schema');
      const values = [
        undefined,
        null,
        '',
        'removed',
        '__empty__',
        '__unavailable__',
        'todo',
        'x"\' OR TRUE --',
        42,
      ];
      const byValue = new Map<unknown, string>();
      for (const value of values) {
        const id = randomUUID();
        byValue.set(value, id);
        await db.insert(record).values({ id, tableId: f.tableId, createdBy: f.userId });
        if (value !== undefined)
          await db.insert(cell).values({
            id: randomUUID(),
            recordId: id,
            fieldId: status.id,
            value: value === null ? sql`'null'::jsonb` : value,
          });
      }
      const sqlNullId = randomUUID();
      await db.insert(record).values({ id: sqlNullId, tableId: f.tableId, createdBy: f.userId });
      await db
        .insert(cell)
        .values({ id: randomUUID(), recordId: sqlNullId, fieldId: status.id, value: sql`NULL` });
      const lane = { tableId: f.tableId, viewId: v.id };
      const empty = await f.viewer.record.kanbanPage({ ...lane, choiceId: null });
      expect(empty.total).toBe(4);
      expect(new Set(empty.records.map((r) => r.id))).toEqual(
        new Set([byValue.get(undefined), byValue.get(null), byValue.get(''), sqlNullId]),
      );
      const unavailable = await f.viewer.record.kanbanPage({
        ...lane,
        choiceId: '__unavailable__',
      });
      expect(unavailable.total).toBe(4);
      expect(new Set(unavailable.records.map((r) => r.id))).toEqual(
        new Set(['removed', '__unavailable__', 'x"\' OR TRUE --', 42].map((v) => byValue.get(v))),
      );
      expect(
        (await f.viewer.record.kanbanPage({ ...lane, choiceId: '__empty__' })).records.map(
          (r) => r.id,
        ),
      ).toEqual([byValue.get('__empty__')]);
      expect((await f.viewer.record.kanbanPage({ ...lane, choiceId: 'done' })).total).toBe(0);
      await expect(
        f.viewer.record.kanbanPage({ ...lane, choiceId: 'removed' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const counts = await f.viewer.record.groupCounts(lane);
      expect(counts.total).toBe(10);
      expect(counts.groups).toContainEqual({ key: null, count: 4 });
      expect(counts.groups).toContainEqual({ key: '__empty__', count: 1 });
      expect(counts.groups).toContainEqual({ key: 'removed', count: 1 });
    }));

  it('cleans Grid references despite invalid Kanban/Form drafts while preserving raw extensions', async () =>
    withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { view } = await import('../db/schema');
      const v = await f.caller.view.create({ tableId: f.tableId, name: 'Legacy config' });
      const preserved = {
        kanban: { groupFieldId: '', extension: 'keep' },
        form: { title: 'Empty draft', fields: [], extension: 'keep' },
        future: { nested: ['untouched'] },
        columnWidth: { [f.textId]: 120 },
      };
      await db
        .update(view)
        .set({
          options: {
            ...preserved,
            filter: {
              op: 'and',
              conditions: [
                { fieldId: f.textId, operator: 'empty' },
                { fieldId: f.numberId, operator: 'notEmpty' },
              ],
            },
            sort: [{ fieldId: f.textId, direction: 'asc' }],
            group: [{ fieldId: f.textId }],
            hiddenFields: [f.textId],
          },
        })
        .where(eq(view.id, v.id));
      await f.caller.field.delete({ id: f.textId });
      const [stored] = await db.select().from(view).where(eq(view.id, v.id));
      expect(stored.options).toEqual({
        ...preserved,
        filter: { op: 'and', conditions: [{ fieldId: f.numberId, operator: 'notEmpty' }] },
      });
    }));

  it(
    'validates configuration, choices, view ownership and types and fails closed after field deletion',
    async () =>
      withDbFixture(async (f) => {
        const { status, v, kanban } = await board(f);
        const { db } = await import('../db');
        const { field, view } = await import('../db/schema');
        const input = { tableId: f.tableId, viewId: v.id, choiceId: null };
        const grid = await f.caller.view.create({ tableId: f.tableId, name: 'Grid' });
        await expect(
          f.caller.record.kanbanPage({ ...input, viewId: grid.id }),
        ).rejects.toMatchObject(badConfig);
        await expect(
          f.caller.view.updateOptions({ id: grid.id, options: { kanban } }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(
          f.caller.record.kanbanPage({ ...input, viewId: randomUUID() }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        for (const config of [
          {},
          { groupFieldId: '' },
          { groupFieldId: f.textId },
          { groupFieldId: randomUUID() },
          { ...kanban, titleFieldId: randomUUID() },
        ]) {
          await expect(
            f.caller.view.updateOptions({ id: v.id, options: { kanban: config } }),
          ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        }
        const checkbox = await f.caller.field.create({
          tableId: f.tableId,
          name: 'Checked',
          type: 'boolean',
        });
        await expect(
          f.caller.view.updateOptions({
            id: v.id,
            options: { kanban: { ...kanban, titleFieldId: checkbox.id } },
          }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        for (const type of ['text', 'number', 'date', 'single-select'] as const) {
          const title = await f.caller.field.create({ tableId: f.tableId, name: type, type });
          await f.caller.view.updateOptions({
            id: v.id,
            options: { kanban: { ...kanban, titleFieldId: title.id } },
          });
        }
        const choices = (length: number) =>
          Array.from({ length }, (_, i) => ({ id: `c${i}`, name: `C${i}`, color: 'blue' }));
        await db
          .update(field)
          .set({ options: { choices: choices(100) } })
          .where(eq(field.id, status.id));
        await f.caller.view.updateOptions({ id: v.id, options: { kanban } });
        await db
          .update(field)
          .set({ options: { choices: choices(101) } })
          .where(eq(field.id, status.id));
        await expect(
          f.caller.view.updateOptions({ id: v.id, options: { kanban } }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(f.caller.record.kanbanPage(input)).rejects.toMatchObject(badConfig);
        const reservedOptions = {
          choices: [{ id: '__unavailable__', name: 'Existing Grid choice', color: 'blue' }],
        };
        await db.update(field).set({ options: reservedOptions }).where(eq(field.id, status.id));
        await expect(
          f.caller.view.updateOptions({ id: v.id, options: { kanban } }),
        ).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          message: expect.stringContaining('__unavailable__'),
        });
        expect((await db.select().from(field).where(eq(field.id, status.id)))[0]?.options).toEqual(
          reservedOptions,
        );
        await expect(f.caller.record.kanbanPage(input)).rejects.toMatchObject(badConfig);
        await expect(
          f.caller.record.groupCounts({ tableId: f.tableId, viewId: v.id }),
        ).rejects.toMatchObject(badConfig);
        await db.update(field).set({ options: status.options }).where(eq(field.id, status.id));
        for (const options of [
          {},
          { kanban: { groupFieldId: '' } },
          { kanban, filter: { fieldId: f.textId, operator: 'unsupported' } },
          { kanban, filter: { fieldId: 'gone', operator: 'empty' } },
        ]) {
          await db.update(view).set({ options }).where(eq(view.id, v.id));
          await expect(f.caller.record.kanbanPage(input)).rejects.toMatchObject(badConfig);
          await expect(
            f.caller.record.groupCounts({ tableId: f.tableId, viewId: v.id }),
          ).rejects.toMatchObject(badConfig);
        }
        await f.caller.view.updateOptions({ id: v.id, options: { kanban } });
        await db.update(field).set({ type: 'text' }).where(eq(field.id, status.id));
        await expect(f.caller.record.kanbanPage(input)).rejects.toMatchObject(badConfig);
        await db.update(field).set({ type: 'single-select' }).where(eq(field.id, status.id));
        await withDbFixture(async (other) => {
          const foreign = await board(other);
          await expect(
            f.viewer.record.kanbanPage({ ...input, tableId: other.tableId, viewId: foreign.v.id }),
          ).rejects.toMatchObject({ code: 'FORBIDDEN' });
          await expect(
            f.viewer.record.kanbanPage({ ...input, viewId: foreign.v.id }),
          ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
          await expect(
            f.caller.view.updateOptions({
              id: v.id,
              options: { kanban: { groupFieldId: foreign.status.id } },
            }),
          ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
          await expect(
            f.caller.view.updateOptions({
              id: v.id,
              options: { kanban: { ...kanban, titleFieldId: other.textId } },
            }),
          ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        });
        await f.caller.field.delete({ id: status.id });
        await expect(f.caller.record.kanbanPage(input)).rejects.toMatchObject(badConfig);
        await expect(
          f.caller.record.groupCounts({ tableId: f.tableId, viewId: v.id }),
        ).rejects.toMatchObject(badConfig);
      }),
    30000,
  );
});
