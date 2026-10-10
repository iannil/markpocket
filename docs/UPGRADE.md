# Upgrade Guide

## P0–P2 candidate (unreleased)

Final candidate installation, upgrade, matching old-image/snapshot recovery and missing/wrong Webhook-key acceptance passed on the exact image recorded in [final acceptance](release/2026-10-10-p0-p2-final-acceptance.md). No P0–P2 image or tag has been published. Repeat the rehearsal for your own deployment and recovery point before upgrading production.

The currently generated migrations after 0013 are:

| Migration | Change |
| --- | --- |
| `0014_clever_mantis.sql` | `airtable_import_receipt` stores the result for an imported request and references its created Base. |
| `0015_adorable_virginia_dare.sql` | `write_receipt` stores atomic write results under `(actor_key, request_id)` and indexes receipt retention time. |
| `0016_short_miek.sql` | Form publications and submission audit. |
| `0017_groovy_blur.sql` | Token access, Base scope and expiry. |
| `0018_aromatic_ultimo.sql` | Encrypted Webhook subscriptions. |
| `0019_nebulous_jocasta.sql` | Transactional Webhook outbox and collection triggers. |

These filenames match `apps/web/src/server/db/migrations/meta/_journal.json` at the tested candidate. Production Docker startup applies the image's pending migrations before serving traffic.

Before upgrading, freeze application writes, direct SQL writers, importers and attachment writers, then use the exact two-argument [backup command](BACKUP.md#create-a-backup). Preserve the old image by immutable image ID, the checked database dump, matching `data/` archive and protected deployment configuration, including the Webhook encryption key when configured. Resume writes only after deciding the recovery point is acceptable.

Validate the final image against an empty isolated database, then upgrade the disposable old baseline and compare the original record IDs and attachment bytes. Compare the image's migration journal with applied hashes; a healthy endpoint alone does not prove that migrations or data preservation passed. Restore the pre-upgrade dump and attachment archive to a second empty isolated instance using the exact old image and configuration, and compare the same record IDs and hashes.

For rollback, stop writes to the upgraded instance and recover the old image with its pre-upgrade schema snapshot and matching attachment archive in a new instance. There are no down migrations. Never run the old program against the upgraded database as a rollback. Records, anonymous Form submissions and other changes after the snapshot are outside that recovery point and will be lost if you return to it. Reconcile them separately before switching traffic.

Also test an isolated instance with an encrypted subscription and pending deliveries, then remove or replace `WEBHOOK_ENCRYPTION_KEY` and restart its web service. Confirm delivery is explicitly disabled and pending deliveries remain intact without claims or attempt increments; keep the protected original key for recovery. Both negative cases passed in final acceptance. After restoring the correct key, a current owner must explicitly resume the disabled subscription.

## From v0.0.0 to v1.0.0-alpha.1

### Database Migrations

This release includes seven new database migrations (0007–0013). If you are running the Docker container, migrations run automatically on boot — `src/server.ts` applies pending migrations under a pg advisory lock before serving (so concurrent replicas serialize), then starts the server. No manual steps needed.

If you are running outside Docker (e.g., the dev server), run:

```bash
pnpm db:migrate
```

#### Migration 0007: `base_share.created_by`

File: `apps/web/src/server/db/migrations/0007_fresh_stingray.sql`

```sql
ALTER TABLE "base_share" ADD COLUMN "created_by" text;
```

Adds a `created_by` column to `base_share` to track which user created each share link.

#### Migration 0008: `base_invite` table

File: `apps/web/src/server/db/migrations/0008_bored_emma_frost.sql`

```sql
CREATE TABLE "base_invite" (
  "id" text PRIMARY KEY NOT NULL,
  "base_id" text NOT NULL,
  "email" text NOT NULL,
  "role" text DEFAULT 'editor' NOT NULL,
  "token" text NOT NULL,
  "invited_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone
);
```

Creates the `base_invite` table for the invite-by-email flow. Existing databases will have the table created on first boot after upgrade.

#### Migration 0009: integrity constraints & hot-path indexes

File: `apps/web/src/server/db/migrations/0009_groovy_thing.sql`

Summary of what it does:

- Deduplicates `base_member` rows (keeps the most privileged role per `(base_id, user_id)`) and adds a composite primary key on `(base_id, user_id)`.
- Adds `attachment.base_id` (with an `ON DELETE CASCADE` FK to `base`) to support per-object download ACLs.
- Unique indexes on `base_invite.token` and `base_share.token` (token collision becomes impossible at the DB level).
- Hot-path indexes: `cell_value_gin` (GIN on `cell.value`, back-links), `cell_history(cell_id, changed_at)`, and FK indexes on `field/record/table/view/base_member`.

Non-destructive except for the `base_member` dedupe DELETE, which only removes exact duplicate memberships (same user, same base) while keeping the highest role. The 0009 dedupe runs on every database that still has duplicates — if you maintain roles out-of-band, review duplicated memberships before upgrading.

#### Migration 0010: sort & history time indexes

File: `apps/web/src/server/db/migrations/0010_record_sort_and_history_time_indexes.sql`

```sql
CREATE INDEX IF NOT EXISTS "record_table_created_at_idx" ON "record" USING btree ("table_id","created_at" DESC);
CREATE INDEX IF NOT EXISTS "cell_history_changed_at_idx" ON "cell_history" USING btree ("changed_at" DESC);
```

Pure index additions — no schema or data changes, no breaking behavior. `record(table_id, created_at DESC)` backs the default record listing sort; `cell_history(changed_at DESC)` backs the base-wide history timeline.

#### Migration 0011: history pagination composite index

File: `apps/web/src/server/db/migrations/0011_redundant_sentry.sql`

```sql
DROP INDEX "cell_history_changed_at_idx";
CREATE INDEX "cell_history_changed_at_id_idx" ON "cell_history" USING btree ("changed_at" DESC NULLS LAST,"id" DESC NULLS LAST);
```

Replaces 0010's single-column `cell_history(changed_at DESC)` index with the composite `(changed_at DESC, id DESC)`. History listing (`listByBase`/`listByTable`) pages with `ORDER BY changed_at DESC, id DESC` — the unique `id` tiebreaker keeps offset paging deterministic when a bulk write (dead-reference cleanup, backfill, import) stamps many rows with identical timestamps; the composite backs the full ORDER BY instead of just its prefix. Index-only replacement, no data changes.

#### Migration 0012: drop redundant indexes, add `base_id` indexes

File: `apps/web/src/server/db/migrations/0012_worthless_ozymandias.sql`

```sql
DROP INDEX "cell_record_id_idx";
DROP INDEX "record_table_id_idx";
CREATE INDEX "attachment_base_id_idx" ON "attachment" USING btree ("base_id");
CREATE INDEX "base_invite_base_id_idx" ON "base_invite" USING btree ("base_id");
CREATE INDEX "base_share_base_id_idx" ON "base_share" USING btree ("base_id");
```

Two sides of index hygiene, no data changes:

- **Drops** `cell_record_id_idx` and `record_table_id_idx` — both are fully covered by the leading column of an existing index (`cell_record_field_uq (record_id, field_id)` and `record_table_created_at_idx (table_id, created_at DESC)` respectively), so they only added write amplification.
- **Adds** missing single-column indexes on `base_share.base_id`, `base_invite.base_id`, and `attachment.base_id` — `share.list` / `invite.list` filter by base and base deletion cascades over these tables; without the index those scans degrade to sequential scans as tables grow.

#### Migration 0013: `api_token` table (agent access layer)

File: `apps/web/src/server/db/migrations/0013_dark_kitty_pryde.sql`

```sql
CREATE TABLE "api_token" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "name" text NOT NULL,
    "token_hash" text NOT NULL,
    "token_prefix" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "last_used_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "revoked_at" timestamp with time zone
);
CREATE UNIQUE INDEX "api_token_hash_uq" ON "api_token" USING btree ("token_hash");
CREATE INDEX "api_token_user_id_idx" ON "api_token" USING btree ("user_id");
```

Backs the agent access layer (ADR-0010): Bearer tokens for REST `/api/v1`, MCP `/api/mcp`, and token management UI. Only the sha256 digest is stored; no data migration needed — tokens are created per-user in the web UI (any base → Settings → Agents).

### Docker Compose

If upgrading an existing deployment:

Before pulling new code, [back up the current instance](BACKUP.md), verify its checksums, and restore that backup in an isolated same-version drill. Confirm login, counts, attachment bytes, history, roles, and a new write there. Keep the backup and its protected deployment configuration available for rollback; a rollback must restore the database and attachments together. The [recovery evidence](release/2026-10-09-recovery-evidence.md) records one disposable drill, not a substitute for testing your own deployment.

```bash
# Pull latest code
git pull origin master
# Rebuild and restart
docker compose up -d --build
```

The container will apply pending migrations automatically.

### Release Checklist

Before tagging a new release, verify the following:

1. **Backup and isolated recovery**: run [BACKUP.md](BACKUP.md) against the current version and verify both database and attachments before upgrade
2. **End-to-end smoke test**: create a base, add tables, insert data, verify share links work, send invites, and export data
3. **docker-compose up one-shot**: bring up from clean state (no existing DB volume) and confirm the app boots, migrations run, and the UI loads
4. **Upgrade from earlier migrations**: start with a database that has earlier migrations and confirm the container applies the new migrations without error
5. **CHANGELOG updated**: all significant changes listed in `CHANGELOG.md`
6. **README updated**: if any setup steps, environment variables, or configuration changed
7. **Tag pushed**: `git tag v1.0.0-alpha.1 && git push origin v1.0.0-alpha.1` — this triggers the GitHub Actions release workflow
8. **Image published**: confirm the ghcr.io image (`ghcr.io/iannil/markpocket:v1.0.0-alpha.1`) is built and available
9. **GitHub Release**: create a release note on GitHub linking to the CHANGELOG section
