# P0–P2 final acceptance

Date: 2026-10-10. Local branch `codex/airtable-p0-p2`; no remote push, release tag, image publication or external deployment. This report supersedes phase-local pending statements in `2026-10-10-p0-p2-evidence.md` only where an assertion is explicitly recorded as passed below.

**Runtime follow-up complete:** first candidate `5bbb836` passed functional/recovery checks but hit its eight-second forced exit with realtime clients connected. A real-socket reproduction identified inherited HTTP-before-WebSocket shutdown ordering. Fix `65a8ae5` passed a scoped review, the full suite and a newly built immutable-image rehearsal. Two authenticated browsers confirmed a live update to “Final runtime accepted E”; with both connections left open, SIGTERM then exited **0**, OOM false, without the timeout. Original FR-1–FR-7 remain closed.

## Candidate and automated gates

- Production source: `65a8ae59f0b11caf89d7172fa758455f8d088c53`.
- Immutable Docker image: `sha256:bca59fc061a30e2f6abda12093f06bb2f9994432914a0148851dc153cc2aae13` (local tag `markpocket:p0p2-65a8ae59f0b1`). Image revision label identifies that exact commit. Later documentation-only commits do not change the tested production source.
- Host Node v24.14.0/pnpm 10.32.1; Docker uses the repository's Node 22 Alpine runtime. PostgreSQL 16 is isolated from application/user databases.
- Full suite with `P0_P2_PG_TEST=1 IMPORT_PG_TEST=1 EXPORT_PG_TEST=1 EXPORT_PG_SLOW_TEST=1`: **3,556 passed, one skipped; 110 files passed, one skipped; no type errors**, 65.98 seconds. The only skipped test requires an explicitly supplied live Airtable PAT.
- Root lint and typecheck: **4/4 successful each**. Production `pnpm build` on the first functional candidate: **exit 0**, 10.595 seconds. The final runtime source also completed the full production Docker build successfully. Initial build omitted DATABASE_URL and failed at page-data collection after compiling/typing; the correctly configured rerun passed without a source change.
- Actual HTTP API acceptance against the immutable image: **56 passed, zero failed, three skipped**. The three skips belong to optional disabled-signup configuration, not the new P0–P2 paths.
- Formatting gate: exact root `pnpm format:check` passed after plan scratch cleanup; all matched files use Prettier style.
- Expected fault-injection CSV stderr, Vitest's experimental typechecking notice and Rspack's experimental plugin notice remain visible. No global suppression or pristine-output claim.

## Review

All 23 implementation tasks passed their task review gates. Whole-branch review examined `bf562045b55ab80078a69a5b7132c773eb22a58c..2c6665b76f349ed9efd288b8b55c1136ba1049cd`. One consolidated fix wave and one scoped re-review closed:

1. Exhausted invalidated webhook leases now become dead; lower attempts remain pending; stale acknowledgements fail and explicit retry retains event ID.
2. Grid options use a view-scoped draft and serialized save/refetch queue; rapid operator/value edits and overlapping width/visibility edits retain each change and refresh counts.
3. Public Form retry stops at the seven-day boundary and requires explicit confirmation with a new UUID.
4. Real Select displays ≥/≤/≠ while retaining gte/lte/ne storage values.
5. Sparse record details align at the top of the scrollable drawer.
6. Endpoint creation disables URL/event controls until completion.
7. Initial and fallback view selection remain stable across refetch reordering.

User docs and ADR-0015 explicitly measure terminal log retention from event occurrence. Scoped reviewer found no new Critical/Important breakage and no out-of-scope findings. Covering tests include actual first/fifth claims under rotate/pause/resume, deferred real Select/refetch, seven-day Form boundaries and TableView reorder/deletion/table-change cases.

## Immutable runtime and recovery

**Passed** on the exact candidate image:

- Fresh installation: HTTP health 200, zero pending migration hashes.
- Upgrade from pinned old image `sha256:1d84d7aa4eb4b179370c17addc15d569e0f18a4ac97b6ae6625b64e3528ec30b` (source `464ee546abae40191f9168929cb2e92883ef94a0`, migrations 0000–0013): HTTP health 200, zero pending migrations after 0019, identical fixed record/cell IDs and values, history, membership and attachment metadata.
- Restore: exact old image with its matching pre-upgrade DB/data snapshot into a separate empty target; health 200, zero pending old migrations and identical baseline data. No down migration or old code against upgraded schema.
- Backup checksums passed before upgrade and before restore. The 38-byte attachment retained SHA-256 `e06bff80fa17afd0840577f65458af606dfc8fdbe028adf2bd004666f8e434fb`.
- Missing and wrong independent webhook encryption keys: real unscoped production worker changed the seeded subscription to disabled and preserved both pending event IDs, states, attempts (0 and 2), lease tokens/expiry and due times. No transport was attempted. Fixture URL was loopback via direct SQL, so it could not pass the SSRF guard even if a claim bug occurred.

Core recovery projects were isolated under `markpocket-m3-uk09eu-{old,fresh,restore,negative}`. The browser project used the same immutable image with a separate disposable PG fixture. Protected environment values were never printed or committed.

## Browser and HTTP evidence

Earlier phase browser/HTTP evidence remains in the historical report: atomic paste/retry, complete field order, 201-row pagination/counts/filter/viewer, anonymous Form zero/idempotency/revocation, Kanban independent lanes/native drag/keyboard moves, current-draft detail saves/read-only expressions, hidden-field share projection and scoped token enforcement.

The following full UI/HTTP feature checks ran on first immutable candidate `5bbb836` (image `sha256:ca9e49d5ce6afdb597164824a84aa93d2860c15ff345488deeaa9197948eab23`). The only subsequent product change is shutdown ordering. Final image `65a8ae5` repeated the full automated suite, HTTP API acceptance, recovery/key-negative checks, authenticated browser realtime update and graceful stop; unchanged UI scenarios were not redundantly replayed:

- Two independent authenticated sessions: owner detail save updated the viewer's already-open read-only drawer without navigation.
- Viewer network gap: owner moved the fixture from Doing to Done; offline viewer retained Doing7/Done0, then automatically reconciled to Doing6/Done1 on reconnect.
- Form clean configuration followed the other editor's save; an unsaved owner draft produced the conflict banner and Use latest saved form adopted the remote configuration. The initial-view reorder regression is covered by the real component suite.
- Sparse viewer drawer at 390×844 shows title near y20, description near y53 and first field near y90, correcting the stretched layout. At 390×300, after the viewport layout settled, container scrolling reached scrollTop124 with scrollHeight424/clientHeight300 and the final expression field remained accessible.
- Webhook owner creation and rotation each exposed one secret only in memory, then dismissal hid it; pause/resume worked with an empty queue. Overflow required acknowledgement before Resume, then cleared the gap. Disabled guidance/recovery worked at 390px. A synthetic dead event retried while paused changed attempts5/dead to attempts0/pending without transport. Confirmed removal cascaded endpoint/queue; database counts were both zero afterward. No external receiver was authorized or used.
- Final-image HTTP Form submission/replay created one anonymous record with private headers, then revoked access returned 404; Form sharing was rejected and a Grid share could not submit. Public Kanban applied a hidden-field filter but omitted its metadata/cells. A separate fixture passed 18 REST/MCP scope/access/expiry/revocation/current-role assertions. These fixtures cleaned their owned records/views/shares/tokens.

## Explicit limits

- Real Airtable live-source import remains **preview/unverified**: no explicitly supplied PAT. Controlled import fixtures and real local PostgreSQL acceptance passed.
- Native OS clipboard Ctrl+V was not established; synthetic browser ClipboardEvent, real HTTP persistence/frozen retry and component tests passed.
- Webhook signature/transport behavior uses injected receiver tests plus real production key-negative checks. This is not evidence of a delivery to an external production receiver.
- The production shutdown fix does not change the inherited development-only realtime-server shutdown ordering. A peer refusing the close handshake can still reach the bounded force-exit fallback.
- Recovery fixtures are synthetic. The original checkout's existing modified/deleted files and untracked plan/spec files were preserved.

## Evidence locations and cleanup

Committed [review records](2026-10-10-p0-p2-review.md), [all rulings](2026-10-10-p0-p2-rulings.md) and [selected non-secret artifacts](2026-10-10-p0-p2-artifacts/) preserve the outcome. Artifacts include the failed first stop, successful final stop, candidate identity, checksums, recovery assertions and gate summaries. Full transient gate logs remain under `/private/tmp/markpocket-final-validation-hBfAzO/`. Protected environment files, database dumps and capability secrets are excluded. All owned recovery/browser containers, dedicated PostgreSQL and its owned volume, disposable environment/backup directories, uploads and four browser sessions were cleaned up. The plan-specific SDD scratch directory was removed after preserving all 17 rulings and review evidence; sibling plan workspaces and the managed implementation worktree remain intact. Exact formatting verification passed after this cleanup.
