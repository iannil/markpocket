import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { baseMember, user } from '../../db/schema';
import { db } from '../../db';
import { protectedProcedure, router } from '../init';

export const authRouter = router({
  getSession: protectedProcedure.query(({ ctx }) => ctx.session),
  listUsers: protectedProcedure.query(async ({ ctx }) => {
    // User-directory enumeration guard: return only people the caller already
    // shares a base with (self-join on base_member), not the whole instance.
    // email stays in the shape — the user-field picker falls back to it as the
    // display label when name is null.
    const mine = alias(baseMember, 'caller_member');
    const shared = alias(baseMember, 'user_member');
    return db
      .selectDistinct({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .innerJoin(shared, eq(shared.userId, user.id))
      .innerJoin(mine, and(eq(mine.baseId, shared.baseId), eq(mine.userId, ctx.session.user.id)))
      .orderBy(user.name);
  }),
});
