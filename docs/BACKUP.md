# Instance backup and isolated recovery

This procedure backs up the PostgreSQL database and the default local attachment directory (`data/`). A backup briefly stops `web` while keeping `postgres` running. Arrange a maintenance window for a production instance. Before starting, stop direct database writes and any other process that can change attachments.

Save `.env` authentication settings and other deployment configuration separately in a protected location. Never commit them or post them in a public issue. Backups contain business data, users, and authentication tables, so store them in an access-controlled directory. SHA-256 checks detect damage; they do not encrypt the backup or authenticate its origin.

## Create a backup

The instance directory must contain `docker-compose.yml` and `.env`, with PostgreSQL running. The script requires a source commit SHA and application version in its manifest. In a source checkout, it reads the SHA from Git and the version from `package.json`. For a deployed directory without those files, set `MARKPOCKET_SOURCE_COMMIT` to the exact deployed code commit and `MARKPOCKET_SOURCE_VERSION` to the deployed application version before running it. If either value is unavailable, the script fails before stopping `web`.

From the source checkout, for example:

```bash
bash scripts/backup-instance.sh "$PWD" /private/tmp/markpocket-backup-20261009
```

Choose a new destination name for every run. An existing destination is never overwritten. The output contains `database.dump` (PostgreSQL custom format), `data.tar.gz`, `manifest.txt`, `SHA256SUMS`, and finally `COMPLETE`. A directory without `COMPLETE` is a failed backup and must not be restored. Verify the checksums before use:

```bash
test -f /private/tmp/markpocket-backup-20261009/COMPLETE
(cd /private/tmp/markpocket-backup-20261009 && shasum -a 256 -c SHA256SUMS)
```

Check that `web` returned to its original state. If the script reports a restart failure for a previously running `web`, run `docker compose start web` in the instance directory and check its health. A `web` service that was stopped before backup stays stopped.

## Restore to an isolated instance

Practice recovery in a new directory with a separate Compose project, separate containers, an empty PostgreSQL volume, and an empty `data/` directory. Create a fresh directory and derive its project name once for every drill:

```bash
RESTORE_DIR=$(mktemp -d /private/tmp/mp-restore-XXXXXX)
RESTORE_PROJECT=$(basename "$RESTORE_DIR" | tr '[:upper:]' '[:lower:]')
```

Prepare an isolated `docker-compose.yml` and protected `.env` in `RESTORE_DIR`. The Compose file must not set fixed `container_name` values or reuse another instance's volume, and its web port must bind to `127.0.0.1:3300:3000`. Use the same code and image version recorded in `manifest.txt`. Keep the original instance and its database and attachments intact.

After checking `COMPLETE` and every SHA-256 checksum, extract the archive into the new instance's empty `data/` directory. Start only its PostgreSQL service, then restore the dump into its empty database:

```bash
mkdir "$RESTORE_DIR/data"
tar -xzf "$BACKUP_DIR/data.tar.gz" -C "$RESTORE_DIR/data"
docker compose -p "$RESTORE_PROJECT" -f "$RESTORE_DIR/docker-compose.yml" up -d --wait postgres
docker compose -p "$RESTORE_PROJECT" -f "$RESTORE_DIR/docker-compose.yml" exec -T postgres \
  pg_restore -U markpocket -d markpocket --no-owner --no-acl --exit-on-error \
  < "$BACKUP_DIR/database.dump"
docker compose -p "$RESTORE_PROJECT" -f "$RESTORE_DIR/docker-compose.yml" up -d web
```

Set `BACKUP_DIR` to the checked backup path. Keep the generated `RESTORE_DIR` and `RESTORE_PROJECT` values for every command in the same drill. If the restore reports existing tables, create a fresh isolated target instead of deleting an existing deployment. Do not run `pg_restore --clean` against an existing database or overwrite its `data/` directory. Do not use `docker compose down -v` on a user deployment.

Verify login, table/record/cell counts, attachment bytes and checksums, history, roles, and a new write in the restored instance. A health endpoint alone is insufficient. CSV export omits attachment binaries, permissions, and history, so it cannot replace this process. Upgrade only after a same-version recovery succeeds; complete rollback requires both database and attachments to return together.

The [2026-10-10 disposable recovery drill](release/2026-10-09-recovery-evidence.md) records the actual source and restored image, checksum results, counts, browser and API acceptance, and failure-path results. Repeat the drill for your own deployed version and data before an upgrade.

## Recovery acceptance scenarios

An isolated drill should check these outcomes with a disposable instance:

| Scenario | Expected result |
| --- | --- |
| Missing arguments | Exit 2 with usage; no container access |
| Destination already exists | Exit 2; existing contents and `web` state unchanged |
| `pg_dump` fails | No `COMPLETE`; previously running `web` restarts |
| `web` was stopped | Backup leaves `web` stopped |
| Instance has attachments | Backup restores database and attachment bytes in an isolated instance; login, counts, history, roles, and a new write pass |
