# Changelog

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
