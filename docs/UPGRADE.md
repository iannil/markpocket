# Upgrade Guide

## From v0.0.0 to v1.0.0-alpha.1

### Database Migrations

This release includes six new database migrations (0007–0012). If you are running the Docker container, migrations run automatically on boot — `src/server.ts` applies pending migrations under a pg advisory lock before serving (so concurrent replicas serialize), then starts the server. No manual steps needed.

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

### Docker Compose

If upgrading an existing deployment:

```bash
# Pull latest code
git pull origin master
# Rebuild and restart
docker compose up -d --build
```

The container will apply pending migrations automatically.

### Release Checklist

Before tagging a new release, verify the following:

1. **End-to-end smoke test**: create a base, add tables, insert data, verify share links work, send invites, and export data
2. **docker-compose up one-shot**: bring up from clean state (no existing DB volume) and confirm the app boots, migrations run, and the UI loads
3. **Upgrade from empty DB**: start with an existing database that has earlier migrations, confirm the container applies the new migrations without error
4. **CHANGELOG updated**: all significant changes listed in `CHANGELOG.md`
5. **README updated**: if any setup steps, environment variables, or configuration changed
6. **Tag pushed**: `git tag v1.0.0-alpha.1 && git push origin v1.0.0-alpha.1` — this triggers the GitHub Actions release workflow
7. **Image published**: confirm the ghcr.io image (`ghcr.io/iannil/markpocket:v1.0.0-alpha.1`) is built and available
8. **GitHub Release**: create a release note on GitHub linking to the CHANGELOG section