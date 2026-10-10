import { describe, expect, it } from 'vitest';
import { withDbFixture } from '../../testing/pg-fixture';

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('record detail access', () => {
  it('requires the exact owning table, returns stored cells to viewers and rejects missing records', async () =>
    withDbFixture(async (f) => {
      const r = await f.caller.record.create({ tableId: f.tableId });
      await f.caller.cell.upsert({ recordId: r.id, fieldId: f.textId, value: 'Detail value' });
      const other = await f.caller.table.create({ baseId: f.baseId, name: 'Other' });
      await expect(f.caller.record.get({ tableId: other.id, id: r.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await f.viewer.record.get({ tableId: f.tableId, id: r.id })).toMatchObject({
        id: r.id,
        cells: { [f.textId]: 'Detail value' },
      });
      await expect(
        f.viewer.record.get({ tableId: f.tableId, id: 'missing' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        f.viewer.cell.upsert({ recordId: r.id, fieldId: f.textId, value: 'Denied' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }));
});
