import { randomUUID } from 'node:crypto';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { base, baseInvite, baseMember, user } from '../../db/schema';
import { db } from '../../db';
import { assertRole } from '@/lib/roles';
import { protectedProcedure, router, publicProcedure } from '../init';

const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48h

export const inviteRouter = router({
  list: protectedProcedure.input(z.object({ baseId: z.string() })).query(async ({ ctx, input }) => {
    await assertRole(input.baseId, ctx.session.user.id, 'viewer');
    return db
      .select({
        id: baseInvite.id,
        email: baseInvite.email,
        role: baseInvite.role,
        createdAt: baseInvite.createdAt,
        expiresAt: baseInvite.expiresAt,
        acceptedAt: baseInvite.acceptedAt,
        invitedByName: user.name,
      })
      .from(baseInvite)
      .leftJoin(user, eq(baseInvite.invitedBy, user.id))
      .where(and(eq(baseInvite.baseId, input.baseId), isNull(baseInvite.acceptedAt)))
      .orderBy(desc(baseInvite.createdAt));
  }),

  create: protectedProcedure
    .input(
      z.object({
        baseId: z.string(),
        email: z.string().email().toLowerCase(),
        role: z.enum(['editor', 'viewer']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRole(input.baseId, ctx.session.user.id, 'owner');
      // Deactivate any prior pending invite for this email+base.
      const existing = await db
        .select()
        .from(baseInvite)
        .where(
          and(
            eq(baseInvite.baseId, input.baseId),
            eq(baseInvite.email, input.email),
            isNull(baseInvite.acceptedAt),
          ),
        );
      for (const inv of existing) {
        await db
          .update(baseInvite)
          .set({ acceptedAt: new Date() })
          .where(eq(baseInvite.id, inv.id));
      }
      const [row] = await db
        .insert(baseInvite)
        .values({
          id: randomUUID(),
          baseId: input.baseId,
          email: input.email,
          role: input.role,
          token: randomUUID().replace(/-/g, ''),
          invitedBy: ctx.session.user.id,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        })
        .returning();
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [inv] = await db.select().from(baseInvite).where(eq(baseInvite.id, input.id)).limit(1);
      if (!inv) return { ok: true };
      await assertRole(inv.baseId, ctx.session.user.id, 'owner');
      // Soft-delete: mark acceptedAt so it no longer resolves.
      await db
        .update(baseInvite)
        .set({ acceptedAt: new Date() })
        .where(eq(baseInvite.id, input.id));
      return { ok: true };
    }),

  resolve: publicProcedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
    const [inv] = await db
      .select()
      .from(baseInvite)
      .where(eq(baseInvite.token, input.token))
      .limit(1);
    if (!inv) return null;
    if (inv.acceptedAt) return null;
    if (new Date(inv.expiresAt) < new Date()) return null;
    const [baseRow] = await db
      .select({ id: base.id, name: base.name })
      .from(base)
      .where(eq(base.id, inv.baseId))
      .limit(1);
    if (!baseRow) return null;
    return { baseId: inv.baseId, baseName: baseRow.name, email: inv.email, role: inv.role };
  }),

  accept: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [inv] = await db
        .select()
        .from(baseInvite)
        .where(eq(baseInvite.token, input.token))
        .limit(1);
      if (!inv) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite not found' });
      if (inv.acceptedAt) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Already accepted' });
      if (new Date(inv.expiresAt) < new Date())
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite expired' });
      // The invite's target email must match the signed-in user's email.
      if (inv.email !== ctx.session.user.email?.toLowerCase())
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `This invite is for ${inv.email}. Sign in with that account.`,
        });
      // Upsert membership with the invited role.
      const [existing] = await db
        .select()
        .from(baseMember)
        .where(and(eq(baseMember.baseId, inv.baseId), eq(baseMember.userId, ctx.session.user.id)))
        .limit(1);
      if (existing) {
        // Keep the higher of existing vs invited role (never demote).
        // baseMember uses composite PK (baseId, userId), not a single `id` column.
        if (existing.role !== 'owner' && inv.role === 'owner') {
          await db
            .update(baseMember)
            .set({ role: 'owner' })
            .where(
              and(eq(baseMember.baseId, inv.baseId), eq(baseMember.userId, ctx.session.user.id)),
            );
        }
      } else {
        await db.insert(baseMember).values({
          baseId: inv.baseId,
          userId: ctx.session.user.id,
          role: inv.role,
        });
      }
      await db.update(baseInvite).set({ acceptedAt: new Date() }).where(eq(baseInvite.id, inv.id));
      return { baseId: inv.baseId };
    }),
});
