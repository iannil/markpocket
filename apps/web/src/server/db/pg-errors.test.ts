import { TRPCError } from '@trpc/server';
import { DrizzleQueryError } from 'drizzle-orm';
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

  it('terminates on cyclic and excessively deep cause chains', () => {
    const first = new Error('first');
    const second = new Error('second', { cause: first });
    first.cause = second;
    expect(isPgBusyError(first)).toBe(false);
    let deep: Error = pgError('40P01');
    for (let n = 0; n < 100; n++) deep = new Error('wrapper', { cause: deep });
    expect(isPgBusyError(deep)).toBe(false);
    expect(isPgBusyError(new Error('primitive cause', { cause: '55P03' }))).toBe(false);
  });
});

describe('mapBusyToConflict', () => {
  it.each(['40P01', '55P03'])('maps Drizzle-wrapped %s through nested causes', async (code) => {
    const wrapped = new DrizzleQueryError('insert into record values (...)', [], pgError(code));
    expect(isPgBusyError(wrapped)).toBe(true);
    await expect(
      mapBusyToConflict(Promise.reject(new Error('transaction', { cause: wrapped }))),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: PG_BUSY_MESSAGE,
    });
  });

  it('preserves unrelated Drizzle-wrapped errors by identity', async () => {
    const wrapped = new DrizzleQueryError('insert into record values (...)', [], pgError('23505'));
    expect(isPgBusyError(wrapped)).toBe(false);
    await expect(mapBusyToConflict(Promise.reject(wrapped))).rejects.toBe(wrapped);
  });

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
