import { initTRPC, TRPCError } from '@trpc/server';
import { headers } from 'next/headers';

import { auth } from '../auth';
import { assertAgentProcedure } from '../agent-access/policy';
import { currentTokenScope } from '../agent-access/scope';
import { isPgBusyError, PG_BUSY_MESSAGE } from '../db/pg-errors';

// Single context shared by the fetch-adapter route handler and the RSC caller.
// `headers()` resolves to the incoming request headers in both contexts.
export async function createContext() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  return { session };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

// Cross-package contract: plugin-csv appends this stable token to partial
// CSV-import failure messages (packages/plugin-csv/src/server.ts, the import
// catch block), and the base settings page matches /\[partial-import\]/ on
// the client error message to refresh the grid after a partially-committed
// import (apps/web/src/app/bases/[baseId]/settings/general/page.tsx).
// tRPC v11's TRPCError carries no custom data field — its constructor
// accepts only { message, code, cause } — so the message is the only
// channel, and the errorFormatter below must let it through verbatim.
// The token sits at the START of the message and the formatter matches with
// startsWith on purpose: a substring-anywhere match would let any future
// code path that accidentally splices user input into an internal error
// message ride the token past the masking below.
const PARTIAL_IMPORT_TOKEN = '[partial-import]';

const t = initTRPC.context<Context>().create({
  // Raw driver errors (constraint violations, syntax errors) must not leak
  // table/column names to clients — surface a generic message instead.
  errorFormatter({ shape, error }) {
    // Lock waits are transient and retryable — say so instead of masking.
    // (Call sites wrap the hot transactions in mapBusyToConflict already;
    // this catches any straggler path.)
    if (error.cause != null && isPgBusyError(error.cause)) {
      return { ...shape, message: PG_BUSY_MESSAGE };
    }
    if (
      error.code === 'INTERNAL_SERVER_ERROR' &&
      !(error.cause instanceof TRPCError) &&
      !error.message.startsWith(PARTIAL_IMPORT_TOKEN)
    ) {
      return { ...shape, message: 'Internal server error' };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next, path, type }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not signed in' });
  }
  const scope = currentTokenScope();
  if (scope && scope.userId !== ctx.session.user.id) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Token identity mismatch' });
  }
  assertAgentProcedure(path, type);
  return next({ ctx: { session: ctx.session } });
});
