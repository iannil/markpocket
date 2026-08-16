# Upgrade Guide

## From v0.0.0 to v1.0.0-alpha.1

### Database Migrations

This release includes two new database migrations. If you are running the Docker container, migrations run automatically on boot (the container's `CMD` executes `drizzle-kit migrate` before starting the server). No manual steps needed.

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