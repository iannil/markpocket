/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockQuery } from '../trpc/routers/__test-utils';

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

import {
  TOKEN_PREFIX_HEADER,
  createApiToken,
  displayPrefix,
  hashesMatch,
  mintTokenSecret,
  resolveBearerToken,
  sha256Hex,
} from './tokens';

function tokenRow(overrides: Record<string, unknown> = {}) {
  const secret = mintTokenSecret();
  return {
    id: 't1',
    userId: 'u1',
    tokenHash: sha256Hex(secret),
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
    // keep the live secret for callers that need a matching header
    _secret: secret,
  };
}

function header(secret: string) {
  return `Bearer ${secret}`;
}

const { db } = await import('@/server/db');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('token shape', () => {
  it('mints mpk_-prefixed 192-bit hex secrets', () => {
    const secret = mintTokenSecret();
    expect(secret.startsWith(TOKEN_PREFIX_HEADER)).toBe(true);
    expect(secret).toMatch(/^mpk_[0-9a-f]{48}$/);
  });

  it('displayPrefix shows only the first 12 chars', () => {
    const secret = mintTokenSecret();
    expect(displayPrefix(secret)).toBe(secret.slice(0, 12));
    expect(displayPrefix(secret)).not.toContain(secret.slice(12));
  });

  it('hashesMatch is exact and constant-shape', () => {
    const h = sha256Hex('x');
    expect(hashesMatch(h, sha256Hex('x'))).toBe(true);
    expect(hashesMatch(h, sha256Hex('y'))).toBe(false);
    expect(hashesMatch(h, 'short')).toBe(false);
  });
});

describe('createApiToken', () => {
  it('stores the digest, not the plaintext, and returns the secret once', async () => {
    let inserted: any;
    (db.insert as any).mockReturnValue({
      values: vi.fn((v: any) => {
        inserted = v;
        return {
          returning: vi
            .fn()
            .mockResolvedValue([
              { id: v.id, name: v.name, tokenPrefix: v.tokenPrefix, createdAt: new Date() },
            ]),
        };
      }),
    });
    const minted = await createApiToken('u1', 'ci');
    expect(minted.token.startsWith(TOKEN_PREFIX_HEADER)).toBe(true);
    expect(inserted.tokenHash).toBe(sha256Hex(minted.token));
    expect(inserted.tokenHash).not.toContain(minted.token);
    expect(inserted.userId).toBe('u1');
    expect(inserted.tokenPrefix).toBe(minted.token.slice(0, 12));
  });
});

describe('resolveBearerToken', () => {
  it('resolves a live token to its user', async () => {
    const row = tokenRow();
    const chain = mockQuery([row]);
    (db.select as any).mockReturnValue(chain);
    const resolved = await resolveBearerToken(header(row._secret));
    expect(resolved).toEqual({ tokenId: 't1', userId: 'u1' });
  });

  it('rejects missing header, non-Bearer schemes, and foreign prefixes', async () => {
    expect(await resolveBearerToken(null)).toBeNull();
    expect(await resolveBearerToken('Basic abc')).toBeNull();
    expect(await resolveBearerToken('Bearer abc.def.ghi')).toBeNull();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('rejects unknown tokens', async () => {
    (db.select as any).mockReturnValue(mockQuery([]));
    expect(await resolveBearerToken(header(mintTokenSecret()))).toBeNull();
  });

  it('rejects revoked tokens', async () => {
    const row = tokenRow({ revokedAt: new Date() });
    (db.select as any).mockReturnValue(mockQuery([row]));
    expect(await resolveBearerToken(header(row._secret))).toBeNull();
  });

  it('rejects expired tokens', async () => {
    const row = tokenRow({ expiresAt: new Date(Date.now() - 1000) });
    (db.select as any).mockReturnValue(mockQuery([row]));
    expect(await resolveBearerToken(header(row._secret))).toBeNull();
  });

  it('throttles lastUsedAt writes to one per minute', async () => {
    const fresh = tokenRow({ lastUsedAt: new Date() });
    (db.select as any).mockReturnValue(mockQuery([fresh]));
    await resolveBearerToken(header(fresh._secret));
    expect(db.update).not.toHaveBeenCalled();

    const stale = tokenRow({ lastUsedAt: new Date(Date.now() - 120_000) });
    (db.select as any).mockReturnValue(mockQuery([stale]));
    await resolveBearerToken(header(stale._secret));
    expect(db.update).toHaveBeenCalled();
  });
});
