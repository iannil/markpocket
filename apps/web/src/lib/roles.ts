import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import { baseMember } from '@/server/db/schema';
import { db } from '@/server/db';

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

// Resolve baseId from tableId for table-scoped mutations
export async function baseIdFromTable(tableId: string): Promise<string | null> {
  const { table } = await import('@/server/db/schema');
  const [row] = await db
    .select({ baseId: table.baseId })
    .from(table)
    .where(eq(table.id, tableId))
    .limit(1);
  return row?.baseId ?? null;
}
