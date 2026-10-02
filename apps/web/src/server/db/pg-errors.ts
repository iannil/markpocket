import { TRPCError } from '@trpc/server';

// lock_timeout (55P03) and deadlock detection (40P01) surface as bare
// INTERNAL_SERVER_ERRORs otherwise — masked to "Internal server error" by the
// root errorFormatter, with no hint that a retry is all the user needs. Both
// are transient by nature (the loser of a lock wait is rolled back cleanly),
// so they map to a retryable CONFLICT.
const BUSY_CODES = new Set(['55P03', '40P01']);

export function isPgBusyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    BUSY_CODES.has(String((err as { code?: unknown }).code))
  );
}

export const PG_BUSY_MESSAGE =
  'This content is being modified by another operation — please retry in a moment.';

/** Wraps a promise (typically `db.transaction(...)`) so lock-wait failures map to CONFLICT. */
export async function mapBusyToConflict<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (isPgBusyError(err)) {
      throw new TRPCError({ code: 'CONFLICT', message: PG_BUSY_MESSAGE });
    }
    throw err;
  }
}
