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
| `list` | P | `{ tableId: string; viewId?: string; offset?: number (min 0) }` | `{ groups: RecordGroup[]; total: number }` | Lists records with pivoted cell values. Applies view filter/sort/group when `viewId` is provided. Paginated with 100-record page size. |
| `create` | P | `{ tableId: string }` | `Record` | Creates a new empty record. Requires **editor** role. Sets `createdBy` to the current user. Publishes change. |
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
| `exportBase` | P | `{ baseId: string }` | `{ name: string; csv: string }[]` | Exports all tables in a base as CSV files. Requires **viewer** role. Each table becomes one CSV file. Supports Text, Number, Boolean, Select, and Multi-Select field types. |

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

Personal API tokens for the agent access layer (ADR-0010). A token carries its creator's full authority — see [agent-access.md](agent-access.md).

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `list` | P | — | `{ id, name, tokenPrefix, createdAt, lastUsedAt, expiresAt }[]` | Lists the caller's live (non-revoked) tokens, newest first. Never returns the secret — only the display prefix. |
| `create` | P | `{ name: string }` | `{ token: string, row: { id, name, tokenPrefix, createdAt } }` | Mints a new Bearer token. The plaintext `token` crosses the wire exactly once, in this response; only the sha256 digest is stored. |
| `revoke` | P | `{ id: string }` | `{ ok: true }` | Soft-revokes a token (sets `revokedAt`). Only the creator's own token; unknown ids and other users' tokens both answer NOT_FOUND. |


---

## csv

Injected by the `@markpocket/plugin-csv` plugin via `...pluginRouters` (ADR-0008). Authorization goes through `CoreServerApi.auth.assertTableRole`.

| Procedure | Auth | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `import` | P | `{ tableId: string, csvText: string (≤5MB UTF-8 bytes) }` | import report (rowCount, skippedHeaders, emptyCellRows, partial-failure marker) | Parses CSV and writes records through the core write path (expression cells materialize). Editor+ on the table. |
| `export` | P | `{ tableId: string }` | `{ csv: string, truncated: boolean, total: number }` | Exports the table as CSV (injection-neutralized, 10k-row cap with truncation flag). Viewer+. |
