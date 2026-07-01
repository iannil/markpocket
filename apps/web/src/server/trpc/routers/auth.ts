import { user } from '../../db/schema';
import { db } from '../../db';
import { protectedProcedure, router } from '../init';

export const authRouter = router({
  getSession: protectedProcedure.query(({ ctx }) => ctx.session),
  listUsers: protectedProcedure.query(async () => {
    return db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .orderBy(user.name);
  }),
});
