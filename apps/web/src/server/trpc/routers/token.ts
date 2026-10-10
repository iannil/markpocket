import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { apiToken } from '../../db/schema';
import { db } from '../../db';
import { createApiToken } from '@/server/agent-access/tokens';
import { protectedProcedure, router } from '../init';

// Bound the number of active credentials a user can accumulate.
const MAX_ACTIVE_TOKENS = 20;

// Personal API tokens (ADR-0010/0014). Scope only narrows the creator's
// authority; downstream operations must still check current membership.
export const tokenRouter = router({
  // Never returns the secret: only the display prefix + metadata.
  list: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: apiToken.id,
        name: apiToken.name,
        tokenPrefix: apiToken.tokenPrefix,
        createdAt: apiToken.createdAt,
        lastUsedAt: apiToken.lastUsedAt,
        expiresAt: apiToken.expiresAt,
        access: apiToken.access,
        baseId: apiToken.baseId,
      })
      .from(apiToken)
      .where(and(eq(apiToken.userId, ctx.session.user.id), isNull(apiToken.revokedAt)))
      .orderBy(desc(apiToken.createdAt));
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(64),
        // Legacy API callers may omit fields. New UI callers supply all three.
        baseId: z.string().nullable().default(null),
        access: z.enum(['read', 'write']).default('write'),
        expiresInDays: z.number().int().min(1).max(365).nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [cnt] = await db
        .select({ value: count() })
        .from(apiToken)
        .where(and(eq(apiToken.userId, ctx.session.user.id), isNull(apiToken.revokedAt)));
      if ((cnt?.value ?? 0) >= MAX_ACTIVE_TOKENS) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Token limit reached (${MAX_ACTIVE_TOKENS} active) — revoke one first`,
        });
      }
      // The plaintext token crosses the wire exactly once, in this response.
      return createApiToken(ctx.session.user.id, input.name, {
        baseId: input.baseId,
        access: input.access,
        expiresAt:
          input.expiresInDays === null
            ? null
            : new Date(Date.now() + input.expiresInDays * 86_400_000),
      });
    }),

  revoke: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Soft-delete: keep the row so the digest stays unique forever (a minted
      // token can never collide with a revoked one), but reject it on resolve.
      const [row] = await db
        .select({ userId: apiToken.userId, revokedAt: apiToken.revokedAt })
        .from(apiToken)
        .where(eq(apiToken.id, input.id))
        .limit(1);
      if (!row || row.userId !== ctx.session.user.id) {
        // Unknown id and someone else's token are the same answer: 404.
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Token not found' });
      }
      if (!row.revokedAt) {
        await db.update(apiToken).set({ revokedAt: new Date() }).where(eq(apiToken.id, input.id));
      }
      return { ok: true };
    }),
});
