import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { eq, inArray, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { withDbFixture } from '../testing/pg-fixture';

describe.skipIf(process.env.P0_P2_PG_TEST !== '1')('scoped API tokens on PostgreSQL', () => {
  it('migrates pre-existing tokens to write/all and cascades bound tokens without widening them', async () => {
    await withDbFixture(async (f) => {
      const { db } = await import('../db');
      const migration = await readFile(
        new URL('../db/migrations/0017_groovy_blur.sql', import.meta.url),
        'utf8',
      );
      const rollback = new Error('rollback isolated migration fixture');
      await expect(
        db.transaction(async (tx) => {
          // A transaction-local schema tests the generated SQL against an actual old row.
          // Nothing in the shared public schema is altered, and all fixture DDL rolls back.
          const schema = sql.identifier(`i1_migration_${randomUUID().replaceAll('-', '')}`);
          await tx.execute(sql`CREATE SCHEMA ${schema}`);
          await tx.execute(sql`SET LOCAL search_path TO ${schema}, public`);
          await tx.execute(sql`CREATE TABLE api_token (
          id text PRIMARY KEY, user_id text NOT NULL, name text NOT NULL,
          token_hash text NOT NULL, token_prefix text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz,
          expires_at timestamptz, revoked_at timestamptz
        )`);
          await tx.execute(sql`INSERT INTO api_token (id, user_id, name, token_hash, token_prefix)
          VALUES ('old', ${f.userId}, 'legacy', 'fixture-digest', 'fixture')`);
          for (const statement of migration.split('--> statement-breakpoint')) {
            await tx.execute(sql.raw(statement));
          }
          const rows = await tx.execute(
            sql`SELECT access, base_id, expires_at FROM api_token WHERE id='old'`,
          );
          expect(rows[0]).toEqual({ access: 'write', base_id: null, expires_at: null });
          await tx.execute(sql`INSERT INTO api_token (id, user_id, name, token_hash, token_prefix, access, base_id)
          VALUES ('bound', ${f.userId}, 'scoped', 'bound-fixture-digest', 'fixture', 'read', ${f.baseId})`);
          await tx.execute(sql`DELETE FROM public.base WHERE id=${f.baseId}`);
          const remaining = await tx.execute(sql`SELECT id FROM api_token`);
          expect(remaining.map((row) => row.id)).toEqual(['old']);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    });
  });

  it('enforces real membership at mint: viewer read, editor write, no nonmember scoped tokens', async () => {
    await withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { apiToken, baseMember } = await import('../db/schema');
      const { createApiToken } = await import('./tokens');
      try {
        const read = await f.viewer.token.create({
          name: 'reader',
          baseId: f.baseId,
          access: 'read',
          expiresInDays: 30,
        });
        expect(read.row).toMatchObject({ baseId: f.baseId, access: 'read' });
        await expect(
          f.viewer.token.create({
            name: 'writer',
            baseId: f.baseId,
            access: 'write',
            expiresInDays: 30,
          }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        // The model entry point itself enforces the boundary, not just the router.
        await expect(
          createApiToken(f.viewerId, 'direct writer', {
            baseId: f.baseId,
            access: 'write',
            expiresAt: null,
          }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await db
          .update(baseMember)
          .set({ role: 'editor' })
          .where(eq(baseMember.userId, f.viewerId));
        const write = await f.viewer.token.create({
          name: 'writer',
          baseId: f.baseId,
          access: 'write',
          expiresInDays: null,
        });
        expect(write.row).toMatchObject({ baseId: f.baseId, access: 'write', expiresAt: null });
        await db.delete(baseMember).where(eq(baseMember.userId, f.viewerId));
        for (const access of ['read', 'write'] as const) {
          await expect(
            f.viewer.token.create({ name: 'outsider', baseId: f.baseId, access, expiresInDays: 1 }),
          ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        }
        const all = await f.viewer.token.create({
          name: 'all',
          baseId: null,
          access: 'write',
          expiresInDays: null,
        });
        expect(all.row.baseId).toBeNull();
        expect(
          await db.select().from(baseMember).where(eq(baseMember.userId, f.viewerId)),
        ).toHaveLength(0);
        const own = await db.select().from(apiToken).where(eq(apiToken.userId, f.viewerId));
        expect(own).toHaveLength(3);
      } finally {
        await db.delete(apiToken).where(eq(apiToken.userId, f.viewerId));
      }
    });
  });

  it('persists explicit options and legacy defaults and lists only safe metadata', async () => {
    await withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { apiToken } = await import('../db/schema');
      const { createApiToken, sha256Hex } = await import('./tokens');
      try {
        const legacy = await createApiToken(f.userId, 'legacy');
        const legacyApi = await f.caller.token.create({ name: 'legacy-api' });
        for (const token of [legacy, legacyApi]) {
          expect(token.row).toMatchObject({ baseId: null, access: 'write', expiresAt: null });
        }
        for (const days of [1, 365]) {
          const before = Date.now();
          const scoped = await f.caller.token.create({
            name: `expires-${days}`,
            baseId: f.baseId,
            access: 'read',
            expiresInDays: days,
          });
          expect(scoped.row.expiresAt!.getTime()).toBeGreaterThanOrEqual(
            before + days * 86_400_000,
          );
          expect(scoped.row.expiresAt!.getTime()).toBeLessThanOrEqual(
            Date.now() + days * 86_400_000,
          );
          const [stored] = await db.select().from(apiToken).where(eq(apiToken.id, scoped.row.id));
          expect(stored.tokenHash).toBe(sha256Hex(scoped.token));
          expect(stored).toMatchObject({
            baseId: f.baseId,
            access: 'read',
            expiresAt: scoped.row.expiresAt,
          });
          expect(JSON.stringify(stored)).not.toContain(scoped.token);
        }
        const listed = await f.caller.token.list();
        expect(listed).toHaveLength(4);
        expect(Object.keys(listed[0]).sort()).toEqual([
          'access',
          'baseId',
          'createdAt',
          'expiresAt',
          'id',
          'lastUsedAt',
          'name',
          'tokenPrefix',
        ]);
        expect(await f.viewer.token.list()).toEqual([]);
      } finally {
        await db.delete(apiToken).where(eq(apiToken.userId, f.userId));
      }
    });
  });

  it('rejects exact expiry and revocation, and invalidates the secret on base deletion', async () => {
    await withDbFixture(async (f) => {
      const { db } = await import('../db');
      const { apiToken, base } = await import('../db/schema');
      const { createApiToken, resolveBearerToken } = await import('./tokens');
      try {
        const now = Date.now();
        const minted = await createApiToken(f.userId, 'bound', {
          baseId: f.baseId,
          access: 'read',
          expiresAt: new Date(now),
        });
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
        try {
          expect(await resolveBearerToken(`Bearer ${minted.token}`)).toBeNull();
          await db
            .update(apiToken)
            .set({ expiresAt: new Date(now + 1), lastUsedAt: new Date(now) })
            .where(eq(apiToken.id, minted.row.id));
          expect(await resolveBearerToken(`Bearer ${minted.token}`)).toEqual({
            tokenId: minted.row.id,
            userId: f.userId,
            baseId: f.baseId,
            access: 'read',
          });
          await f.caller.token.revoke({ id: minted.row.id });
          expect(await resolveBearerToken(`Bearer ${minted.token}`)).toBeNull();
        } finally {
          clock.mockRestore();
        }
        const live = await createApiToken(f.userId, 'live bound', {
          baseId: f.baseId,
          access: 'write',
          expiresAt: null,
        });
        await db.delete(base).where(eq(base.id, f.baseId));
        expect(await resolveBearerToken(`Bearer ${live.token}`)).toBeNull();
        expect(
          await db
            .select()
            .from(apiToken)
            .where(inArray(apiToken.id, [minted.row.id, live.row.id])),
        ).toEqual([]);
      } finally {
        await db.delete(apiToken).where(eq(apiToken.userId, f.userId));
      }
    });
  });
});
