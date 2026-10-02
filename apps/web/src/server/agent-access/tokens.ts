import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { apiToken } from '../db/schema';
import { db } from '../db';

export const TOKEN_PREFIX_HEADER = 'mpk_';

// Displayed wherever a token is listed after creation (`mpk_` + first 8 hex).
export const TOKEN_DISPLAY_PREFIX_LEN = TOKEN_PREFIX_HEADER.length + 8;

export interface MintedToken {
  /** Full plaintext token — returned exactly once, never stored. */
  token: string;
  row: { id: string; name: string; tokenPrefix: string; createdAt: Date };
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Mint a new token for a user. The plaintext is assembled here and returned to
 * the caller; persistence stores only the sha256 digest. 24 random bytes
 * (192-bit) — stronger than the 122-bit dashless-UUID scheme used for share
 * tokens, because API tokens are long-lived and full-power (same authority as
 * the user, ADR-0010).
 */
export function mintTokenSecret(): string {
  return TOKEN_PREFIX_HEADER + randomBytes(24).toString('hex');
}

export function displayPrefix(token: string): string {
  return token.slice(0, TOKEN_DISPLAY_PREFIX_LEN);
}

/** Constant-time comparison for already-hashed candidates (defense in depth). */
export function hashesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function createApiToken(userId: string, name: string): Promise<MintedToken> {
  const token = mintTokenSecret();
  const [row] = await db
    .insert(apiToken)
    .values({
      id: randomUUID(),
      userId,
      name,
      tokenHash: sha256Hex(token),
      tokenPrefix: displayPrefix(token),
    })
    .returning({
      id: apiToken.id,
      name: apiToken.name,
      tokenPrefix: apiToken.tokenPrefix,
      createdAt: apiToken.createdAt,
    });
  return { token, row };
}

export interface ResolvedToken {
  tokenId: string;
  userId: string;
}

/**
 * Resolve an `Authorization: Bearer mpk_…` header to its owning user.
 * Returns null for anything other than a live (not revoked, not expired)
 * token — callers treat that as 401. lastUsedAt is refreshed at most once per
 * minute per token so the hot path doesn't turn every read into a write.
 */
export async function resolveBearerToken(
  authorizationHeader: string | null,
): Promise<ResolvedToken | null> {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match) return null;
  const token = match[1].trim();
  // Cheap shape gate before hashing — rejects session cookies / arbitrary
  // strings that could never match anyway.
  if (!token.startsWith(TOKEN_PREFIX_HEADER)) return null;

  const [row] = await db
    .select({
      id: apiToken.id,
      userId: apiToken.userId,
      tokenHash: apiToken.tokenHash,
      expiresAt: apiToken.expiresAt,
      revokedAt: apiToken.revokedAt,
      lastUsedAt: apiToken.lastUsedAt,
    })
    .from(apiToken)
    .where(eq(apiToken.tokenHash, sha256Hex(token)))
    .limit(1);
  if (!row) return null;
  if (!hashesMatch(row.tokenHash, sha256Hex(token))) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return null;

  const THROTTLE_MS = 60_000;
  if (!row.lastUsedAt || Date.now() - new Date(row.lastUsedAt).getTime() > THROTTLE_MS) {
    // Fire-and-forget: a failed update must not fail the request.
    void db
      .update(apiToken)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiToken.id, row.id))
      .catch(() => undefined);
  }
  return { tokenId: row.id, userId: row.userId };
}
