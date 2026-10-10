/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { mockQuery, session } from './__test-utils';

vi.mock('@/server/db', () => {
  const chain = mockQuery([]);
  return {
    db: {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
    },
  };
});

import { tokenRouter } from './token';

const { db } = await import('@/server/db');

beforeEach(() => {
  vi.clearAllMocks();
  (db.select as any).mockReturnValue(mockQuery([]));
});

describe('tokenRouter.list', () => {
  it('returns rows for the current user', async () => {
    (db.select as any).mockReturnValue(
      mockQuery([{ id: 't1', name: 'ci', tokenPrefix: 'mpk_12345678' }]),
    );
    const rows = await tokenRouter.createCaller(session()).list();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenPrefix).toBe('mpk_12345678');
    // The digest column is not part of the projection.
    const selectArgs = (db.select as any).mock.calls[0][0];
    expect(Object.keys(selectArgs)).not.toContain('tokenHash');
    expect(Object.keys(selectArgs)).toEqual(
      expect.arrayContaining(['access', 'baseId', 'expiresAt']),
    );
  });
});

describe('tokenRouter.create', () => {
  it('returns the plaintext once with its stored metadata', async () => {
    let inserted: any;
    (db.insert as any).mockReturnValue({
      values: vi.fn((v: any) => {
        inserted = v;
        return {
          returning: vi
            .fn()
            .mockResolvedValue([
              { id: v.id, name: 'ci', tokenPrefix: v.tokenPrefix, createdAt: new Date() },
            ]),
        };
      }),
    });
    const result = await tokenRouter.createCaller(session()).create({ name: 'ci' });
    expect(result.token).toMatch(/^mpk_[0-9a-f]{48}$/);
    expect(result.row.tokenPrefix).toBe(result.token.slice(0, 12));
    expect(inserted.tokenHash).not.toBe(result.token);
  });

  it.each([0, 366, 1.5])('rejects invalid expiry %s', async (expiresInDays) => {
    await expect(
      tokenRouter
        .createCaller(session())
        .create({ name: 'ci', baseId: null, access: 'read', expiresInDays } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects empty names', async () => {
    await expect(tokenRouter.createCaller(session()).create({ name: '' } as any)).rejects.toThrow();
  });
});

describe('tokenRouter.revoke', () => {
  it('revokes an own live token', async () => {
    (db.select as any).mockReturnValue(mockQuery([{ userId: 'u1', revokedAt: null }]));
    const updateChain = mockQuery([]);
    (db.update as any).mockReturnValue(updateChain);
    const result = await tokenRouter.createCaller(session()).revoke({ id: 't1' });
    expect(result).toEqual({ ok: true });
    expect(db.update).toHaveBeenCalled();
  });

  it('stays idempotent for an already-revoked token', async () => {
    (db.select as any).mockReturnValue(mockQuery([{ userId: 'u1', revokedAt: new Date() }]));
    const result = await tokenRouter.createCaller(session()).revoke({ id: 't1' });
    expect(result).toEqual({ ok: true });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for someone else’s token', async () => {
    (db.select as any).mockReturnValue(mockQuery([{ userId: 'someone-else', revokedAt: null }]));
    await expect(tokenRouter.createCaller(session()).revoke({ id: 't1' })).rejects.toThrow(
      TRPCError,
    );
  });

  it('answers NOT_FOUND for an unknown id', async () => {
    (db.select as any).mockReturnValue(mockQuery([]));
    await expect(tokenRouter.createCaller(session()).revoke({ id: 'nope' })).rejects.toThrow(
      TRPCError,
    );
  });
});
