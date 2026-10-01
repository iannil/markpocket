import { randomUUID } from 'node:crypto';

import { and, desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { base, baseMember } from '../../db/schema';
import { db } from '../../db';
import { ensureDefaultWorkspace } from '@/lib/db-queries';
import { assertRole } from '@/lib/roles';
import { publishBaseChange } from '../../realtime/publish';
import { protectedProcedure, router } from '../init';

export const baseRouter = router({
  // Only bases the user is a member of — membership is the isolation boundary.
  list: protectedProcedure.query(async ({ ctx }) => {
    const ws = await ensureDefaultWorkspace();
    return db
      .select({
        id: base.id,
        workspaceId: base.workspaceId,
        name: base.name,
        icon: base.icon,
        createdAt: base.createdAt,
        createdBy: base.createdBy,
      })
      .from(base)
      .innerJoin(baseMember, eq(baseMember.baseId, base.id))
      .where(and(eq(base.workspaceId, ws.id), eq(baseMember.userId, ctx.session.user.id)))
      .orderBy(desc(base.createdAt));
  }),

  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    await assertRole(input.id, ctx.session.user.id, 'viewer');
    const [row] = await db.select().from(base).where(eq(base.id, input.id)).limit(1);
    return row ?? null;
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const ws = await ensureDefaultWorkspace();
      // base + owner membership atomically — no ownerless base can survive a failure.
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(base)
          .values({
            id: randomUUID(),
            workspaceId: ws.id,
            name: input.name,
            createdBy: ctx.session.user.id,
          })
          .returning();
        // Creator becomes owner; nothing can be done without this membership row.
        await tx.insert(baseMember).values({
          baseId: row!.id,
          userId: ctx.session.user.id,
          role: 'owner',
        });
        return row!;
      });
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertRole(input.id, ctx.session.user.id, 'editor');
      const [row] = await db
        .update(base)
        .set({ name: input.name })
        .where(eq(base.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      void publishBaseChange(input.id);
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertRole(input.id, ctx.session.user.id, 'owner');
      // FK cascade clears tables → fields → cells → records.
      await db.delete(base).where(eq(base.id, input.id));
      void publishBaseChange(input.id);
      return { ok: true };
    }),
});
