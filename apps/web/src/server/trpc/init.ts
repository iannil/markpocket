import { initTRPC, TRPCError } from '@trpc/server';
import { headers } from 'next/headers';

import { auth } from '../auth';

// Single context shared by the fetch-adapter route handler and the RSC caller.
// `headers()` resolves to the incoming request headers in both contexts.
export async function createContext() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  return { session };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not signed in' });
  }
  return next({ ctx: { session: ctx.session } });
});
