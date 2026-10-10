# Agent Access — REST / MCP / RSS / Skill

markpocket instances expose their data to AI agents and scripts through four channels, all documented here. Architecture and rationale: [ADR-0010](../adr/0010-agent-access-layer.md).

| Channel | Endpoint | Auth | Use for |
|---|---|---|---|
| REST API | `/api/v1/**` | Bearer token | Scripts, integrations, anything HTTP |
| MCP server | `/api/mcp` | Bearer token | Interactive agent clients (Claude Code, Cursor, …) |
| RSS feed | `/feed/{shareToken}` | Share token (public) | Read-only subscriptions to a shared view |
| Agent Skill | `/api/skill` | none (public doc) | Teaching an agent how to drive this instance |

## API tokens

Personal Bearer tokens are created in the web UI: any base → **Settings → Agents**. 

- Format: `Authorization: Bearer mpk_<48 hex>` — the full value is shown **once** at creation.
- **A token acts as its creator**: every request re-runs the same base-membership and role checks (`assertRole` / `assertTableRole`) as a signed-in user. Viewer can read; editor can write records/structure; owner can delete bases/tables. Token scope further restricts those current roles (see [ADR-0014](../adr/0014-scoped-agent-tokens.md)); it never grants membership or preserves a role after downgrade.
- Choose **Current base** or **All accessible bases**, **Read** or **Read & write**, and a lifetime of **1–365 days** or explicitly **Never expires**. New UI tokens default to current base/read/30 days. Lists display each token's scope, access and expiry.
- Migration preserves existing tokens as **All bases · Read & write · Never expires**. Legacy `token.create` calls that omit scope/expiry options retain that behavior; explicit callers use `baseId` (null for all), `access` (`read`/`write`) and `expiresInDays` (1–365 or null).
- REST and MCP share request scope enforcement. `list_bases` only returns visible bases within scope; a bound token cannot create a base. Read tokens can use MCP read tools over POST but cannot mutate. Token callers can only use the published CRUD procedure allowlist; creating tokens, shares, invites and other credentials is unavailable even to all-base write tokens.
- Expiry equal to or before the current time is rejected with 401, as are revoked tokens. Scope violations return REST 403 or an MCP tool result with `isError: true` and `FORBIDDEN`.
- Revoke any time from the same settings page; revoked tokens fail immediately with 401.
- Rate limit: **120 requests/minute/token** across all channels (`AGENT_RATE_LIMIT_PER_MIN`, `0` disables). Breaches return 429.
- Request body cap: 1MB per request (413 beyond).

Errors are always `{"error":{"code","message"}}` with standard HTTP statuses (401 invalid/expired/revoked token, 403 missing role or scope, 404 unknown id, 400 validation).

## REST API

Machine-readable spec: `GET /api/v1/openapi.json`. Surface (v1, full CRUD):

| Resource | Endpoints |
|---|---|
| Bases | `GET/POST /api/v1/bases`, `GET/PATCH/DELETE /api/v1/bases/{baseId}` |
| Tables | `GET/POST /api/v1/bases/{baseId}/tables`, `PATCH/DELETE /api/v1/tables/{tableId}` |
| Fields | `GET/POST /api/v1/tables/{tableId}/fields`, `PATCH/DELETE /api/v1/fields/{fieldId}` |
| Views | `GET/POST /api/v1/tables/{tableId}/views`, `PATCH/DELETE /api/v1/views/{viewId}` |
| Records | `GET/POST /api/v1/tables/{tableId}/records`, `GET/PATCH/DELETE /api/v1/records/{recordId}` |

Example round trip:

```bash
TOKEN="mpk_…"; URL="http://localhost:3000"

# discover: bases → tables → fields (cell writes need field ids)
curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/v1/bases"
curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/v1/bases/$BASE_ID/tables"
curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/v1/tables/$TABLE_ID/fields"

# create a record with cells (fieldId → value)
curl -s -X POST "$URL/api/v1/tables/$TABLE_ID/records" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"cells": {"<fieldId>": "hello", "<numberFieldId>": 42}}'
```

### Write semantics

- `cells` values are normalized per field type. A cell that rejects its value does **not** fail the request — the response carries `cellErrors: {fieldId: message}`.
- An empty value clears a cell (row-per-cell storage: empty = no row). Omitted cells are untouched.
- `GET …/records` returns `{groups, total}` (the grid grouping shape); without grouping, records sit in `groups[0].records`. Paginate with `offset`/`limit` (max 1000). Pass `viewId` to list through a saved view's filter/sort.
- `expression` fields are computed on write and reject direct writes; `link` cells hold arrays of record ids.

## MCP server

`/api/mcp` speaks the MCP **streamable HTTP** transport: POST a single JSON-RPC 2.0 message, get `application/json` back. Stateless — no sessions, no SSE push (GET → 405), no batching. Supported methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`. Protocol versions: `2025-06-18`, `2025-03-26`, `2024-11-05`.

The 21 tools mirror the REST surface 1:1: `list/create/update/delete` for bases, tables, fields, views, plus `list_records`, `get_record`, `create_record`, `update_record`, `delete_record`.

Client config (Claude Code / Cursor style):

```json
{
  "mcpServers": {
    "markpocket": {
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer mpk_…" }
    }
  }
}
```

Tool execution failures (bad values, missing role) return MCP results with `isError: true` so the model can read the reason; protocol errors (unknown tool, invalid arguments) are JSON-RPC errors.

## RSS feeds

Every **public share link pinned to a view** also exposes a feed:

```
GET /feed/{shareToken}?limit=50     # RSS 2.0, max 100, newest records first
```

- API Bearer tokens cannot be used as share tokens. RSS keeps its existing public-share read boundary; the public Skill document grants no data access.
- Shares are created in the web UI (Settings → Members → Public share links); the feed inherits the share's lifetime (expiry, view deleted → 404) and the view's filter and hidden-field projection. Shares not pinned to a view have no feed.
- Item title = first text field (grid's display heuristic), description = visible field summary, guid = record id, link = the share page.

## Agent Skill

`GET /api/skill` returns a ready-to-install Agent Skill document (YAML frontmatter + markdown) describing this instance's REST/MCP/RSS surfaces with the instance origin interpolated. `?download=1` serves it as `markpocket-SKILL.md`.

## Server internals map

```
apps/web/src/server/agent-access/
├── tokens.ts           # mint/verify (sha256), lastUsedAt throttle
├── agent-caller.ts     # appRouter.createCaller with synthetic session
├── http.ts             # shared edge: origin/body/ratelimit/error mapping
├── rest.ts             # zod body/query parsing helpers
├── records-service.ts  # create-with-cells / update-cells / get / delete
├── rss.ts              # RSS 2.0 builder (escaping, truncation)
├── skill-template.ts   # Agent Skill document renderer
├── version.ts
└── mcp/
    ├── json-rpc.ts     # envelope types + zod parsing
    ├── tools.ts        # 21 tool definitions (zod 4 → JSON Schema)
    └── server.ts       # stateless dispatch (initialize/ping/tools/*)
```
