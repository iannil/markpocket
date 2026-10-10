import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withDbFixture } from './pg-fixture';

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('isolated PostgreSQL fixture', () => {
  it('gives an owner and viewer distinct permissions in the default workspace', async () => {
    await withDbFixture(async (f) => {
      expect((await f.caller.record.list({ tableId: f.tableId })).total).toBe(0);
      expect((await f.caller.base.list()).some((b) => b.id === f.baseId)).toBe(true);
      await expect(f.viewer.record.create({ tableId: f.tableId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await f.caller.record.create({ tableId: f.tableId });
      expect((await f.viewer.record.list({ tableId: f.tableId })).total).toBe(1);
    });
  });

  it('cleans its own resources after a callback fails and preserves other fixtures', async () => {
    const { db } = await import('../db');
    const s = await import('../db/schema');
    await withDbFixture(async (outer) => {
      let removed: { baseId: string; userId: string; viewerId: string } | undefined;
      const failure = new Error('fixture callback failed');
      await expect(
        withDbFixture(async (inner) => {
          removed = inner;
          await inner.caller.record.create({ tableId: inner.tableId });
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(await db.select().from(s.base).where(eq(s.base.id, removed!.baseId))).toHaveLength(0);
      expect(
        await db
          .select()
          .from(s.user)
          .where(inArray(s.user.id, [removed!.userId, removed!.viewerId])),
      ).toHaveLength(0);
      expect((await outer.caller.base.list()).some((b) => b.id === outer.baseId)).toBe(true);
      expect(
        await db.select().from(s.workspace).where(eq(s.workspace.id, outer.workspaceId)),
      ).toHaveLength(1);
    });
  });
});

it('rejects an unisolated database before loading PostgreSQL', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://localhost/markpocket_dev';
  try {
    await expect(withDbFixture(async () => undefined)).rejects.toThrow(
      'Isolated database required',
    );
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
