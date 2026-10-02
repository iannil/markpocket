/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';

// init.ts pulls the auth stack (better-auth + db) at import time — mock both
// so the errorFormatter can be exercised without DATABASE_URL or a real
// auth config.
vi.mock('../auth', () => ({ auth: {} }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));

import { TRPCError } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { publicProcedure, router } from './init';

// Probe router exercising the errorFormatter through the REAL path — the
// fetch adapter is where the formatter is applied, which a createCaller call
// would skip.
const probeRouter = router({
  // Exactly the shape plugin-csv throws on a mid-import DB failure:
  // INTERNAL_SERVER_ERROR + non-TRPCError cause + the contract token in the
  // message (see the import catch block in packages/plugin-csv/src/server.ts).
  partialImport: publicProcedure.query(() => {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message:
        '[partial-import] CSV import failed after 500 row(s) were imported — the table keeps those rows',
      cause: new Error('connection terminated'),
    });
  }),
  // A raw driver error: INTERNAL + non-TRPCError cause, no token — must be
  // masked so table/column names do not leak.
  rawDriver: publicProcedure.query(() => {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'select * from "secrets" — syntax error at or near "from"',
      cause: new Error('syntax error'),
    });
  }),
  // Regression: a TRPCError cause keeps passing through untouched.
  wrappedTrpc: publicProcedure.query(() => {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'wrapped',
      cause: new TRPCError({ code: 'BAD_REQUEST', message: 'inner' }),
    });
  }),
});

async function callError(name: string): Promise<{ message: string; code: string }> {
  const res = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req: new Request(`http://app.local/api/trpc/${name}`, { method: 'GET' }),
    router: probeRouter as any,
    createContext: (async () => ({}) as any) as any,
  });
  const body = (await res.json()) as any;
  // Wire format: error.code is the JSON-RPC number, the tRPC string code
  // rides in error.data.code.
  return { message: body.error.message, code: body.error.data?.code };
}

describe('errorFormatter — [partial-import] contract (review frontend-1)', () => {
  it('lets an INTERNAL + non-TRPCError + token-bearing message through verbatim', async () => {
    const { message, code } = await callError('partialImport');
    expect(code).toBe('INTERNAL_SERVER_ERROR');
    // The settings page matches /\[partial-import\]/ on this message to
    // refresh the grid — losing the token means a stale grid for the user.
    expect(message).toContain('[partial-import]');
    expect(message).toContain('500 row(s)');
  });

  it('still masks INTERNAL driver errors without the token', async () => {
    const { message } = await callError('rawDriver');
    expect(message).toBe('Internal server error');
    expect(message).not.toContain('secrets');
  });

  it('still passes TRPCError-caused internals through unchanged', async () => {
    const { message } = await callError('wrappedTrpc');
    expect(message).toBe('wrapped');
  });
});
