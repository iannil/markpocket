import { initTRPC, TRPCError } from '@trpc/server';

// 结构化插件上下文：app 的真实 session（better-auth）结构上可赋值给它。
export interface PluginContext {
  session: { user: { id: string } } | null;
}

const t = initTRPC.context<PluginContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not signed in' });
  }
  return next({ ctx: { session: ctx.session } });
});
