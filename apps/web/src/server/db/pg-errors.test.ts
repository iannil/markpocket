import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { isPgBusyError, mapBusyToConflict, PG_BUSY_MESSAGE } from './pg-errors';

const pgError = (code: string) => Object.assign(new Error('stmt timeout'), { code });

describe('isPgBusyError', () => {
  it('recognizes lock timeout (55P03) and deadlock (40P01)', () => {
    expect(isPgBusyError(pgError('55P03'))).toBe(true);
    expect(isPgBusyError(pgError('40P01'))).toBe(true);
    expect(isPgBusyError(pgError('23505'))).toBe(false);
    expect(isPgBusyError(new Error('no code'))).toBe(false);
    expect(isPgBusyError(null)).toBe(false);
  });
});

describe('mapBusyToConflict', () => {
  it('maps busy failures to a retryable CONFLICT', async () => {
    await expect(mapBusyToConflict(Promise.reject(pgError('55P03')))).rejects.toMatchObject({
      code: 'CONFLICT',
      message: PG_BUSY_MESSAGE,
    });
  });

  it('passes other errors and successes through untouched', async () => {
    await expect(mapBusyToConflict(Promise.reject(pgError('23505')))).rejects.toMatchObject({
      code: '23505',
    });
    await expect(mapBusyToConflict(Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('produces a real TRPCError (code carries through tRPC)', async () => {
    const err = await mapBusyToConflict(Promise.reject(pgError('40P01'))).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
  });
});
