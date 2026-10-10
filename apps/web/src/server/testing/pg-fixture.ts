import { randomUUID } from 'node:crypto';
import { eq, inArray, or } from 'drizzle-orm';
import type { appRouter } from '../trpc/router';
import type { Context } from '../trpc/init';

type Caller = ReturnType<typeof appRouter.createCaller>;
export interface DbFixture {
  userId: string;
  viewerId: string;
  workspaceId: string;
  baseId: string;
  tableId: string;
  textId: string;
  numberId: string;
  caller: Caller;
  viewer: Caller;
}

/** Real PostgreSQL fixture, opt-in and restricted to the isolated P0–P2 database. */
export async function withDbFixture<T>(run: (fixture: DbFixture) => Promise<T>): Promise<T> {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://invalid/invalid');
  if (!url.pathname.startsWith('/markpocket_p0p2_')) {
    throw new Error('Isolated database required');
  }
  // Lazy imports let the normal suite skip PG tests without a DATABASE_URL.
  const { db } = await import('../db');
  const s = await import('../db/schema');
  const { appRouter } = await import('../trpc/router');
  const { ensureDefaultWorkspace } = await import('@/lib/db-queries');
  const userId = randomUUID(),
    viewerId = randomUUID();
  const baseId = randomUUID(),
    tableId = randomUUID();
  const textId = randomUUID(),
    numberId = randomUUID();
  const caller = (id: string) => appRouter.createCaller({ session: { user: { id } } } as Context);
  try {
    const workspace = await ensureDefaultWorkspace();
    await db
      .insert(s.user)
      .values(
        [userId, viewerId].map((id) => ({ id, name: 'Plan fixture', email: `${id}@example.test` })),
      );
    await db.insert(s.base).values({
      id: baseId,
      workspaceId: workspace.id,
      name: `Plan fixture ${baseId}`,
      createdBy: userId,
    });
    await db.insert(s.baseMember).values([
      { baseId, userId, role: 'owner' },
      { baseId, userId: viewerId, role: 'viewer' },
    ]);
    await db.insert(s.table).values({ id: tableId, baseId, name: 'Plan fixture' });
    await db.insert(s.field).values([
      { id: textId, tableId, name: 'Name', type: 'text' },
      { id: numberId, tableId, name: 'Amount', type: 'number' },
    ]);
    return await run({
      userId,
      viewerId,
      workspaceId: workspace.id,
      baseId,
      tableId,
      textId,
      numberId,
      caller: caller(userId),
      viewer: caller(viewerId),
    });
  } finally {
    // History has no FK: remove our users’ history and anonymous history of owned cells.
    // Tests that clear anonymous cells must retain their IDs and clean history explicitly.
    // F3 must also remove its no-FK receipts by these users' actorKey values.
    await db.transaction(async (tx) => {
      const ownedCells = tx
        .select({ id: s.cell.id })
        .from(s.cell)
        .innerJoin(s.record, eq(s.record.id, s.cell.recordId))
        .innerJoin(s.table, eq(s.table.id, s.record.tableId))
        .where(eq(s.table.baseId, baseId));
      await tx
        .delete(s.cellHistory)
        .where(
          or(
            inArray(s.cellHistory.changedBy, [userId, viewerId]),
            inArray(s.cellHistory.cellId, ownedCells),
          ),
        );
      await tx.delete(s.base).where(eq(s.base.id, baseId));
      await tx.delete(s.user).where(inArray(s.user.id, [userId, viewerId]));
    });
    // The single-tenant default workspace is shared and must never be deleted.
  }
}
