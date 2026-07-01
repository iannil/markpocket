import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { cellHistory, cell, user } from '../../db/schema';
import { db } from '../../db';
import { protectedProcedure, router } from '../init';

export const historyRouter = router({
  list: protectedProcedure
    .input(z.object({ recordId: z.string(), fieldId: z.string() }))
    .query(async ({ input }) => {
      const [cellRow] = await db
        .select({ id: cell.id })
        .from(cell)
        .where(and(eq(cell.recordId, input.recordId), eq(cell.fieldId, input.fieldId)))
        .limit(1);
      if (!cellRow) return [];

      const rows = await db
        .select({
          id: cellHistory.id,
          oldValue: cellHistory.oldValue,
          newValue: cellHistory.newValue,
          changedAt: cellHistory.changedAt,
          changedByName: user.name,
          changedByEmail: user.email,
        })
        .from(cellHistory)
        .leftJoin(user, eq(cellHistory.changedBy, user.id))
        .where(eq(cellHistory.cellId, cellRow.id))
        .orderBy(desc(cellHistory.changedAt))
        .limit(50);

      return rows;
    }),
});
