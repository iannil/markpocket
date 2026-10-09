# Airtable import preview — acceptance evidence

Date: 2026-10-10. Branch: `codex/airtable-import-wizard`. This is fixture and isolated-instance acceptance, not a release or live Airtable certification. **Real Airtable end-to-end migration was not verified because no live PAT was supplied.** No merge, push, or deployment was performed.

## Isolation and method

- Dedicated PostgreSQL 16 instance: `markpocket-import-pg-01a12134` at `127.0.0.1:17450`, database `markpocket`; migration `0014_clever_mantis.sql` was applied before tests. The receipt is a UUID-keyed `airtable_import_receipt` with user/source Base/target Base/report/createdAt and target Base cascade deletion. The ordinary dev ports `7420/7419/7400` were not used.
- The 102-record integration in `apps/web/src/server/imports/airtable/acceptance.pg.test.ts` injects a typed `AirtableSource` into `createImportService`, and writes through the real Drizzle/PostgreSQL importer and local storage. It generates 101 People in 100+1 source pages plus one Team. It checks target table counts, 102 records, false checkboxes (including omitted values), a cross-table link, select choice ID, source ID columns, static snapshot and skipped-field reports, copied attachment bytes, one durable receipt/Base on retry, and denial of another user's status/cancel. It deletes only its fixture user/Base and temporary file directory in `finally`.
- The final review strengthened that assertion to compare the complete persisted source record ID set for each table (all 101 People IDs and the Team ID), verify one source-ID cell per target record, and check every imported field's source Base/table/field metadata. The source-ID column records its source Base/table and `sourceRecordId` flag. Both PostgreSQL suites now restore the caller's `UPLOAD_DIR` and remove their temporary directories in `finally`.
- Browser acceptance ran in a new hidden in-app browser tab against a separate Next dev server on `127.0.0.1:17451` and the same dedicated test PG, with `UPLOAD_DIR=/private/tmp/markpocket-airtable-browser-uploads`. A **temporary, uncommitted server-side binding** changed the Airtable tRPC router's import from `service.ts` to `browser-fixture.ts`. That module called `createImportService({ source: () => fixture })`; it exposed no production endpoint or user-controlled URL. The fixture returned two tables, 101+1 records, a cross-table link and attachment, plus a formula snapshot and unsupported field; `bad` made preflight fail and `slow` held the record phase for cancellation. The binding and file were removed before commit, and the router diff is empty. This browser success proves the page, protected API, importer, database and local storage integration with controlled source data; it does **not** prove Airtable authentication or live API behavior.

## Browser observations

- The empty Workspace showed **Import from Airtable**; the authenticated wizard displayed Base ID, password-type PAT, new Base name, read-only scopes, source-freeze warning and limits.
- `bad` preflight showed a safe generic failure and cleared the PAT. `fixture` preflight listed mapped fields, static snapshot and skipped button. **Create new Base** was disabled until the acknowledgement checkbox was selected.
- The result displayed **2 tables · 102 records · 308 cells · 1 attachment**, both issues, a new Base link and **Download JSON report**. The link opened the target People grid; the sidebar showed People and Teams, and the Person 0 row showed the Team link, snapshot text and attachment link. A downloaded `airtable-import-<requestId>.json` parsed with 101 People, one Team, 102 records, 308 cells, one attachment, and `snapshot`/`skip` issues; its text contained neither the fixture token nor `airtableusercontent.com`.
- With the `slow` source, the page displayed live `records · 0 records · 0 attachments` progress and an independent Cancel button. Clicking it showed cancellation/retry guidance, removed the PAT and did not show a success link. The normal completed case removed its saved request ID; the Task 3 page tests additionally verify refresh recovery for a running request and completed receipt. Browser refresh after completion showed the newly created Base in the sidebar.
- Final review page regressions first failed against the old UI, then passed after adding **Start another import**. That action clears the completed in-memory request ID and form state; failed or uncertain attempts retain their ID for retry. Preview and result rows now identify each static/skipped field by source table and field name plus safe IDs. This last UI change was verified by component tests and production build; the browser acceptance above predates it.

## Checks and counts

| Check | Actual result |
| --- | --- |
| Task 1 final focused mapping/network tests after review fixes | 39 passed; live TLS/Airtable not exercised |
| Task 2 final focused importer suites after review fixes | 53 passed, 1 PG test skipped in ordinary run; dedicated PG integration passed |
| Task 3 final router/page suites after review fixes | 12 passed |
| `IMPORT_PG_TEST=1 DATABASE_URL=…17450/markpocket pnpm exec vitest run apps/web/src/server/imports/airtable/acceptance.pg.test.ts --reporter=dot` | 1 passed; 102 records / two tables / one copied attachment; no type errors |
| `IMPORT_PG_TEST=1 DATABASE_URL=…17450/markpocket pnpm exec vitest run apps/web/src/server/imports/airtable/importer.pg.test.ts --reporter=dot` | 1 passed; rollback, cancellation, receipt permissions, uncertain commit and journal recovery exercised |
| `pnpm format:check` | passed |
| `pnpm lint` | 4 workspace packages successful |
| `pnpm typecheck` | 4 workspace packages successful |
| `env -u DATABASE_URL pnpm test` | 632 passed, 12 skipped, 65 passed test files, 3 skipped files; no type errors. PG-only tests are intentionally skipped in this command. |
| `DATABASE_URL=…17450/markpocket BETTER_AUTH_SECRET=<build placeholder> BETTER_AUTH_URL=http://127.0.0.1:17451 NEXT_PUBLIC_REALTIME_URL=ws://127.0.0.1:17452 pnpm build` | passed, including `/bases/import-airtable` route |
| `BASE_URL=http://127.0.0.1:17451 pnpm test:e2e-api` against the isolated built instance | 56 passed, 0 failed, 3 conditional signup cases skipped |
| `DATABASE_URL=…17450/markpocket UPLOAD_DIR=/private/tmp/markpocket-airtable-browser-uploads pnpm --filter @markpocket/web exec tsx scripts/cleanup-airtable-imports.ts` | exit 0, `Recovered 0 Airtable import journals.` Actual CLI invocation; recovery with a retained journal is separately covered by Task 2 PG tests. |
| Final review focused page/mapping regressions | 15 passed after 2 page tests were observed failing before the fix; no type errors |
| Final review isolated PG acceptance and importer tests | 2 passed, including complete source-ID sets and persisted field provenance |
| Final review `env -u DATABASE_URL pnpm test` | 634 passed, 12 skipped, 65 passed files, 3 skipped files; no type errors |
| Final review `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | all passed; lint/typecheck successful in 4 workspace packages |
| Final review production `pnpm build` against isolated PG | passed, including `/bases/import-airtable` route |

All shell checks used Node 24 and pnpm 10.32.1 via `/private/tmp/markpocket-toolbin` in this isolated worktree. The full release checks and production build ran **before** the temporary browser binding was introduced, against the production source code. After the binding was removed, `git diff` confirmed no router change. The dedicated app processes and exact `markpocket-import-pg-01a12134` container were stopped after validation; its volume and evidence were retained. No unrelated dev service or data was modified.

## Remaining limits

No live Airtable PAT, actual Airtable schema response, live TLS transfer, or real Airtable attachment URL was exercised end to end. Network protection and pagination have injected transport/unit coverage (including Node 24 native lookup shape), but a real Airtable migration should be piloted on a disposable Base before relying on this preview for production data. The browser download event hook timed out in the in-app browser; the generated JSON was verified from the browser's actual Downloads file. Commit-ambiguity and hard-exit recovery are simulated with controlled database/journal failures, not a physical PostgreSQL crash.
