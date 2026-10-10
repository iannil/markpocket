# tRPC Router API Reference

All procedures are under the `trpc.<namespace>.<procedure>` path on the client (e.g., `trpc.base.list.useQuery()`).

Auth column: **P** = protectedProcedure (requires session), **Pub** = publicProcedure (no auth).

---

## auth

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `getSession` | P | — | `Session` | Returns the current user's session object (user, session metadata). |
| `listUsers` | P | — | `{ id: string; name: string; email: string }[]` | Lists all registered users, ordered by name. |

---

## workspace

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `getOrCreateDefault` | P | — | `Workspace` | Returns the single default workspace, creating it if none exists. |

---

## base

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `list` | P | — | `Base[]` | Lists all bases in the default workspace, newest first. |
| `get` | P | `{ id: string }` | `Base \| null` | Fetches a single base by id. |
| `create` | P | `{ name: string (min 1) }` | `Base` | Creates a new base. The caller is automatically added as owner via a `baseMember` row. |
| `rename` | P | `{ id: string; name: string (min 1) }` | `Base` | Renames a base. Requires **editor** role. Publishes realtime change. |
| `delete` | P | `{ id: string }` | `{ ok: true }` | Deletes a base. Requires **owner** role. FK cascade removes tables, fields, cells, records. Publishes change. |

---

## table

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `list` | P | `{ baseId: string }` | `Table[]` | Lists tables in a base, ordered by `orderIndex`. |
| `create` | P | `{ baseId: string; name: string (min 1) }` | `Table` | Creates a table. Requires **editor** role. Also creates a default Grid view. Publishes change. |
| `rename` | P | `{ id: string; name: string (min 1) }` | `Table` | Renames a table. Requires **editor** role. Publishes change. |
| `delete` | P | `{ id: string }` | `{ ok: true }` | Deletes a table. Requires **editor** role. FK cascade clears fields, cells, records. Publishes change. |

---

## view

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `list` | P | `{ tableId: string }` | `View[]` | Lists views in a table, ordered by `orderIndex`. |
| `create` | P | `{ tableId: string; name: string (min 1); type?: string }` | `View` | Creates a view. Requires **editor** role. Defaults to `"grid"` type. Publishes change. |
| `rename` | P | `{ id: string; name: string (min 1) }` | `View` | Renames a view. Requires **editor** role. Publishes change. |
| `updateOptions` | P | `{ id: string; options: Record<string, unknown> }` | `View` | Updates the view's JSONB options (filter, sort, group, hiddenFields, etc.). Requires **editor** role. Publishes change. |
| `delete` | P | `{ id: string }` | `{ ok: true }` | Deletes a view. Requires **editor** role. Publishes change. |

---

## field

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `list` | P | `{ tableId: string }` | `Field[]` | Lists fields in a table, ordered by `orderIndex`. |
| `create` | P | `{ tableId: string; name: string (min 1); type: FieldType; options?: unknown }` | `Field` | Creates a field. Requires **editor** role. Options are parsed/validated through the field type registry. Publishes change. |
| `rename` | P | `{ id: string; name: string (min 1) }` | `Field` | Renames a field. Requires **editor** role. Publishes change. |
| `updateOptions` | P | `{ id: string; options: unknown }` | `Field` | Updates field options (e.g., select choices, number precision). Requires **editor** role. Options are parsed through the registry. Publishes change. |
| `delete` | P | `{ id: string }` | `{ ok: true }` | Deletes a field. Requires **editor** role. FK cascade clears cells. Cell history rows persist (no FK on cellId). Publishes change. |

**Field types** (from `FieldType` constant): `text`, `number`, `boolean`, `date`, `single-select`, `multi-select`, `user`, `link`, `attachment`, `expression`.

---

## record

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `groupCounts` | P | `{ tableId: string; viewId: string }` | `{ total: number; groups: { key: string or null; count: number }[] }` | Requires viewer membership. Counts the entire filtered view in SQL, using only its first grouping field; no pagination. No records yields an empty groups array. |
| `list` | P | `{ tableId: string; viewId?: string; offset?: number (min 0) }` | `{ groups: RecordGroup[]; total: number }` | Lists records with pivoted cell values. Applies view filter/sort/group when `viewId` is provided. Paginated with 100-record page size. |
| `create` | P | `{ tableId: string }` | `Record` | Creates a new empty record. Requires **editor** role. Sets `createdBy` to the current user. Publishes change. |
| `writeBatch` | P | `{ tableId: string; requestId: UUID; rows: { recordId?: string; cells: Record<string, unknown> }[] }` | `{ recordIds: string[]; created: number; updated: number }` | Requires **editor**. Atomic create/update; same-table IDs, no duplicate record IDs or expression writes. At most 100 rows, 500 cells, 1 MiB UTF-8 JSON total and 256 KiB per cell; 30s statement timeout. IDs preserve input order. |
| `delete` | P | `{ id: string; tableId: string }` | `{ ok: true }` | Deletes a record. Requires **editor** role. Cascade-cleans link cells referencing this record id (GIN scan on JSONB arrays). Publishes change. |

---

## cell

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `upsert` | P | `{ recordId: string; fieldId: string; value: unknown }` | `NormalizedCellValue` | Writes a cell value. Requires **editor** role. The value is normalized through the field type registry (ADR-0005): empty → DELETE row, error → reject, value → store JSONB. Writes cell history. Recomputes dependent expression fields within the same transaction. Updates the record's `updatedAt` timestamp. Publishes change. |

---

## export

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `exportBase` | P | `{ baseId: string; tableIds?: string[] }` | `{ tableId: string; name: string; csv: string; total: number; truncated: false }[]` | Exports all selected tables in a base as separate CSV files. Viewer+. Complete within the shared request budget: 100,000 rows per table, 8 MiB of CSV text, and 16 MiB of raw JSON cell text per page. Exceeding a limit fails without a file. Current view filters do not apply. |

---

## history

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `list` | P | `{ recordId: string; fieldId: string }` | `CellHistoryEntry[]` | Lists cell history for a specific cell (record+field combination). Returns up to 50 entries, newest first. Includes `changedByName` and `changedByEmail`. |
| `listByBase` | P | `{ baseId: string; offset?: number (default 0); limit?: number (1-200, default 50); tableId?: string; userId?: string }` | `{ rows: EnrichedHistoryEntry[]; total: number }` | Lists all cell history entries across a base. Optionally filter by table or user. Enriches entries with `fieldName` and `tableName`. |
| `listByTable` | P | `{ tableId: string; offset?: number (default 0); limit?: number (1-200, default 50) }` | `{ rows: EnrichedHistoryEntry[]; total: number }` | Lists all cell history entries for a table. Enriches with `fieldName` and `tableName`. |

---

## share

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `list` | P | `{ baseId: string }` | `BaseShare[]` | Lists all public share links for a base. |
| `create` | P | `{ baseId: string; viewId?: string }` | `BaseShare` | Creates a public share link. Requires **editor** role. Generates a UUID token. Sets `createdBy` to current user. |
| `delete` | P | `{ id: string }` | `{ ok: true }` | Deletes a share link. Requires **editor** role. |

---

## member

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `me` | P | `{ baseId: string }` | `{ role: Role } \| null` | Returns the current user's role in a base, or null if not a member. |
| `list` | P | `{ baseId: string }` | `{ userId: string; role: string; name: string \| null; email: string \| null }[]` | Lists all members of a base with their roles, names, and emails. |
| `updateRole` | P | `{ baseId: string; userId: string; role: "owner" \| "editor" \| "viewer" }` | `{ ok: true }` | Updates a member's role. Requires **owner** role. |
| `remove` | P | `{ baseId: string; userId: string }` | `{ ok: true }` | Removes a member from a base. Requires **owner** role. |

**Roles**: `owner` > `editor` > `viewer`. Membership is created only via base creation (owner) or invite acceptance.

---

## invite

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `list` | P | `{ baseId: string }` | `Invite[]` | Lists pending (unaccepted) invites for a base. Requires **viewer** role. Includes `invitedByName`. |
| `create` | P | `{ baseId: string; email: string (email, lowercase); role: "editor" \| "viewer" }` | `BaseInvite` | Creates an invite. Requires **owner** role. Deactivates any prior pending invite for the same email+base. 48-hour TTL. |
| `delete` | P | `{ id: string }` | `{ ok: true }` | Soft-deletes a pending invite. Requires **owner** role. Sets `acceptedAt` to now. |
| `resolve` | Pub | `{ token: string }` | `{ baseId: string; baseName: string; email: string; role: string } \| null` | Resolves an invite token. Public — no auth required. Returns null if expired, already accepted, or not found. |
| `accept` | P | `{ token: string }` | `{ baseId: string }` | Accepts an invite. Validates that the signed-in user's email matches the invite's target email. Upserts membership with the invited role (never demotes). Returns the base id. |

---

## publicShare

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `getBase` | Pub | `{ token: string }` | `{ id: string; name: string; icon: string \| null; viewId: string \| null; shareId: string } \| null` | Fetches public base metadata by share token. Returns null if expired or not found. |
| `getTables` | Pub | `{ token: string }` | `{ id: string; name: string }[]` | Lists tables in a publicly shared base. Returns empty array if token is invalid or expired. |
| `getRecords` | Pub | `{ token: string; tableId: string }` | `{ fields: Field[]; records: PivotedRecord[] } \| null` | Fetches records from a publicly shared table. If the share was created with a `viewId`, applies the view's filter, sort, and hiddenFields. Scope-guarded: the table must belong to the shared base. Returns null if the token is invalid/expired or the table doesn't belong to the shared base. |


---

## token

Personal API tokens for the agent access layer (ADR-0010/0014). Token Base/access/expiry constraints intersect with the creator's current membership — see [agent-access.md](agent-access.md).

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `list` | P | — | `{ id, name, tokenPrefix, createdAt, lastUsedAt, expiresAt, access, baseId }[]` | Lists non-revoked tokens, including expired rows, newest first. Never returns the secret. |
| `create` | P | `{ name, baseId?:string\|null, access?:'read'\|'write', expiresInDays?:number\|null }` | `{ token, row }` | Mints a one-time Bearer value; stores only its digest. Omitted scope/access/expiry preserves legacy all/write/no-expiry; UI explicitly defaults current Base/read/30 days. |
| `revoke` | P | `{ id: string }` | `{ ok: true }` | Soft-revokes a token (sets `revokedAt`). Only the creator's own token; unknown ids and other users' tokens both answer NOT_FOUND. |


---

## csv

Injected by the `@markpocket/plugin-csv` plugin via `...pluginRouters` (ADR-0008). Authorization goes through `CoreServerApi.auth.assertTableRole`.

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `import` | P | `{ tableId: string, csvText: string (≤5MB UTF-8 bytes) }` | import report (rowCount, skippedHeaders, emptyCellRows, partial-failure marker) | Parses CSV and writes records through the core write path (expression cells materialize). Editor+ on the table. |
| `export` | P | `{ tableId: string }` | `{ csv: string; truncated: false; exported: number }` | Exports every record within the budget (injection-neutralized). Viewer+. The 100,000-row, 8 MiB CSV, and 16 MiB raw page limits fail explicitly without a partial file. `truncated` remains for compatibility and is always `false`. CSV omits attachment files, permissions, and history; use an instance backup to preserve them. |

### Atomic batch retries

`record.writeBatch` commits records, cell history, expressions and the retry receipt together. Any invalid cell rejects the whole batch. Reuse the same UUID and unchanged body after a lost response: the server returns the original result, including created record IDs. Cell-map key order is ignored; row order is significant. Reusing a UUID with a different body returns `CONFLICT`. Receipt scope is the authenticated user, and authorization is checked again on replay.

Receipts are retained for seven days, with bounded cleanup on subsequent writes. Clients must stop replaying after that window and reconcile records before starting a new request; replay is no longer guaranteed. Grid paste now consumes this protected batch API; public Form submission uses the shared transaction writer with anonymous attribution and capability checks. Existing REST create/update endpoints keep their partial-success `cellErrors` contract.


### Grid editing and counts

Paste tab-separated rows into an editable selected cell to preview updates and new rows before applying one atomic batch. Expression columns and viewer sessions cannot paste. If the target includes unloaded existing rows, load the next page first. ArrowDown, Tab and PageDown load the next page when needed; Ctrl+End moves to the last loaded row. Fields controls can reorder all fields, including hidden ones.

Group headers count all matching records; the toolbar shows loaded / total records. `Count unavailable` means the count query failed. Multiple grouping fields use only the first field. Advanced filter trees (nested, bare or OR roots) are read-only in the flat filter panel and can be edited through the API.

## P0–P2 view and integration contracts (implemented, unreleased)

Form configuration is stored in validated Form view options. Editors may configure, viewers preview only; owners use `form.publish({viewId,expiresInDays:1..365})`, `form.list({viewId})` and `form.revoke({publicationId})`. Publication returns the capability once; listing never recovers it. Public submissions use the dedicated Form HTTP surface, not read-only share tokens. See [Forms](../FORMS.md).

Kanban uses `record.kanbanPage` for independent lane pages, `record.groupCounts` for SQL full-view counts and protected `record.get({tableId,id})` for exact-table detail. Writes use existing cell/batch APIs and current editor membership; shared Kanban remains the filtered, hidden-field-redacted Grid projection. See [Kanban](../KANBAN.md).

Token creation accepts Base scope, read/write access and 1–365-day/null expiry; omitted fields retain legacy all/write/no-expiry compatibility. The UI explicitly chooses current Base/read/30 days. REST and MCP request scopes intersect with current membership, default-deny unknown procedures, and cannot mint wider credentials through token/share management. See [agent access](agent-access.md).

### webhook (owner-only browser management)

| Procedure | Input | Result |
| --- | --- | --- |
| list | `{tableId}` | `{id,url,events,state,overflowAt,createdAt}[]`; no secrets/ciphertext |
| create | `{tableId,url,events}` | `{id,secret}` once; at most five endpoints across all states |
| pause | `{id}` | `{ok:true}`; retains queue, invalidates leases |
| resume | `{id,acknowledgeGap:boolean}` | `{ok:true}`; overflow needs acknowledgement, valid key required; current owner adopts responsibility |
| rotate | `{id}` | `{secret}` once; invalidates leases without activation |
| remove | `{id}` | `{ok:true}`; cascades queue/log deletion |
| deliveries | `{id,offset=0,limit=20}` | newest-first `{id,type,state,attempts,lastStatus,lastError,time}[]`; limit 1–50 |
| retry | `{deliveryId}` | `{ok:true}`; dead only, original ID, attempts=0; queue capacity enforced |

Every operation resolves the endpoint's table and checks current owner membership. Lifecycle transactions take table advisory lock → membership share lock → subscription row → delivery row. Missing/external IDs return a generic owner denial without URL/secret disclosure. URLs cannot be edited. See [receiver/recovery documentation](../WEBHOOKS.md) and [ADR-0015](../adr/0015-webhook-outbox.md).
