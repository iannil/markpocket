import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { countRecords, listRecordsPivoted } from '@/lib/db-queries';
import { record } from '../../db/schema';
import { db } from '../../db';
import { protectedProcedure, router } from '../init';

export const recordRouter = router({
  list: protectedProcedure
    .input(z.object({ tableId: z.string(), offset: z.number().int().min(0).optional() }))
    .query(async ({ input }) => {
      const offset = input.offset ?? 0;
      const [records, total] = await Promise.all([
        listRecordsPivoted(input.tableId, offset, 100),
        countRecords(input.tableId),
      ]);
      return { records, total };
    }),

  create: protectedProcedure
    .input(z.object({ tableId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .insert(record)
        .values({
          id: randomUUID(),
          tableId: input.tableId,
          createdBy: ctx.session.user.id,
        })
        .returning();
      return row;
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    // FK cascade clears the record's cells.
    await db.delete(record).where(eq(record.id, input.id));
    return { ok: true };
  }),
});
