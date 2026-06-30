import { protectedProcedure, router } from '../init';
import { ensureDefaultWorkspace } from '@/lib/db-queries';

export const workspaceRouter = router({
  getOrCreateDefault: protectedProcedure.mutation(async () => {
    return ensureDefaultWorkspace();
  }),
});
