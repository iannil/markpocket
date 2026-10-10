import { appRouter } from '../trpc/router';
import type { Context } from '../trpc/init';

// The caller type comes from the router itself — annotating agentCaller's
// return with a type derived FROM agentCaller would be circular.
export type AgentCaller = ReturnType<typeof appRouter.createCaller>;

/**
 * Server-side tRPC caller for token-authenticated agent requests (ADR-0010).
 * The context is a strict subset of better-auth's session — every procedure
 * reachable from the agent surface reads at most `session.user.id` (verified:
 * no procedure or helper under server/ calls headers()/cookies() itself).
 *
 * Because the session synthesizes a real user id, ALL role checks
 * (assertRole / assertTableRole inside each procedure) intersect current
 * membership with the AsyncLocalStorage token scope set by handleAgentRequest.
 * The protected-procedure allowlist also rejects unpublished capabilities.
 */
export function agentCaller(userId: string) {
  return appRouter.createCaller({ session: { user: { id: userId } } } as unknown as Context);
}
