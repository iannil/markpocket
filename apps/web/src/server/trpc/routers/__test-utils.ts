/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';

/**
 * Builds a chained drizzle query builder mock (like db.select().from().where()...)
 * that is thenable, so `await` resolves to the configured value.
 * Each chained method returns the same chain; `then`/`catch` resolve to `resolveValue`.
 */
export function mockQuery<T>(resolveValue: T) {
  const chain: Record<string, any> & PromiseLike<T> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    offset: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    select: vi.fn(() => chain),
    values: vi.fn(() => chain),
    returning: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    set: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    onConflictDoNothing: vi.fn(() => chain),
    for: vi.fn(() => chain),
    onConflictDoUpdate: vi.fn(() => chain),
    then: (onfulfilled: (v: T) => any) => Promise.resolve(resolveValue).then(onfulfilled),
    catch: (onrejected: any) => Promise.resolve(resolveValue).catch(onrejected),
  };
  return chain;
}

/** Standard DB mock used by all router tests. */
export function mockDb() {
  const chain = mockQuery([]);
  return {
    // select chain returns thenable that resolves to []
    select: vi.fn(() => chain),
    // insert chain resolves to []
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    transaction: vi.fn((cb: (tx: any) => Promise<unknown>) => cb(chain)),
    execute: vi.fn(() => Promise.resolve([])),
  };
}

/** Default roles mock: owner membership, assertRole passes. */
export function mockRoles({ role = 'owner' as const } = {}) {
  return {
    assertRole: vi.fn().mockResolvedValue(undefined),
    assertTableRole: vi.fn().mockResolvedValue(undefined),
    getMembership: vi.fn().mockResolvedValue(role),
    baseIdFromTable: vi.fn().mockResolvedValue('b1'),
  };
}

/** A session fixture for an authenticated user (full better-auth Session shape). */
export function session(s: Partial<{ id: string; email: string; name: string }> = {}) {
  const now = new Date();
  const userId = s.id ?? 'u1';
  return {
    session: {
      session: {
        id: 'sess-1',
        createdAt: now,
        updatedAt: now,
        userId,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        token: 'test-token',
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: userId,
        email: s.email ?? 'alice@test.local',
        name: s.name ?? 'Alice',
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    },
  };
}
