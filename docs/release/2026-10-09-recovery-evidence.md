# Release foundation evidence: CSV export and instance recovery

Execution date: 2026-10-10 Asia/Shanghai (backup timestamp 2026-10-09 UTC). Candidate remains `1.0.0-alpha.1`; this record does not authorize a tag or publication. The recovery drill used disposable local instances and synthetic accounts/data. Its backup and protected configuration remain outside Git in `/private/tmp/markpocket-drill.56Ruk1`.

## Isolated recovery drill

| Item | Observed value |
| --- | --- |
| Product source commit used to rebuild image and recorded in backup | `464ee546abae40191f9168929cb2e92883ef94a0` |
| Local image | `markpocket:recovery-test`, `sha256:1d84d7aa4eb4b179370c17addc15d569e0f18a4ac97b6ae6625b64e3528ec30b` |
| Application version | `1.0.0-alpha.1` |
| Source Compose project | `markpocket-drill-56ruk1-source` |
| Restore Compose project | `markpocket-drill-56ruk1-restore` |
| Backup creation | `2026-10-09T16:16:51Z` in `manifest.txt` |
| Synthetic Base | `Recovery drill 2026-10-10` |
| Attachment SHA-256 | `5af626d295807663ae1a93c2705f26846dd8ed41757e257b3059b92875937272` (31 bytes from the planned `printf 'markpocket recovery attachment\n'`) |

The image was rebuilt locally from the source commit above because the earlier `markpocket:recovery-test` image predated that commit and carried no source label. The source and restore used separate directories, containers, networks, PostgreSQL volumes, and `data/` bind mounts. Only the web service bound `127.0.0.1:3300`; no original deployment or export-test database was used. The source web was stopped before the restore web started. No `down -v` or `pg_restore --clean` was run.

The synthetic fixture was created through application APIs: owner and viewer accounts, one Base and table, text/number/attachment fields, two records, `before` changed to `after`, an uploaded attachment, and an accepted viewer invitation. The backup script stopped and restarted a previously running source web. `COMPLETE` existed; `shasum -a 256 -c SHA256SUMS` passed for `database.dump`, `data.tar.gz`, and `manifest.txt`. The checked archive was extracted into a fresh directory, and `pg_restore --no-owner --no-acl --exit-on-error` succeeded against the empty restore volume. `/api/health` returned `{"ok":true}`.

Counts were captured before any restored-instance write or API e2e test:

| PostgreSQL table | Source before backup | Restore after `pg_restore` |
| --- | ---: | ---: |
| `table` | 1 | 1 |
| `record` | 2 | 2 |
| `cell` | 4 | 4 |
| `cell_history` | 5 | 5 |
| `attachment` | 1 | 1 |
| `base_member` | 2 | 2 |

`diff -u counts-before.txt counts-after.txt` exited 0. Both original accounts authenticated through `/api/auth/sign-in/email`. The owner history API returned the actual `before → after` transition. The viewer membership API returned `viewer`, and its attempted `cell.upsert` received HTTP 403 `FORBIDDEN`. The viewer downloaded the restored attachment through `/api/files/{id}`; its 31 bytes had the SHA-256 above. Real Chrome, driven by Playwright, showed the owner's grid edit controls, history timeline, and a CSV export of the restored two rows. It showed the viewer's grid data with zero add-field and add-record controls. The owner then created a third record and wrote `after restore`; PostgreSQL returned that value, and the grid still displayed it after browser reload.

Failure checks on the disposable source and backup copies:

- With source `web` running, using the existing successful `backup/` destination made `backup-instance.sh` exit 2. The same web container's `StartedAt` stayed `2026-10-09T16:25:05.954912491Z`, `Running` stayed `true`, and `RestartCount` stayed 0 before and after. The original backup's `COMPLETE` remained present.
- Backing up while source `web` was stopped succeeded and left it stopped.
- Changing one byte in a copied `data.tar.gz` made `shasum -a 256 -c SHA256SUMS` exit 1. That copy was never restored.
- A Docker wrapper injected exit 42 at `pg_dump`. The backup exited 42, had no `COMPLETE`, and restarted the source `web` that had been running. An initial injection attempt exited 2 before reaching Docker because the wrapper `PATH` lacked Node for manifest version parsing; adding `/private/tmp/markpocket-toolbin` and using a fresh destination produced the expected injected result.

The first browser assertion used the old YAML scenario's `td` selector, but the current grid renders cells without `td`; the current UI was inspected and the assertion rerun against visible content. The old history CSS selector likewise found no entries; after waiting for the asynchronous timeline and checking its rendered `Status` entries, the browser assertion passed. No application source or browser scenario files were changed to accommodate these test-harness corrections.

## Release checks on this candidate

| Command | Observed result |
| --- | --- |
| `pnpm format:check` | Final run exited 0. An earlier run failed only on an in-progress `.superpowers/sdd/2026-10-09-instance-recovery-readiness/progress.md`; that scratch file was formatted before the final run. |
| `env -u DATABASE_URL pnpm lint` | Exit 0; four Turbo tasks succeeded. |
| `env -u DATABASE_URL pnpm typecheck` | Exit 0; four Turbo tasks succeeded. |
| `env -u DATABASE_URL pnpm test` | Exit 0; 567 passed, 10 skipped, no type errors. |
| `pnpm build` with placeholder `DATABASE_URL`, `BETTER_AUTH_SECRET`, and local `BETTER_AUTH_URL` | Exit 0 on a cache miss. |
| `BASE_URL=http://localhost:3300 pnpm test:e2e-api` | Exit 0 against the restored instance, after count comparison; 56 passed, 0 failed, 3 skipped. |

## CSV export evidence retained from the preceding subproject

The CSV work used a separate dedicated PostgreSQL 16.15 container, `markpocket-export-pg-01a12134`, bound to `127.0.0.1:17439`. Its real PostgreSQL tests passed 9/9, including 10,001 ordered rows, snapshot consistency during a concurrent update, a 16 MiB raw page guard, authorization, and a foreign-Base fixture. A gated 30-second PostgreSQL `statement_timeout` test passed 1/1: the database returned `57014`, the public request returned a redacted error without a partial file, and a subsequent one-row export succeeded. The normal no-database unit run passed 567 tests with 9 skips in that subproject; its API e2e run passed 56 with 3 skips.

Real Chrome downloaded 10,001 rows from both Base Export and General CSV. It confirmed a filename containing the table ID, two downloads for a two-table selection, an 8 MiB budget error with zero downloads, HTTP 403 for a foreign-Base export request, and no export control on an anonymous public share. In a 1 GiB limited disposable web container, a 100,000-row × 10-field export returned 100,000 rows and `truncated: false` in 52,183 ms; observed memory peaked at 213.9 MiB with `OOMKilled=false`. A real database lock timeout produced a redacted failure, concurrent export received HTTP 429, and a following small export succeeded. These measurements are from the CSV subproject's 2026-10-09 report; they are not rerun as part of this restore drill. CSV is a data exchange format and does not contain attachment bytes, permissions, or history.

The local recovery containers were stopped after validation. Their independent volumes, temporary backup, and protected configuration were retained for inspection. The later Form, Kanban, and migration workstreams (B/C/D in the opportunity design) were not executed or accepted by this A1/A2 release-foundation drill. No tag was created or pushed, and no image was published.
