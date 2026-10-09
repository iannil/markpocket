import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AirtableImportError } from '@/server/imports/airtable/types';
import {
  cancelImport,
  importStatus,
  preflightImport,
  startImport,
} from '@/server/imports/airtable/service';
import { RECOVERY_HINT } from '@/server/imports/airtable/journal';
import { protectedProcedure, router } from '../init';

const requestId = z.uuid();
const sourceBaseId = z.string().regex(/^app[A-Za-z0-9]{8,61}$/);
const token = z.string().min(1).max(1024);
const name = z.string().trim().min(1).max(64);
const schemaHash = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.strictObject({ requestId });

async function safe<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AirtableImportError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    }
    if (error instanceof Error && error.message === 'Access denied') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
    }
    if (error instanceof Error && error.message === RECOVERY_HINT) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: RECOVERY_HINT,
        cause: new TRPCError({ code: 'INTERNAL_SERVER_ERROR' }),
      });
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Import failed; retry with the same request ID',
      cause: new TRPCError({ code: 'INTERNAL_SERVER_ERROR' }),
    });
  }
}

export const airtableImportRouter = router({
  preflight: protectedProcedure
    .input(z.strictObject({ sourceBaseId, token }))
    .mutation(({ ctx, input }) =>
      safe(() => preflightImport(ctx.session.user.id, input.sourceBaseId, input.token)),
    ),
  start: protectedProcedure
    .input(
      z.strictObject({
        requestId,
        sourceBaseId,
        token,
        name,
        schemaHash,
        acceptLosses: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => safe(() => startImport(ctx.session.user.id, input))),
  status: protectedProcedure
    .input(key)
    .query(({ ctx, input }) => safe(() => importStatus(ctx.session.user.id, input.requestId))),
  cancel: protectedProcedure
    .input(key)
    .mutation(({ ctx, input }) => safe(() => cancelImport(ctx.session.user.id, input.requestId))),
});
