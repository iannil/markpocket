import { TRPCError } from '@trpc/server';
import { currentTokenScope } from './scope';

// Deliberately closed: adding a procedure to this surface requires scope tests.
const READ = new Set([
  'base.list',
  'base.get',
  'table.list',
  'table.get',
  'field.list',
  'view.list',
  'record.list',
  'record.get',
  'record.groupCounts',
  'record.kanbanPage',
]);
const WRITE = new Set([
  'base.create',
  'base.rename',
  'base.delete',
  'table.create',
  'table.rename',
  'table.delete',
  'field.create',
  'field.rename',
  'field.updateOptions',
  'field.delete',
  'view.create',
  'view.rename',
  'view.updateOptions',
  'view.delete',
  'record.create',
  'record.delete',
  'cell.upsert',
]);

export function assertAgentProcedure(
  path: string,
  type: 'query' | 'mutation' | 'subscription',
): void {
  const scope = currentTokenScope();
  if (!scope) return;
  if (!((type === 'query' && READ.has(path)) || (type === 'mutation' && WRITE.has(path)))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Procedure is not available to API tokens' });
  }
  if (scope.access === 'read' && type !== 'query') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Read-only token' });
  }
  if (scope.baseId !== null && path === 'base.create') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Token is bound to a base' });
  }
}
