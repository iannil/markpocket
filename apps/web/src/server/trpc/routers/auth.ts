import { publicProcedure, router } from '../init';

export const authRouter = router({
  getSession: publicProcedure.query(({ ctx }) => ctx.session),
});
