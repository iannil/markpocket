import { z } from 'zod';

import { exportBaseCsv } from '@/server/exports/csv';
import { protectedProcedure, router } from '../init';

export const exportRouter = router({
  exportBase: protectedProcedure
    .input(z.object({ baseId: z.string(), tableIds: z.array(z.string()).optional() }))
    .query(({ ctx, input }) => exportBaseCsv(input.baseId, ctx.session.user.id, input.tableIds)),
});
