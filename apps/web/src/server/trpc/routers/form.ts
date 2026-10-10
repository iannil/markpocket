import { desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { db } from '../../db';
import { mapBusyToConflict } from '../../db/pg-errors';
import { formPublication, view } from '../../db/schema';
import { assertFormOwner, lockFormLifecycle, publishForm } from '../../forms/publications';
import { protectedProcedure, router } from '../init';

export const formRouter = router({
  publish: protectedProcedure
    .input(z.object({ viewId: z.string(), expiresInDays: z.number().int().min(1).max(365) }))
    .mutation(({ ctx, input }) =>
      mapBusyToConflict(
        db.transaction((tx) =>
          publishForm(tx, input.viewId, ctx.session.user.id, input.expiresInDays),
        ),
      ),
    ),
  revoke: protectedProcedure
    .input(z.object({ publicationId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      mapBusyToConflict(
        db.transaction(async (tx) => {
          const [row] = await tx
            .select({ tableId: view.tableId })
            .from(formPublication)
            .innerJoin(view, eq(view.id, formPublication.viewId))
            .where(eq(formPublication.id, input.publicationId));
          if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Publication not found' });
          await lockFormLifecycle(tx, row.tableId);
          await assertFormOwner(tx, row.tableId, ctx.session.user.id);
          await tx
            .update(formPublication)
            .set({ revokedAt: new Date() })
            .where(eq(formPublication.id, input.publicationId));
          return { ok: true as const };
        }),
      ),
    ),
  list: protectedProcedure.input(z.object({ viewId: z.string() })).query(({ ctx, input }) =>
    mapBusyToConflict(
      db.transaction(async (tx) => {
        const [row] = await tx
          .select({ tableId: view.tableId })
          .from(view)
          .where(eq(view.id, input.viewId));
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'View not found' });
        await assertFormOwner(tx, row.tableId, ctx.session.user.id);
        return tx
          .select({
            id: formPublication.id,
            prefix: formPublication.prefix,
            expiresAt: formPublication.expiresAt,
            revokedAt: formPublication.revokedAt,
          })
          .from(formPublication)
          .where(eq(formPublication.viewId, input.viewId))
          .orderBy(desc(formPublication.createdAt));
      }),
    ),
  ),
});
