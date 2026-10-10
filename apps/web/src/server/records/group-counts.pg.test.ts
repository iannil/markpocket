import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { withDbFixture } from '../testing/pg-fixture';

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('group counts', () => {
  it('handles empty and ungrouped views, first group and raw JSON key merging', async () =>
    withDbFixture(async (f) => {
      const v = await f.caller.view.create({ tableId: f.tableId, name: 'Counts' });
      expect(await f.viewer.record.groupCounts({ tableId: f.tableId, viewId: v.id })).toEqual({
        total: 0,
        groups: [],
      });
      await expect(
        f.caller.record.groupCounts({ tableId: f.tableId, viewId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        f.caller.record.groupCounts({ tableId: randomUUID(), viewId: v.id }),
      ).rejects.toBeDefined();
      const { db } = await import('../db');
      const { record, cell } = await import('../db/schema');
      for (const value of [null, '', '__empty__', 1, '1', true, 'true', ['a', 'b'], 'a,b']) {
        const id = randomUUID();
        await db.insert(record).values({ id, tableId: f.tableId, createdBy: f.userId });
        if (value !== null)
          await db
            .insert(cell)
            .values({ id: randomUUID(), recordId: id, fieldId: f.textId, value });
      }
      expect(await f.caller.record.groupCounts({ tableId: f.tableId, viewId: v.id })).toEqual({
        total: 9,
        groups: [{ key: null, count: 9 }],
      });
      await f.caller.view.updateOptions({
        id: v.id,
        options: { group: [{ fieldId: f.textId }, { fieldId: f.numberId }] },
      });
      expect(await f.viewer.record.groupCounts({ tableId: f.tableId, viewId: v.id })).toEqual({
        total: 9,
        groups: [
          { key: null, count: 2 },
          { key: '1', count: 2 },
          { key: '__empty__', count: 1 },
          { key: 'a,b', count: 2 },
          { key: 'true', count: 2 },
        ],
      });
      await f.caller.view.updateOptions({
        id: v.id,
        options: { filter: { fieldId: f.textId, operator: 'equals', operand: 'missing' } },
      });
      expect(await f.caller.record.groupCounts({ tableId: f.tableId, viewId: v.id })).toEqual({
        total: 0,
        groups: [],
      });
    }));
  it(
    'counts beyond the first page and applies nested filters',
    async () =>
      withDbFixture(async (f) => {
        for (const size of [100, 100, 1])
          await f.caller.record.writeBatch({
            tableId: f.tableId,
            requestId: randomUUID(),
            rows: Array.from({ length: size }, () => ({
              cells: { [f.textId]: 'A', [f.numberId]: 2 },
            })),
          });
        await f.caller.record.create({ tableId: f.tableId });
        const v = await f.caller.view.create({ tableId: f.tableId, name: 'Grouped' });
        await f.caller.view.updateOptions({
          id: v.id,
          options: { group: [{ fieldId: f.textId }] },
        });
        expect(await f.viewer.record.groupCounts({ tableId: f.tableId, viewId: v.id })).toEqual({
          total: 202,
          groups: [
            { key: null, count: 1 },
            { key: 'A', count: 201 },
          ],
        });
        await f.caller.view.updateOptions({
          id: v.id,
          options: {
            group: [{ fieldId: f.textId }],
            filter: {
              op: 'and',
              conditions: [
                { op: 'or', conditions: [{ fieldId: f.numberId, operator: 'gte', operand: 2 }] },
              ],
            },
          },
        });
        expect(await f.caller.record.groupCounts({ tableId: f.tableId, viewId: v.id })).toEqual({
          total: 201,
          groups: [{ key: 'A', count: 201 }],
        });
      }),
    30000,
  );
});
