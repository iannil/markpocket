# Changelog

## Unreleased — security & quality hardening (2026-10-01)

### Security

- **Authorization on every read endpoint** — `record.list`, `history.*`, `share.list`, `member.list`, `field/view/table.list`, `base.get`, `base.list` (now filtered by membership), and the CSV plugin's `import`/`export` (via a new `auth.assertTableRole` in `CoreServerApi`) all enforce base membership + role. Previously reads were session-only (IDOR).
- **Cross-scope ID validation** — `record.delete` verifies the record belongs to the authorized table (link-cell cascade now scoped to the same base and appends `cell_history` rows); `cell.upsert` verifies the record belongs to the field's table.
- **Attachment hardening** — upload requires `baseId` + editor role and passes a MIME allowlist; download checks per-object ACL (`attachment.baseId`, new column), forces `Content-Disposition: attachment`, and sends `X-Content-Type-Options: nosniff`. Global CSP / nosniff / frame-deny / referrer-policy headers added in `next.config.js`.
- **Storage path traversal fixed** — `plugin-storage-local` keys are strictly validated (`uuid.ext`); malicious keys are rejected in `put`/`get`/`remove`.
- **WebSocket gateway** — channel subscription now requires base membership, upgrade requests validate `Origin`, presence no longer broadcasts user emails, per-connection subscription cap (32) and ping/pong heartbeat added.
- **CSV injection neutralized** — exports guard `= + - @`-prefixed cells with an apostrophe (imports strip it, keeping the round-trip).
- **Auth secret fail-closed** — the Docker image no longer ships a placeholder `BETTER_AUTH_SECRET`; production startup refuses to boot without a ≥32-char secret. Compose requires `POSTGRES_PASSWORD`/`BETTER_AUTH_SECRET` explicitly; `.env.example` added.
- Login `callbackUrl` rejects protocol-relative (`//evil.com`) open redirects.
- `member.updateRole`/`remove` refuse to demote/remove the last owner of a base.

### Correctness

- grid-editor: Rules-of-Hooks violation fixed (hooks before early returns); eslint `react-hooks` plugin added (it immediately caught a residual violation).
- Grid pagination: "Show more" + total count (records beyond the first page were unreachable before); same for the public share page.
- Filter panel no longer crashes on field types without dedicated operators (multi-select/user/link/attachment/expression).
- Expression error sentinels no longer fail the whole `record.list` query (numeric casts guard `jsonb_typeof`); expression results materialize on record creation and backfill when an expression field is created/re-configured; `dependsOn` is derived server-side (client input no longer trusted); exponent-notation values (1e21/1e-9) evaluate correctly.
- `cell.upsert` uses `onConflictDoUpdate` (no more unique-violation race); `base.create` and the default workspace bootstrap are race-safe and transactional; `table.create` publishes after commit.
- history `listByBase`/`listByTable` join in SQL instead of loading every cell of the base.
- tRPC `errorFormatter` stops leaking raw driver errors to clients.
- Realtime: `NOTIFY` failures no longer crash the process (fire-and-forget catch), LISTEN has error handling, the client's `close()` no longer resurrects, invalidation is scoped to the changed table.
- Sidebar collapse state is shared between Topbar and Sidebar (`useSyncExternalStore` + localStorage); dead `/members` and `/settings` sidebar links removed.
- Login/register wrap network calls in try/catch; invite page requires an explicit "Accept invite" click; mutation failures surface toasts across members/settings/views/field-editor; toasts are `role=status`.
- Schema: `base_member` composite PK (with dedupe migration), `cell_history(cell_id, changed_at)` + hot FK indexes + GIN declared in schema, unique indexes on share/invite tokens (migration `0009`).
- CSV plugin: BOM stripped on import, boolean literals (`true/1/yes/on`…), 5MB input cap, whole-import transaction, per-row/column skip reporting, export truncation reported.

### Engineering

- **CI added** (`.github/workflows/ci.yml`: lint → typecheck → test → build on push/PR); `release.yml` `:latest` condition fixed (any non-prerelease tag).
- 51 pre-existing type errors fixed (test session fixtures now match the full better-auth session shape); `pnpm typecheck` works across all packages; `eslint-plugin-react-hooks` enabled.
- Removed the four never-consumed plugin registries (viewType/uiSlot/event/authProvider); `PluginDefinition.fieldTypes` tightened to `Contribution<FieldTypeContribution>[]` (loader cast removed).
- Grid cells are memoized with stable callbacks — typing re-renders one cell, not the whole table; multi-select chips keyed by option id; link-cell popover has search; export filename collisions fixed (matched by tableId).
- Dockerfile: `USER node`, writable `/app/data` uploads dir, `HEALTHCHECK` via new `/api/health`; compose hardened (env-required secrets, restart policies, no personal-project comments).
- Docs synced with reality: views (Grid today; Form/Kanban/Gallery planned), plugin scope, project layout, STATUS.md refreshed, e2e README file list corrected, ADR-0006 marked partially superseded; `js-yaml` declared as a root devDependency (API runner no longer hardcodes the pnpm store path).
- Test count 110 → 120 (BOM/injection/unguard/boolean/traversal/exponent regressions covered).

### Security & data integrity (review round 2, 2026-10-02)

- **Public share links are view-scoped**: `getTables` returns only the shared view's table, view/table ownership is validated, hidden fields are projected out of the data, and deleting the view kills the share.
- `member.listUsers` is restricted to members of the same base.
- **`DISABLE_SIGNUP=1`** locks an instance to existing accounts (optional e2e scenario included: `tests/e2e/api/04-disable-signup.yaml`).
- Cell values are capped at 256KB serialized; view options are zod-validated (depth ≤ 10, ≤ 50 nodes, 64KB) with a depth guard in `compileFilter`.
- tRPC and upload routes validate `Origin`; the WebSocket gateway re-verifies base membership every 5 minutes, kicks revoked members, rate-limits subscriptions, and reconnects LISTEN with backoff.
- Table/base deletion cascades clean dangling link references and append `cell_history`; CSV import runs through the core expression materialization with a 50k-row cap; extension-less uploads are fixed (storage `KEY_RE`).
- Link fields validate `targetTableId` stays in the same base and that referenced records exist (`cell.upsert` now runs `validateCellValue`); expression `dependsOn` cannot reference expressions or cross tables, and deleting a depended-on field is blocked; expression backfill batches 500 rows at a time; `cell.upsert` uses an advisory lock to keep history rows attached; record sorting gained a deterministic `record.id` tiebreaker.
- Migration `0010`: covering indexes on `record(table_id, created_at DESC)` and `cell_history(changed_at DESC)`.

### Frontend (Grid & realtime UX)

- Grid offset pagination fixed ("third Show more" crash) with a proper error state; **virtual scrolling** via `@tanstack/react-virtual` (32px rows per spec) with lazy cell editors (zero Select/Popover in display mode).
- Cell edits are optimistic (double refetch eliminated); **LWW conflicts surface a toast** (`overwroteRecentBy`); single-click selects / double-click edits; Escape refocuses and `scrollIntoView`s; pasting validates per field type; column-width dragging no longer leaks and is keyboard-adjustable; sticky header.
- Breadcrumbs wired to both slots; presence wired into Topbar/Statusbar (fake `onlineCount=1` removed); Link fields target the current base; `generateMetadata` for pages; HSTS header; shared initials/format modules; error pages no longer leak internals; dead code removed; login page lost its non-functional OIDC button.
- New tests: realtime gateway unit suite (8 cases), view-query SQL assertions (19 cases) — suite now 200+ cases.

### Tests, CI, Docker & engineering (review round 2, 2026-10-02)

- **`roles.ts` truth-table tests**: `apps/web/src/lib/roles.test.ts` rewritten against the real logic with a mocked db — the member-role × minRole gate truth table (viewer < editor < owner satisfies `assertRole`/`assertTableRole`), non-members, and `baseIdFromTable` hit/miss (22 cases).
- **API e2e runner hardened** (`tests/run-api-tests.cjs`): unrecognized assert syntax now **throws** instead of silently passing (fake green); `$env:VAR` references implemented (exact and inline); `[N]` array paths in assertions; `Origin` derived from `BASE_URL` instead of hardcoded `localhost:7420`; per-test `requires_env` gating for optional scenarios; `cleanup`/teardown removed from the docs (it never existed — scenarios use unique names instead).
- **CI**: all jobs have `timeout-minutes: 30`; new **e2e job** (postgres:16 service → build → boot production server → wait for `/api/health` → run `tests/run-api-tests.cjs`); turbo cache via `actions/cache`; `release.yml` now runs a full verify pass at the tag SHA before building and **smoke-tests the pushed image** (boot + `/api/health` against a disposable Postgres); actions bumped to current majors with **dependabot** (github-actions + npm per workspace dir + docker, weekly).
- **Docker**: multi-stage build — full install + `next build` in the builder, `pnpm install --prod --frozen-lockfile` in the runner; the final image ships no devDependencies, no tests/docs/.github/archived (`.dockerignore` extended); app sources ship because the custom server runs via tsx (documented tradeoff in the Dockerfile); all four workspace `package.json`s are copied before install (dangling-symlink cache trap). Compose: `./data:/app/data` uploads volume, `env_file: .env` passthrough, Postgres bound to `127.0.0.1:5433`, conservative `mem_limit`/`cpus` on both services.
- **Boot migrations moved into `server.ts`**, wrapped in a pg advisory lock (`pg_advisory_lock` → drizzle `migrate()` → unlock on a reserved connection) so concurrent replicas serialize; failures exit non-zero. `tsx` and `next-rspack` moved to runtime dependencies (the production image needs both: tsx boots the server; Next loads `next.config.js` at startup).
- **dev.sh**: migration failures print drizzle's stderr with a prominent warning and an interactive abort choice (`DEV_ABORT_ON_MIGRATE_FAILURE=1` in non-tty); background jobs run in their own process groups and cleanup kills the whole group (no more `next dev` strays on 7420); port preflight on 7420/7419/7400 with clear messages (a leftover dev Postgres is torn down automatically).
- **Engineering config**: `eslint.config.js` no longer blanket-ignores `*.config.{js,ts}` — security-relevant configs (`next.config.js` CSP/HSTS) are linted as CommonJS; type-aware `@typescript-eslint/no-floating-promises` enabled for `apps/web/src/server/**` (verified active, zero violations); vitest `typecheck.include` aligned with the actual `*.test-d.ts` distribution (packages only); `license: AGPL-3.0` declared in the root and all workspace `package.json`s; `.env.example` documents `DISABLE_SIGNUP` and clarifies `DATABASE_URL` is dev-only (compose assembles its own), plus dev port knobs. Fixed a broken `tw-animate-css` spec (`^1.4.1` does not exist upstream; back to `^1.4.0`) that made `--frozen-lockfile` installs fail.
- Docs: README (EN/中文) license badge + section, Docker volume/backup notes, e2e-in-CI description, corrected test-credentials pointer (`tests/e2e/README.md`); UPGRADE.md documents migrations 0009/0010 and the new boot-migration behavior; STATUS.md refreshed; ADR 0002/0003/0005 annotated with as-built notes; CONTEXT.md's expression wording matches the hand-written evaluator.

### Grid & frontend fixes (review round 3, 2026-10-02)

- **fix(grid)**: the error banner on later pagination pages now actually shows — the wrong slice used to drop data silently; `mergeGroups` dedupes by record id (no more duplicate React keys); editing a grouped/filtered field refreshes the now-stale conditions; viewer column widths align; anonymous routes no longer open/reconnect the WebSocket; Date fields exit type-to-edit; `generateMetadata` for the table page; dead `presence-bar` code removed.

### Server correctness (review round 3, 2026-10-02)

- **fix(server)**: public-share view options parsing is strict (legacy invalid shapes no longer silently degrade to full output); deleting a field referenced by a public-share filter invalidates the share and cleans the view config; changing `targetTableId` on a link field that already has values is rejected; attachment cleanup batches to avoid protocol parameter limits; surviving link-field references are checked before a table delete; dead-reference cleanup commits in chunks; base deletion removes invalid cleanup jobs; history pagination gained a unique tiebreaker; the cell size cap is enforced by serialized bytes; link value validation moved inside the transaction; expression materialization upserts to prevent concurrent 500s; CSV import commits in batches, writes cell history, and raises `TRPCError`; field options gained entry/length caps; ws `maxPayload` set to 1MiB.

### CI, runner & docs (review round 3, 2026-10-02)

- **chore(ci)**: `format` added as a CI gate (`pnpm format:check`; `next-env.d.ts` is prettier-ignored as a Next-managed generated file); the API e2e runner resolves `$response.body…` / `$ref:` / `$env:` references through the full-path resolver and **throws** `Unknown variable reference` instead of silently passing the literal string (this fixed a fake-green in `00-auth.yaml`, where the "wrong password" case actually tested "user not found"); `requires_env` accepts arrays — `04-disable-signup.yaml` gates the existing-account login case on both `E2E_EXISTING_EMAIL` and `E2E_EXISTING_PASSWORD`; the e2e job logs the server to `/tmp/web-server.log` and dumps it on failure, and sets `NEXT_TELEMETRY_DISABLED=1`; turbo cache keys de-conflicted between the verify and e2e jobs (`-e2e` suffix, shared restore prefix); the release smoke-test message says `/api/health`, an exhausted postgres readiness loop fails the job, and the ghcr image name is lowercased (`GITHUB_REPOSITORY` may contain uppercase); README (EN/中文) documents reverse-proxy requirements (nginx `proxy_set_header Host $host` so Origin/Host validation passes) and that HSTS is enabled.

### Concurrency & security hardening (review round 4, 2026-10-02)

- **fix(realtime)**: the WebSocket client no longer has an unrecoverable `closed` state — a StrictMode double-mount sequence (connect → close → connect) used to leave dev sessions permanently disconnected; socket handlers now guard on socket identity, so a stale `onclose` can no longer drop a fresh connection or spawn a duplicate socket; teardown resets the reconnect backoff. Regression tests cover all four scenarios (client + provider level).
- **fix(server)**: the table-delete concurrency window family is fully closed — the final delete transaction locks the dying table row first and `field.create`/`updateOptions` take the same `FOR UPDATE` lock on their link target (whichever commits first, the other side sees the referrer or a missing target); a post-delete sweep re-runs the idempotent dead-ref cleanup until a round finds nothing; cleanup probes lock hit rows with `FOR UPDATE`, eliminating the lost-update between concurrent cleaners (also applied to `record.delete`); concurrent invite acceptance is idempotent (`onConflictDoNothing`) instead of a 500; the last-owner guard reads and writes under `SELECT … FOR UPDATE`, closing the two-owner race to zero owners.
- **fix(csv)**: the "failed after N rows were imported" message no longer overstates what survived — the counter only advances after a batch commits (the previous test had baked the lie in); per-cell values respect the same 256KB serialized cap as interactive edits; the message carries a stable `[partial-import]` token the settings UI matches on.
- **fix(security)**: unauthenticated request bodies are size-capped by `Content-Length` pre-checks (8MB for API — CSV import needs the headroom — 55MB for uploads, 413 before buffering); `getTables` on a view-pinned share applies the same strict options parsing as `getBase`/`getRecords` (invalid legacy options fail closed); attachment downloads use RFC 5987 (`filename*`) so non-latin1 filenames stop 500ing; `field.delete` and `view.updateOptions` serialize on a table-scoped advisory lock, closing the race that could silently widen a public share's filter; the login `callbackUrl` check is now true same-origin (blocks `/\evil.com` and friends).
- **fix(grid)**: editing a cell that is a view's sort key now refreshes the record list (row order used to go stale until the next unrelated change).
- **fix(db)**: migration 0011 replaces the single-column `cell_history.changed_at` index with `(changed_at DESC, id DESC)` to back the deterministic history pagination ordering.
- **chore**: e2e README documents the assert-operator whitelist (`==`/`!=`/`contains`/`startswith`/`endswith`) and the `requires_env` truthiness semantics; the runner's skip message says "not set or falsy"; README (EN/中文) notes the reverse-proxy body cap (`client_max_body_size`); STATUS.md test count updated (340) and known limitations refreshed.

### Concurrency, limits & final hardening (review round 5, 2026-10-02)

- **fix(server)**: dead-reference cleanup is now strictly convergent — `cell.upsert`'s in-transaction link re-check takes `FOR SHARE` on the referenced records (a concurrent delete now waits for the upsert to commit, so the cleanup scans always see and strip what it wrote); `cell.upsert` takes the record row lock immediately after its advisory lock (removing an AB-BA deadlock window with `record.delete`); `record.delete` locks its record row before scanning (same closure); expression materialization orders field access by id (last narrow lock-ordering window); `table.delete` verifies the locked row exists (concurrent double-delete no longer fakes success) and re-snapshots record ids inside the final transaction for the post-delete sweep; `field.updateOptions` throws NOT_FOUND when the field vanished mid-flight instead of a 500; connections get `lock_timeout = 5s` (a stuck lock wait can no longer starve the 10-connection pool); the migration advisory-lock key moved out of the `hashtext` keyspace; migration journal timestamps corrected.
- **fix(limits)**: CSV import no longer false-rejects CJK content — `csvText` is capped by UTF-8 bytes (not code units) and the tRPC body pre-check rose to 12MB (2× the 5MB cap covers JSON escaping); upload filenames are byte-truncated to 255 (a 60K-char name used to permanently break that attachment's downloads via an oversized `Content-Disposition`); chunked requests without `Content-Length` are now read with a byte cap before buffering (the default no-proxy deployment was OOM-able through the public procedures).
- **fix(realtime)**: a throwing `new WebSocket()` (bad env URL) no longer leaves the reconnect path permanently wedged; presence updates no longer trigger redundant subscribe/unsubscribe frame pairs; the fake sockets in tests now throw on send-while-CONNECTING, and the previously-untested paths (stale onerror, teardown backoff reset, constructor failure) have regression tests.
- **fix(views)**: `view.updateOptions` (inside the advisory lock) and `share.create` both reject configs referencing unknown field ids — the three-ring defense (write gate → field.delete cleanup → share-time re-check) makes the silently-dropped-filter condition unreachable, so a public share can never be unknowingly widened.
- **fix(runner)**: `===` / `!==` assertions now throw `Unknown assert` up front (the old regexes silently swallowed `!==` into a tautology — README claim corrected to match).
- **fix(e2e plumbing)**: the `[partial-import]` message now survives the root errorFormatter (it used to be stripped exactly when the underlying DB error hit — the one scenario the settings UI needed it for); `pnpm start` sets `NODE_ENV=production` so a bare invocation can no longer silently skip boot migrations and the secret fail-closed check.

### Review round 6 — final polish (2026-10-02)

- **fix(security)**: the upload route authenticates **before** the chunked-body buffering path — `readBodyWithCap` (up to 55MB in memory) now only ever runs for a caller with a session; an unauthenticated chunked upload is refused with 401 before a single byte is buffered (round-5's own protection had introduced the ordering flaw).
- **fix(errors)**: Postgres lock waits (`55P03` lock timeout, `40P01` deadlock) map to a retryable `CONFLICT` ("This content is being modified by another operation — please retry") instead of a masked 500 — wired at the eight lock-prone transactions (cell upsert, record delete, table-delete chunks + final tx, field create/updateOptions/delete, view updateOptions) with a formatter-level fallback for any straggler path.
- **fix(csv)**: the `[partial-import]` message now leads with the token and carries no driver error text (logged server-side only) — the formatter matches with `startsWith`, so no future accidental splice of user input into an internal message can ride the token past the masking.
- **fix(server)**: `cell.upsert` verifies the early record-row UPDATE actually touched a row (concurrent delete → clean NOT_FOUND instead of an FK 500); `pnpm start` works on every shell — `server.ts` defaults `NODE_ENV=production` in-module (the old env-prefix script broke on Windows).
- **fix(realtime)**: `usePresence` returns a shared empty-array identity (a per-call `?? []` chained Topbar re-renders on every presence frame for base-less routes).
- **fix(runner)**: POST requests carry their input in the JSON body instead of the URL query string (large inputs blew the request line against maxHeaderSize).
- **chore**: migration journal gets its trailing newline back; `pnpm start` script simplified.
- **Accepted as-is** (reviewer-endorsed): migration 0009 re-declares a `CREATE INDEX IF NOT EXISTS` (one benign NOTICE per fresh deploy — editing an applied migration is riskier than the noise), and the ws reconnect backoff has no jitter (synchronized retry pulses only matter to multi-instance deployments, which the single-tenant design doesn't ship yet).

### Infrastructure, CI, indexes & docs (review round 7, 2026-10-02)

- **fix(docker)**: a stray `UPLOAD_DIR` in `.env` can no longer override the image's `/app/data/uploads` — compose env_file beats image ENV, so a copied template used to redirect uploads into the container filesystem (lost on every rebuild). Double fix: `.env.example` ships `UPLOAD_DIR` commented out with a warning, and the compose web service pins `UPLOAD_DIR: /app/data/uploads` in `environment:` (which beats env_file).
- **fix(docker)**: the image `HEALTHCHECK` now probes `http://127.0.0.1:${PORT:-3000}/api/health` (shell form — exec form cannot expand env), so a `PORT` passthrough no longer leaves a healthy server permanently unhealthy; compose also pins `PORT: 3000` and the port-mapping comment says so. The runner stage drops the `wget` apk package (busybox wget covers the plain-HTTP loopback probe); `corepack enable` stays — the prod-install layer needs the pnpm shim (the runtime never calls pnpm).
- **fix(ci)**: Postgres flavor unified — the CI e2e service and the release smoke test run `postgres:16-alpine`, matching docker-compose.
- **chore(ci)**: every action in `ci.yml`/`release.yml` is pinned to a full commit SHA (`@<sha> # vN.N.N`) — release.yml holds ghcr.io push credentials, so a hijacked tag must never change what runs. Dependabot's github-actions ecosystem (weekly, already configured) rebumps the SHAs. `release.yml`'s verify job gained the missing `format:check` step, aligning it with CI.
- **fix(db)**: migration `0012` drops the redundant `cell_record_id_idx` (leading column of `cell_record_field_uq` covers it) and `record_table_id_idx` (leading column of `record_table_created_at_idx` covers it), and adds the missing `base_id` indexes on `base_share`, `base_invite`, and `attachment` — `share.list`/`invite.list` and base-level cascade deletes stop seq-scanning as those tables grow.
- **test**: new `apps/web/src/server/trpc/routers/export.test.ts` (6 cases) — the `exportBase` role gate (minimum role viewer; FORBIDDEN rejects before any data read), per-table CSV assembly through the real plugin-csv (orderIndex field sort, quoting, `=`-prefix injection guard, filename sanitization), the truncation flag, and the empty-table header-only export.
- **docs**: UPGRADE.md documents migrations 0011 and 0012 and corrects the stale "four migrations (0007–0010)" range; CLAUDE.md's router list adds `export.ts`/`invite.ts`/`public-share.ts`, the views note now matches README (Grid shipped; Form/Kanban/Gallery planned), and the testing note describes the per-file `// @vitest-environment jsdom` pragma (default node environment); README (EN/中文) add two deployment/security notes — public exposure wants `DISABLE_SIGNUP=1` or an access-controlled proxy, and reverse-proxy HTTPS requires `BETTER_AUTH_URL=https://…` for Secure session cookies.

### Crash, IME & realtime consistency (review round 7, 2026-10-02)

- **fix(critical)**: `field.delete` no longer 500s on views whose `filter` is a bare condition node — `removeFieldReferences` pruned the tree as if the root were always a group (`group.conditions is not iterable`). The pruner now branches on `isFilterGroup`; bare roots drop the filter when the field is referenced and are left intact otherwise. Bare-root `removeFieldReferences` cases added to `view-ast.test.ts` (the suite only ever fed it group roots — the exact blind spot that shipped the bug).
- **fix(critical)**: IME composition no longer commits cells — Enter/Tab/Escape in the inline editor and the grid key handler return early while `nativeEvent.isComposing` is set, so confirming a candidate in a CJK IME stops eating the draft.
- **fix(realtime)**: missed-change compensation at both ends. Server: when the Postgres LISTEN connection reconnects (postgres.js `onlisten` + an `everListened` flag to skip the first connect), the gateway rebroadcasts a synthetic base-level `change` on every active channel — every client refetches, closing the silent-stale window. Client: `RealtimeClient.onReconnect` (distinguishes reconnects from first connect / StrictMode remounts) lets the provider invalidate `base.list` + the subscribed tables' queries after a reconnect.
- **fix(realtime)**: change broadcasts now invalidate through a 200ms trailing debounce (per-tableId coalesced, base-level changes upgrade to a full round) — a collaborator typing through 10 cells no longer fires 30 refetch storms.
- **fix(realtime)**: CSV imports broadcast `table.change` after commit via a new `realtime.publishTableChange` face on `CoreServerApi` (also fired when a partial import kept rows); exports stay silent. Previously plugin writes were invisible to other clients until a manual refresh, violating ADR-0002.
- **fix(realtime)**: `record.delete`'s cross-table dead-ref cleanup now notifies every affected table (deduped, own table excluded) instead of only the deleted record's table — referrer grids no longer keep stale link ids.

### Concurrency & server hardening (review round 7, 2026-10-02)

- **fix(concurrency)**: expression backfill takes the record row lock (`UPDATE … RETURNING` per record, ascending id) before reading cells in each batch transaction — a concurrent `cell.upsert` on any source field can no longer interleave a newer commit between the backfill's snapshot and its write, which used to leave the expression cell stale forever (no later write would re-trigger it). Lock-order comment in the code argues why the record lock (not the advisory lock, whose key names the _written_ field) is the closure point, and why per-record updates (not one IN-list) keep a provable ordering.
- **fix(server)**: graceful shutdown — SIGTERM/SIGINT stops the listener, closes every WebSocket with 1001, ends the SQL pool (including the LISTEN connection), and exits 0; an 8s backstop beats Docker's SIGKILL. Verified by signal-testing the standalone gateway (clean exit 0). Startup failures now `.catch` with the stack and exit 1 instead of dying as unhandled rejections.
- **fix(server)**: non-`/realtime` upgrade sockets are destroyed (they used to dangle); runtime migrations use a dedicated one-shot postgres connection without the pool's `lock_timeout` — a second replica rolling in no longer aborts on `55P03` while waiting for the migration advisory lock, and DDL waits out table locks instead of dying at 5s.
- **fix(concurrency)**: `overwroteRecentBy`'s 60s window is measured DB-clock-to-DB-clock (the record UPDATE's `RETURNING` carries `now()` for free) — app/DB clock skew no longer shifts the recent-edit warning window.
- **fix(gateway)**: broadcasts check `ws.bufferedAmount` — a slow consumer past 4MiB of queued frames is terminated (with a warn log) instead of growing server memory without bound; `closeAll()` added for shutdown.
- **fix(roles)**: `table.delete` requires owner (was editor) — irreversible, cross-table cascading, no undo, same standard as `base.delete` (and Airtable's model; editors keep create/rename). `member.updateRole`/`remove` throw NOT_FOUND on 0 affected rows instead of silently succeeding (and kicking a ghost). `base.delete` snapshots members inside the transaction and kicks every subscriber afterwards — removed bases no longer hold channels for the 5-minute sweep.

### Security hardening (review round 7, 2026-10-02)

- **fix(upload)**: per-user total upload quota (`UPLOAD_USER_QUOTA_MB`, default 2048, 0 = unlimited) — sums stored attachment sizes plus the incoming file and returns 413 past the limit. Closes the register-then-fill-the-disk abuse vector on public deployments.
- **fix(validation)**: attachment cells validate ownership like link cells — `existingAttachmentIds` resolves the field's base from its table and rejects ids that don't exist as attachments of that base (FOR SHARE, same TOCTOU discipline as link). Cross-base/garbage ids no longer stick in cells.
- **fix(files)**: downloads stream (`getStream` optional storage method, `createReadStream` for local) under a per-user concurrency semaphore (`DOWNLOAD_CONCURRENCY_LIMIT`, default 4, 429 when exceeded; slot returned on stream close in all three end states) — a 50MB file no longer rides entirely in container memory per request.
- **fix(auth)**: production startup warns loudly when `BETTER_AUTH_URL` is `http://` (reverse-proxy HTTPS deployments need the https URL for Secure cookies).
- **fix(share)**: new shares get an expiry (`expiresInDays`, default 90, max 365; existing null-expiry shares keep their never-expires semantics) — leaked tokens stop being permanent. The members page shows the expiry per share.
- **fix(history)**: `changedByEmail` is only returned when the editor is still a member of that base (EXISTS gate in SQL) — removed members' emails no longer leak to current viewers. Names stay (the UI's display fallback).
- **fix(public-share)**: `getRecords` accepts an `offset` (the share page now appends real pages via "Show more" instead of re-fetching a bigger first page).

### Frontend & UX (review round 7, 2026-10-02)

- **fix(grid)**: `usePagedRecords` memo keyed on a primitive signature (`dataUpdatedAt` join) — `useQueries` returns a fresh array every render, which made the merge/flatten memo a no-op recomputing the whole pipeline on every keystroke.
- **fix(grid)**: link & multi-select editors keep a local seeded selection set — rapid consecutive toggles during the async optimistic-patch window no longer silently drop the first pick; covered by a new jsdom test that simulates the patch-not-yet-landed window.
- **fix(grid)**: column widths only sync from the server when the active view changes — an incoming remote view update no longer bounces a drag (or an in-flight debounced commit) back to stale widths.
- **fix(ux)**: cell-history dock and the base tables page distinguish query errors from empty data (Retry buttons added) — failures stopped masquerading as "No changes recorded."/"No tables yet".
- **fix(ux)**: paste accepts both multi-select separators (`|` from CSV export, `,` from hand-typed); date-only editor drafts normalize to `YYYY-MM-DD` so values with a time part no longer render an empty date input.
- **fix(a11y)**: boolean cells get an accessible name; login/register inputs carry proper `autocomplete` attributes.
- **chore**: eslint `react-hooks/exhaustive-deps` promoted warn → error (zero violations at flip); vitest sets `BETTER_AUTH_URL` so the better-auth baseURL warning stops polluting every run; dependabot header updated for the SHA-pinned actions.

### Phase A: Share, Grid, History, Polish

#### Share

- Added `base_share.created_by` column to track share creators
- Implemented public read-only share endpoints (`getBase`, `getTables`, `getRecords`)
- Created `/share/[token]` public view page with `CellRenderer readOnly` support
- Added `readOnly` prop to `CellRenderer` component

#### Grid

- Defined expression field value in column header chip
- Implemented row selection (click toggles, Shift range, Cmd multi-select)
- Restored single-row delete button (regression fix from row-select refactor)
- Added cell copy/paste (Cmd/C + Cmd/V)

#### History

- Built `listByBase` and `listByTable` history queries (tRPC router)
- Created Base-level change timeline page with Settings tab redirect
- Added cell history restore confirmation dialog with diff view
- Fixed type alignment (`changedAt` string, `oldValue`/`newValue` optional)

#### Polish

- Wired mutation Toasts for Grid editing and share creation
- Filled Command Palette (Cmd+K) with navigation commands
- Covered loading, error, and empty states across Grid and Members pages
- Phase A final review: fixed share authorization, history total count, page states, duplicate commands

### Phase B: Invites, Roles, Export

#### Invites

- Created `base_invite` table schema (Drizzle migration `0008_bored_emma_frost`)
- Implemented invite router: `create`, `list`, `delete`, `resolve`, `accept`
- Built `/invite/[token]` public accept page with callback URL redirect
- Added invite form and pending invites list to Members tab

#### Roles & Permissions

- Added `assertRole` middleware for backend authorization on all mutation routers
- Role gates applied to: `cell.upsert`, `record.create/delete`, `table.create/rename/delete`, `field.create/rename/updateOptions/delete`, `view.create/rename/updateOptions/delete`
- Added `me` query to member router for current-user role lookup
- Created owner membership on base creation
- Gated Grid Editor UI for `viewer` role (read-only mode)
- Updated page layout to pass `baseId` to `GridEditor`

#### Export

- Implemented Base-level CSV export (multi-table, one ZIP per base)
- Documented deviation: v1 includes all fields, no view-based field filtering

### Infrastructure

- **Field Type Registry** (ADR-0009): server-side value semantics via `FieldTypeContribution` objects registered in `fieldTypeRegistry`; `field-value.ts` reads from registry; 10 built-in field types with parity tests
- **Plugin System**: CSV plugin (import/export) via Server Router factory + UI Slot extension points; local storage adapter; static plugin assembly in `plugins.config.ts`
- **Release**: version `1.0.0-alpha.1`, CI/CD via GitHub Actions (tag-triggered ghcr.io multi-arch Docker build), upgrade documentation
