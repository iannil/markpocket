import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import { baseMember } from '@/server/db/schema';
import { db } from '@/server/db';

export type Role = 'owner' | 'editor' | 'viewer';

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

export async function ensureMembership(baseId: string, userId: string): Promise<Role> {
  const [existing] = await db
    .select()
    .from(baseMember)
    .where(and(eq(baseMember.baseId, baseId), eq(baseMember.userId, userId)))
    .limit(1);

  if (existing) return existing.role as Role;

  // Auto-add as editor for single-tenant model
  await db.insert(baseMember).values({ baseId, userId, role: 'editor' });
  return 'editor';
}

export async function assertRole(baseId: string, userId: string, minRole: Role): Promise<void> {
  const role = await ensureMembership(baseId, userId);
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
