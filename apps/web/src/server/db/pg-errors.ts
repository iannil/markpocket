import { TRPCError } from '@trpc/server';

// lock_timeout (55P03) and deadlock detection (40P01) surface as bare
// INTERNAL_SERVER_ERRORs otherwise — masked to "Internal server error" by the
// root errorFormatter, with no hint that a retry is all the user needs. Both
// are transient by nature (the loser of a lock wait is rolled back cleanly),
// so they map to a retryable CONFLICT.
const BUSY_CODES = new Set(['55P03', '40P01']);
const MAX_ERROR_CAUSES = 16;

export function isPgBusyError(err: unknown): boolean {
  // DrizzleQueryError keeps the PostgreSQL SQLSTATE on its cause. Bound the
  // traversal and track identities so malformed/cyclic wrappers cannot hang.
  const seen = new Set<object>();
  let current = err;
  for (let depth = 0; depth < MAX_ERROR_CAUSES; depth++) {
    if (typeof current !== 'object' || current === null || seen.has(current)) return false;
    seen.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && BUSY_CODES.has(candidate.code)) return true;
    current = candidate.cause;
  }
  return false;
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
