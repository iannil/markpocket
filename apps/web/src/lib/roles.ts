import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import { baseMember, table } from '@/server/db/schema';
import { db } from '@/server/db';
import { assertTokenCapability, currentTokenScope } from '@/server/agent-access/scope';

export type Role = 'owner' | 'editor' | 'viewer';

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

// Returns the user's role in a base, or null if they are not a member.
// Membership is only ever created by base.create (owner) or the invite accept flow.
export async function getMembership(baseId: string, userId: string): Promise<Role | null> {
  const [existing] = await db
    .select()
    .from(baseMember)
    .where(and(eq(baseMember.baseId, baseId), eq(baseMember.userId, userId)))
    .limit(1);
  return existing ? (existing.role as Role) : null;
}

export async function assertRole(baseId: string, userId: string, minRole: Role): Promise<void> {
  const scope = currentTokenScope();
  if (scope && scope.userId !== userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Token identity mismatch' });
  }
  assertTokenCapability(baseId, minRole);
  const role = await getMembership(baseId, userId);
  if (!role) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this base' });
  }
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Requires ${minRole} role (you are ${role})`,
    });
  }
}

// Resolve baseId from tableId for table-scoped procedures
export async function baseIdFromTable(tableId: string): Promise<string | null> {
  const [row] = await db
    .select({ baseId: table.baseId })
    .from(table)
    .where(eq(table.id, tableId))
    .limit(1);
  return row?.baseId ?? null;
}

// Combined gate: resolve the table's base, then assert membership + role.
// Every table-scoped read AND write goes through this.
export async function assertTableRole(
  tableId: string,
  userId: string,
  minRole: Role,
): Promise<void> {
  const baseId = await baseIdFromTable(tableId);
  if (!baseId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found' });
  }
  await assertRole(baseId, userId, minRole);
}
