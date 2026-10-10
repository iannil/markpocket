// Agent Skill document served at GET /api/skill (ADR-0010). Rendered as a
// module (not read from disk) so the standalone Docker image needs no extra
// file copies; the instance origin interpolates at request time.
//
// Format: Agent Skills convention — YAML frontmatter (name, description) +
// markdown body. Install into the agent's skills directory alongside its
// SKILL.md siblings.

export function renderSkillMarkdown(origin: string, version: string): string {
  return `---
name: markpocket
description: Work with a markpocket self-hosted database — bases, tables, fields, records — over its REST API and MCP server. Use when the user asks to read, create, update or delete records, design tables, or pull RSS feeds from their markpocket instance.
version: ${version}
---

# markpocket

markpocket is a self-hosted database (an Airtable you own): **Base → Table → Field / View / Record**. Records carry cells keyed by **field id** — ids are opaque strings, always discover them first.

## Setup

Two environment facts you need from the user (both come from their markpocket instance):

- \`MARKPOCKET_URL\` — this instance's origin: \`${origin}\`
- \`MARKPOCKET_TOKEN\` — a personal API token (created in the web UI: any base → Settings → Agents). Choose Current base or All accessible bases, Read or Read & write, and a 1–365 day lifetime or Never expires. Defaults are current base/read/30 days. A token is limited by both its scope and its creator's current role: viewer can read, editor can write, owner can delete bases/tables. Bound tokens cannot create bases; read tokens cannot write. Older tokens retain all-base/write/no-expiry access.

Every request: \`Authorization: Bearer $MARKPOCKET_TOKEN\`. Rate limit: 120 requests/minute/token (HTTP 429 with a Retry-After).

## REST API (preferred for scripts)

Base URL: \`${origin}/api/v1\`. Full machine-readable spec: \`GET ${origin}/api/v1/openapi.json\`.

| Resource | Endpoints |
|---|---|
| Bases | \`GET/POST /bases\`, \`GET/PATCH/DELETE /bases/{baseId}\` |
| Tables | \`GET/POST /bases/{baseId}/tables\`, \`PATCH/DELETE /tables/{tableId}\` |
| Fields | \`GET/POST /tables/{tableId}/fields\`, \`PATCH/DELETE /fields/{fieldId}\` |
| Views | \`GET/POST /tables/{tableId}/views\`, \`PATCH/DELETE /views/{viewId}\` |
| Records | \`GET/POST /tables/{tableId}/records\`, \`GET/PATCH/DELETE /records/{recordId}\` |

Discover the world first, then write:

\`\`\`bash
# 1. What bases exist?
curl -s -H "Authorization: Bearer $MARKPOCKET_TOKEN" "$MARKPOCKET_URL/api/v1/bases"

# 2. Tables in a base → then fields (cell writes need field IDs)
curl -s -H "Authorization: Bearer $MARKPOCKET_TOKEN" \\
  "$MARKPOCKET_URL/api/v1/bases/$BASE_ID/tables"
curl -s -H "Authorization: Bearer $MARKPOCKET_TOKEN" \\
  "$MARKPOCKET_URL/api/v1/tables/$TABLE_ID/fields"

# 3. Create a record with cells (fieldId → value)
curl -s -X POST -H "Authorization: Bearer $MARKPOCKET_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"cells": {"<fieldId>": "value", "<numberFieldId>": 42}}' \\
  "$MARKPOCKET_URL/api/v1/tables/$TABLE_ID/records"

# 4. List records — optionally through a saved view's filter/sort
curl -s -H "Authorization: Bearer $MARKPOCKET_TOKEN" \\
  "$MARKPOCKET_URL/api/v1/tables/$TABLE_ID/records?viewId=$VIEW_ID&limit=50"
\`\`\`

Errors are \`{ "error": { "code", "message" } }\`; 401 = invalid, expired or revoked token, 403 = missing role or token scope, 404 = wrong id.

### Write semantics

- Create/update take \`cells\` as \`{fieldId: value}\`. Values normalize per field type; a cell that rejects its value does **not** fail the request — check \`cellErrors\` in the response.
- An empty value (\`null\`, \`""\`) clears a cell. Omitted cells are untouched.
- \`GET /records\` returns \`{groups, total}\`; without grouping, records sit in \`groups[0].records\`.
- Pagination: \`offset\`/\`limit\` (max 1000).

## MCP server (preferred for interactive agents)

Endpoint: \`${origin}/api/mcp\` — MCP streamable HTTP, Bearer-token auth, stateless.

Tools: \`list_bases\`, \`create_base\`, \`update_base\`, \`delete_base\`, \`list_tables\`, \`create_table\`, \`update_table\`, \`delete_table\`, \`list_fields\`, \`create_field\`, \`update_field\`, \`delete_field\`, \`list_views\`, \`create_view\`, \`update_view\`, \`delete_view\`, \`list_records\`, \`get_record\`, \`create_record\`, \`update_record\`, \`delete_record\`.

Client config (Claude Code / Cursor style):

\`\`\`json
{
  "mcpServers": {
    "markpocket": {
      "url": "${origin}/api/mcp",
      "headers": { "Authorization": "Bearer <MARKPOCKET_TOKEN>" }
    }
  }
}
\`\`\`

## RSS feeds (read-only subscriptions)

Every public share **pinned to a view** also exposes a feed: \`${origin}/feed/{shareToken}?limit=50\` (RSS 2.0, newest records first). Share tokens are created in the web UI (Settings → Members → Public share links) and expire with the share. An API Bearer token cannot replace a share token. This skill document is public and grants no data access.

## Field types

text, number, boolean, date, single-select, multi-select, user, link, attachment, expression. \`expression\` fields compute server-side on write — never write them. \`link\` cell values are arrays of record ids; \`attachment\` values are arrays of attachment ids.
`;
}
