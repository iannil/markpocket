import { describe, expect, it } from 'vitest';
import { withDbFixture } from '../../testing/pg-fixture';

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('field order', () => {
  it('persists complete order and rejects invalid lists and viewers', async () =>
    withDbFixture(async (f) => {
      await f.caller.field.reorder({ tableId: f.tableId, fieldIds: [f.numberId, f.textId] });
      expect((await f.caller.field.list({ tableId: f.tableId })).map((x) => x.id)).toEqual([
        f.numberId,
        f.textId,
      ]);
      await expect(
        f.caller.field.reorder({ tableId: f.tableId, fieldIds: [f.textId] }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        f.caller.field.reorder({ tableId: f.tableId, fieldIds: [f.textId, f.textId] }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        f.caller.field.reorder({ tableId: f.tableId, fieldIds: [] }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        f.viewer.field.reorder({ tableId: f.tableId, fieldIds: [f.textId, f.numberId] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }));
  it('serializes create with reorder without losing a field', async () =>
    withDbFixture(async (f) => {
      await f.caller.field.reorder({ tableId: f.tableId, fieldIds: [f.textId, f.numberId] });
      const results = await Promise.allSettled([
        f.caller.field.reorder({ tableId: f.tableId, fieldIds: [f.numberId, f.textId] }),
        f.caller.field.create({ tableId: f.tableId, name: 'New', type: 'text' }),
      ]);
      expect(results[1].status).toBe('fulfilled');
      const rows = await f.caller.field.list({ tableId: f.tableId });
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((x) => x.orderIndex)).size).toBe(3);
      if (results[0].status === 'rejected')
        expect(results[0].reason).toMatchObject({ code: 'CONFLICT' });
      else expect(rows.slice(0, 2).map((x) => x.id)).toEqual([f.numberId, f.textId]);
    }));
  it('appends concurrent creates and rejects a stale order after delete', async () =>
    withDbFixture(async (f) => {
      await f.caller.field.reorder({ tableId: f.tableId, fieldIds: [f.textId, f.numberId] });
      const created = await Promise.all([
        f.caller.field.create({ tableId: f.tableId, name: 'Third', type: 'text' }),
        f.caller.field.create({ tableId: f.tableId, name: 'Fourth', type: 'text' }),
      ]);
      expect(created.map((x) => x.orderIndex).sort()).toEqual([2, 3]);
      const before = await f.caller.field.list({ tableId: f.tableId });
      const results = await Promise.allSettled([
        f.caller.field.delete({ id: f.numberId }),
        f.caller.field.reorder({ tableId: f.tableId, fieldIds: before.map((x) => x.id).reverse() }),
      ]);
      expect(results[0].status).toBe('fulfilled');
      if (results[1].status === 'rejected')
        expect(results[1].reason).toMatchObject({ code: 'CONFLICT' });
      const after = await f.caller.field.list({ tableId: f.tableId });
      expect(after).toHaveLength(3);
      expect(after.some((x) => x.id === f.numberId)).toBe(false);
      await expect(
        f.caller.field.reorder({
          tableId: f.tableId,
          fieldIds: [f.textId, created[0]!.id, 'foreign'],
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        f.caller.field.reorder({
          tableId: f.tableId,
          fieldIds: Array.from({ length: 1001 }, (_, i) => String(i)),
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        f.viewer.field.create({ tableId: f.tableId, name: 'Denied', type: 'text' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }));
});
