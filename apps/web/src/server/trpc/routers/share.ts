import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { baseShare, table, view } from '../../db/schema';
import { db } from '../../db';
import { assertRole } from '@/lib/roles';
import { parseViewOptions } from '@/lib/view-ast';
import { findDeadFieldReferences } from './view';
import { protectedProcedure, router } from '../init';

export const shareRouter = router({
  list: protectedProcedure.input(z.object({ baseId: z.string() })).query(async ({ ctx, input }) => {
    // Tokens grant read access — treat them like the data itself.
    await assertRole(input.baseId, ctx.session.user.id, 'viewer');
    return db.select().from(baseShare).where(eq(baseShare.baseId, input.baseId));
  }),

  create: protectedProcedure
    .input(
      z.object({
        baseId: z.string(),
        viewId: z.string().optional(),
        // Link lifetime in days. The read path (public-share findLiveShare)
        // already treats a null expiresAt as "never expires" — legacy rows
        // keep that semantics; every NEW share gets a bounded lifetime.
        expiresInDays: z.number().int().min(1).max(365).optional().default(90),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRole(input.baseId, ctx.session.user.id, 'editor');
      if (input.viewId) {
        // A share scoped to a view from another base would either leak that
        // base's config or go stale silently — reject at creation instead.
        const [v] = await db
          .select({ id: view.id, tableId: view.tableId, type: view.type, options: view.options })
          .from(view)
          .innerJoin(table, eq(view.tableId, table.id))
          .where(and(eq(view.id, input.viewId), eq(table.baseId, input.baseId)))
          .limit(1);
        if (!v) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'View not found in this base',
          });
        }
        if (v.type === 'form')
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Form views use submission links, not read-only shares',
          });
        // Defense chain, link 3 of 3 (review N4 — full picture in
        // view.ts updateOptions): updateOptions gates NEW option writes
        // (link 1) and field.delete cleans the EXISTING stock of references
        // (link 2), but a view whose stored options still carry a dead
        // fieldId — written before link 1 existed or slipped through an
        // earlier race — must not be pinned to a public share: at read time
        // compileFilter silently drops the dead condition and the share
        // widens (fail-open). Reject here; re-saving the view's options
        // without the dead reference repairs it. Note: stored options that
        // fail today's schema entirely are NOT caught here — the share read
        // path already fails CLOSED on those (parseViewOptionsStrict, M-1).
        const dead = await findDeadFieldReferences(v.tableId, parseViewOptions(v.options));
        if (dead.length > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `View config references unknown field(s): ${dead.join(', ')} — fix the view before sharing`,
          });
        }
      }
      const [row] = await db
        .insert(baseShare)
        .values({
          id: randomUUID(),
          baseId: input.baseId,
          viewId: input.viewId,
          token: randomUUID().replace(/-/g, ''),
          // Stamp the expiry at mint time — without it the schema column stays
          // null and the token lives forever (findLiveShare never expires it).
          expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000),
          createdBy: ctx.session.user.id,
        })
        .returning();
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [share] = await db
        .select({ baseId: baseShare.baseId })
        .from(baseShare)
        .where(eq(baseShare.id, input.id))
        .limit(1);
      if (!share) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });
      }
      await assertRole(share.baseId, ctx.session.user.id, 'editor');
      await db.delete(baseShare).where(eq(baseShare.id, input.id));
      return { ok: true };
    }),
});
