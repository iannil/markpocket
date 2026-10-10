import { AsyncLocalStorage } from 'node:async_hooks';
import { TRPCError } from '@trpc/server';
import type { Role } from '@/lib/roles';

export type TokenScope = {
  tokenId: string;
  userId: string;
  baseId: string | null;
  access: 'read' | 'write';
};

const scopes = new AsyncLocalStorage<TokenScope>();

export const currentTokenScope = (): TokenScope | undefined => scopes.getStore();
export const runWithTokenScope = <T>(scope: TokenScope, fn: () => T): T => scopes.run(scope, fn);

/** A capability ceiling; callers must still check the creator's current membership. */
export function assertTokenCapability(baseId: string, minRole: Role): void {
  const scope = currentTokenScope();
  if (!scope) return;
  if (
    (scope.baseId !== null && scope.baseId !== baseId) ||
    (scope.access === 'read' && minRole !== 'viewer')
  ) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Token does not allow this operation' });
  }
}
