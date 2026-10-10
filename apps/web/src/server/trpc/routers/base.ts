import { randomUUID } from 'node:crypto';

import { and, desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { attachment, base, baseMember } from '../../db/schema';
import { db } from '../../db';
import { ensureDefaultWorkspace } from '@/lib/db-queries';
import { assertRole } from '@/lib/roles';
import { publishBaseChange, publishKick } from '../../realtime/publish';
import { protectedProcedure, router } from '../init';
import { removeAttachmentFiles } from './table';
import { currentTokenScope } from '../../agent-access/scope';
import { assertAgentProcedure } from '../../agent-access/policy';

export const baseRouter = router({
  // Only bases the user is a member of — membership is the isolation boundary.
  list: protectedProcedure.query(async ({ ctx }) => {
    const ws = await ensureDefaultWorkspace();
    const scope = currentTokenScope();
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
      .where(
        and(
          eq(base.workspaceId, ws.id),
          eq(baseMember.userId, ctx.session.user.id),
          scope?.baseId != null ? eq(base.id, scope.baseId) : undefined,
        ),
      )
      .orderBy(desc(base.createdAt));
  }),

  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    await assertRole(input.id, ctx.session.user.id, 'viewer');
    const [row] = await db.select().from(base).where(eq(base.id, input.id)).limit(1);
    return row ?? null;
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      assertAgentProcedure('base.create', 'mutation');
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
    .input(z.object({ id: z.string(), name: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await assertRole(input.id, ctx.session.user.id, 'editor');
      const [row] = await db
        .update(base)
        .set({ name: input.name })
        .where(eq(base.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Base not found' });
      void publishBaseChange(input.id, ctx.session.user.id);
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertRole(input.id, ctx.session.user.id, 'owner');
      const { orphanedKeys, memberIds } = await db.transaction(async (tx) => {
        // No dead-ref cleanup here, unlike table.delete: every cell this base's
        // cleanup could rewrite cascades away moments later, and every history
        // read path INNER JOINs cell — history rows for those rewrites are
        // invisible to all UIs. The rewrite pass would be pure lock-window
        // cost, so base.delete skips it and lets the FK cascade do the work.
        const attachmentRows = await tx
          .select({ storageKey: attachment.storageKey })
          .from(attachment)
          .where(eq(attachment.baseId, input.id));
        // Member snapshot before the cascade wipes base_member — feeds the
        // post-commit kicks below.
        const memberRows = await tx
          .select({ userId: baseMember.userId })
          .from(baseMember)
          .where(eq(baseMember.baseId, input.id));
        // FK cascade clears tables → fields → cells → records (attachment rows
        // cascade via attachment.base_id).
        await tx.delete(base).where(eq(base.id, input.id));
        return {
          orphanedKeys: attachmentRows.map((a) => a.storageKey),
          memberIds: memberRows.map((m) => m.userId),
        };
      });
      await removeAttachmentFiles(orphanedKeys);

      void publishBaseChange(input.id, ctx.session.user.id);
      // Kick every subscriber off the deleted base's channel — same mechanism
      // as member.remove. Without this, subscribers linger on the channel
      // until the 5-minute membership sweep notices the membership rows are
      // gone.
      for (const userId of memberIds) {
        publishKick(input.id, userId);
      }
      return { ok: true };
    }),
});
