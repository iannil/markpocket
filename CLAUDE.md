# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**markpocket** is a self-hosted Airtable alternative — bases, tables, fields, records, views (Grid shipped; Form / Kanban / Gallery planned), real-time collaboration, cell-level history, and CSV in/out — in a single Docker container.

- **Single-tenant self-hosted** (ADR-0004): one container per team, no SaaS
- **Row-per-cell storage** (ADR-0001): every cell is its own DB row with JSONB value
- **Soft real-time** (ADR-0002): WebSocket broadcast + Last-Write-Wins, no OT/CRDT
- **Expression fields, not a Formula DSL** (ADR-0003): write-time evaluation scoped to one record
- **Designed for <100k rows per table** (this constraint keeps the architecture simple)

## Build & Test Commands

```bash
pnpm install              # install dependencies
pnpm dev                  # start dev servers (turbo)
pnpm build                # build all packages
pnpm test                 # run all tests (vitest)
pnpm lint                 # eslint across workspace
pnpm typecheck            # tsc --noEmit across workspace
pnpm format               # prettier write
pnpm format:check         # prettier check
pnpm test:e2e-api         # API e2e scenarios (needs a running instance)
pnpm db:generate          # run drizzle-kit generate
pnpm db:migrate           # run drizzle-kit migrate
pnpm db:studio            # open drizzle-kit studio
```

### One-shot dev environment

```bash
./dev.sh                  # starts Postgres (Docker), runs migrations, starts web + realtime
```

Opens at http://localhost:7420. Postgres on port 7400, WebSocket gateway on 7419.

### Per-package commands

```bash
pnpm --filter @markpocket/web dev        # Next.js dev server only
pnpm --filter @markpocket/web dev:realtime  # standalone realtime gateway
pnpm --filter @markpocket/web typecheck  # tsc --noEmit
pnpm --filter @markpocket/web lint       # eslint app
```

### Running tests

```bash
pnpm test                             # all tests
pnpm test -- --run src/foo.test.ts    # single test file
pnpm test -- --watch                  # watch mode
pnpm test -- -t "field type"          # filter by test name
```

Tests use `vitest` (default `node` environment); React component tests opt into `jsdom` per file with a `// @vitest-environment jsdom` pragma. Test files are co-located: `*.test.ts`, `*.test.tsx`, and `*.test-d.ts` (type-level tests).

## Architecture

### Monorepo Layout

```
markpocket/
├── apps/web/                           # The whole product
│   └── src/
│       ├── app/                        # Next.js App Router pages
│       │   ├── (auth)/                 # login, register
│       │   ├── api/                    # tRPC, auth, file/upload, v1 (agent REST), mcp, skill routes
│       │   └── bases/                  # base list, base detail, table pages
│       ├── components/                 # UI components
│       │   ├── ui/                     # shadcn/ui primitives
│       │   ├── field-config/           # field editor dialog, type picker
│       │   ├── view-config/            # filter, sort, view tabs
│       │   ├── realtime/               # presence bar, WebSocket provider
│       │   └── [app-shell, sidebar, topbar, statusbar, ...]
│       ├── lib/                        # Client-side utilities
│       │   ├── field-types.ts          # FieldType const, FIELD_TYPE_META (client-only)
│       │   ├── view-ast.ts             # View options AST types
│       │   ├── view-query.ts           # View query execution
│       │   ├── expression-eval.ts      # Expression field evaluation
│       │   ├── roles.ts                # assertRole/assertTableRole role gates (server-consumed)
│       │   ├── db-queries.ts           # Pivoted record queries (server-consumed)
│       │   ├── trpc/client.tsx          # tRPC React client
│       │   ├── realtime/client.ts      # WebSocket client
│       │   └── plugins/ui-slot-client.tsx  # UI slot client
│       ├── server/                     # Server-side code
│       │   ├── db/                     # Drizzle schema, migrations, db connection
│       │   │   ├── schema.ts           # Domain tables (workspace, base, table, field, record, cell, etc.)
│       │   │   └── auth-schema.ts      # better-auth tables
│       │   ├── trpc/                   # tRPC setup + routers
│       │   │   ├── init.ts             # tRPC context + procedure builder
│       │   │   ├── router.ts           # App router merge
│       │   │   ├── caller.ts           # Server caller
│       │   │   └── routers/            # Per-entity routers
│       │   │       ├── base.ts, table.ts, field.ts, record.ts, cell.ts
│       │   │       ├── view.ts, workspace.ts, auth.ts
│       │   │       ├── history.ts, member.ts, share.ts, invite.ts
│       │   │       ├── export.ts, public-share.ts, token.ts
│       │   ├── agent-access/           # Agent access layer (ADR-0010)
│       │   │   ├── tokens.ts           # Bearer token mint/verify (sha256, api_token table)
│       │   │   ├── agent-caller.ts     # appRouter.createCaller with synthetic session
│       │   │   ├── http.ts             # Shared edge: origin/body-cap/rate-limit/error mapping
│       │   │   ├── records-service.ts  # create-with-cells / update-cells composites
│       │   │   ├── rss.ts, skill-template.ts
│       │   │   └── mcp/                # Hand-rolled MCP streamable HTTP (json-rpc, tools, server)
│       │   ├── plugins/                # Plugin system
│       │   │   ├── registry.ts         # 2 registries with real consumers (storage, fieldType)
│       │   │   ├── index.ts            # Barrel: loads plugins + registers builtin fields
│       │   │   ├── loader.ts           # Plugin loader (iterates PluginDefinition)
│       │   │   ├── field-value.ts      # Server-side value semantics (reads registry)
│       │   │   ├── core-api.ts         # Core server API exposed to plugins (incl. auth.assertTableRole)
│       │   │   ├── storage.ts          # Storage adapter
│       │   │   └── builtin-fields/     # 10 built-in FieldTypeContribution + parity tests
│       │   ├── expression.ts           # Expression materialization (record + backfill)
│       │   ├── realtime/               # WebSocket gateway + Postgres LISTEN/NOTIFY
│       │   │   ├── gateway.ts          # WebSocket server, auth, channels, broadcast
│       │   │   ├── publish.ts          # Postgres NOTIFY
│       │   │   └── subscribe.ts        # Postgres LISTEN
│       │   └── auth.ts                 # better-auth setup
│       ├── server.ts                   # Production custom server (Next.js + WebSocket)
│       ├── realtime-server.ts          # Dev-only standalone WebSocket gateway
│       └── plugins.config.ts           # Static plugin assembly point
├── packages/
│   ├── plugin-sdk/                     # SDK: Registry, Contribution, PluginDefinition, types
│   ├── plugin-csv/                     # CSV import/export plugin
│   └── plugin-storage-local/           # Local filesystem storage adapter
├── docs/
│   ├── adr/                            # Architecture Decision Records (0001-0009)
│   ├── STATUS.md                       # Project status
│   ├── migration/plan.md               # teable → markpocket migration plan
│   └── redesign/                       # Paper & Ink redesign specs + progress
└── CONTEXT.md                          # Domain glossary
```

### Key Architectural Decisions

1. **Single process**: Next.js custom server mounts both the HTTP handler and WebSocket gateway on one Node process. In dev, they're split (separate realtime-server.ts) to avoid Next.js compiler memory issues.
2. **Row-per-cell storage**: Each cell = one row in the `cell` table with JSONB `value`. Cell history is an append-only `cell_history` side-table. This makes field-level filtering trivial and schema evolution a standard Drizzle migration.
3. **Plugin system**: 2 extension-point registries with real consumers (storage: `plugins/storage.ts`; fieldType: `plugins/field-value.ts`). Plugins are statically assembled in `plugins.config.ts`; plugin routers receive a `CoreServerApi` that includes `auth.assertTableRole` — plugin routers MUST call it before touching a table. The barrel (`server/plugins/index.ts`) loads plugins and registers built-in field types on import.
4. **Field type registry (ADR-0009)**: Server-side value semantics live in `FieldTypeContribution` objects registered in the `fieldTypeRegistry`. The `field-value.ts` module reads from the registry. Client-side `field-types.ts` only has type constants and UI metadata — no server registry.
5. **Real-time**: WebSocket per-Base channel, authenticated via better-auth session cookie. Postgres `LISTEN/NOTIFY` bridges the gap between the Next.js process and the standalone gateway in dev mode.
6. **tRPC routers**: One file per domain entity under `server/trpc/routers/`. Merged into the app router in `router.ts`.

### Domain Model (from CONTEXT.md)

- **Workspace** → **Base** → **Table** → **Field / Record / View**
- **Record** → **Cell** (one row per cell, JSONB value)
- **View** types: Grid, Form, Kanban, Gallery (per-view config persisted, never mutates data)
- **Expression Field**: write-time evaluation, scoped to one record, no cross-record cascade
- **LWW (Last-Write-Wins)**: concurrent writes resolved by server timestamp

### Testing Conventions

- Tests are co-located with source files (`*.test.ts`, `*.test.tsx`)
- Type-level tests: `*.test-d.ts` (run via vitest typecheck)
- Built-in fields have parity tests covering empty/value/error + edge cases
- Plugin loader and registry have dedicated tests
- Use `pnpm test` to run the full suite

### Naming Conventions

- "Expression Field", never "Formula" (see CONTEXT.md)
- "Select", never "Single Select" in UI labels
- Cell operations go through `normalizeCellValue` → writer applies ADR-0005 strategy (empty → DELETE row, error → reject, value → store JSONB)
