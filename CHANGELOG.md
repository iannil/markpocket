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

## v1.0.0-alpha.1 (2026-08-16)

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
