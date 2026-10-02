/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the drizzle/pg layer the same way the trpc router tests do: one shared
// thenable chain whose resolved rows each test overrides.
const mockDb = vi.hoisted(() => {
  function mockQuery<T>(resolveValue: T) {
    const chain: Record<string, any> & PromiseLike<T> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      select: vi.fn(() => chain),
      then: (onfulfilled: (v: T) => any) => Promise.resolve(resolveValue).then(onfulfilled),
      catch: (onrejected: any) => Promise.resolve(resolveValue).catch(onrejected),
    };
    return chain;
  }
  const chain = mockQuery([]);
  return {
    db: { select: vi.fn(() => chain) },
    sql: { notify: vi.fn().mockResolvedValue(undefined) },
  };
});
vi.mock('../db', () => mockDb);

import { publishBaseChange, publishKick, publishTableChange, REALTIME_CHANNEL } from './publish';

// Point the shared chain at a fixed row set for the next awaited select.
function setSelectRows(rows: unknown[]): void {
  const ch = (mockDb.db.select as any)();
  ch.then = (onfulfilled: any) => Promise.resolve(rows).then(onfulfilled);
}

function notifiedPayloads(): Array<Record<string, unknown>> {
  return mockDb.sql.notify.mock.calls.map(([, payload]) => JSON.parse(payload as string));
}

afterEach(() => {
  vi.clearAllMocks();
  mockDb.sql.notify.mockResolvedValue(undefined);
});

describe('publish', () => {
  it('exposes the expected channel name', () => {
    expect(REALTIME_CHANNEL).toBe('markpocket_realtime');
  });

  it('publishTableChange resolves the base and notifies a table-scoped change', async () => {
    setSelectRows([{ baseId: 'b1' }]);
    await publishTableChange('t1', 'u9');
    expect(mockDb.sql.notify).toHaveBeenCalledTimes(1);
    const [channel, payload] = mockDb.sql.notify.mock.calls[0];
    expect(channel).toBe(REALTIME_CHANNEL);
    expect(JSON.parse(payload as string)).toEqual({
      baseId: 'b1',
      tableId: 't1',
      exceptUserId: 'u9',
    });
  });

  it('publishTableChange skips the notify when the table no longer exists', async () => {
    setSelectRows([]); // table deleted mid-request
    await publishTableChange('tGone');
    expect(mockDb.sql.notify).not.toHaveBeenCalled();
  });

  it('publishBaseChange notifies a base-scoped change (no tableId)', async () => {
    await publishBaseChange('b2', 'u7');
    expect(notifiedPayloads()).toEqual([{ baseId: 'b2', exceptUserId: 'u7' }]);
  });

  it('publishKick notifies the control event with the target user', async () => {
    publishKick('b3', 'uKicked');
    expect(notifiedPayloads()).toEqual([{ baseId: 'b3', kick: { userId: 'uKicked' } }]);
  });

  it('a failed NOTIFY is swallowed, not thrown (fire-and-forget)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDb.sql.notify.mockRejectedValue(new Error('pg went away'));
    // Must resolve — a dead NOTIFY path must never crash the mutation caller.
    await expect(publishBaseChange('b4', 'u1')).resolves.toBeUndefined();
    // Drain the microtask queue so emit's internal .catch handler has run.
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(errorSpy).toHaveBeenCalledWith('realtime notify failed', expect.any(Error));
    errorSpy.mockRestore();
  });
});
