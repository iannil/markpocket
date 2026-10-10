import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { writeCellInTransaction } from '@/server/records/write-cell';
import { field } from '../../db/schema';
import { db } from '../../db';
import { mapBusyToConflict } from '../../db/pg-errors';
import { publishTableChange } from '../../realtime/publish';
import { assertTableRole } from '@/lib/roles';
import { protectedProcedure, router } from '../init';

// Unbounded JSONB payloads are a cheap DoS vector — cap the serialized size.
const MAX_CELL_VALUE_BYTES = 256 * 1024;

export const cellRouter = router({
  upsert: protectedProcedure
    .input(
      z.object({
        recordId: z.string(),
        fieldId: z.string(),
        value: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Byte length, not string length: .length counts UTF-16 code units and
      // undercounts multibyte payloads by up to 3-4x against the wire size.
      const serialized = JSON.stringify(input.value) ?? '';
      if (Buffer.byteLength(serialized, 'utf8') > MAX_CELL_VALUE_BYTES) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cell value too large (limit ${MAX_CELL_VALUE_BYTES / 1024}KB serialized)`,
        });
      }

      const [fld] = await db.select().from(field).where(eq(field.id, input.fieldId)).limit(1);
      if (!fld) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' });
      }

      // Role gate: editor+ required
      await assertTableRole(fld.tableId, ctx.session.user.id, 'editor');

      const result = await mapBusyToConflict(
        db.transaction((tx) =>
          writeCellInTransaction(tx, { ...input, actorId: ctx.session.user.id }),
        ),
      );

      void publishTableChange(fld.tableId, ctx.session.user.id);
      return {
        ...result.normalized,
        overwroteRecentBy: result.overwroteRecentBy,
        // Dependent expression cells recalculated in the same transaction.
        // The editing session's ws broadcast excludes itself, so without
        // these the client would keep showing stale expression values until
        // some unrelated refetch.
        recomputed: result.recomputed,
      };
    }),
});
