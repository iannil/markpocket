# ADR-0011: Atomic record writes and retry receipts

- Status: Accepted contract; F1 supplies test infrastructure, F2–F3 implement the writer and receipts.
- Date: 2026-10-10
- Related: ADR-0001, ADR-0003, ADR-0004, ADR-0005; Airtable P0–P2 foundation.

## Decision

Extract the existing cell writer into `writeCellInTransaction`, with an explicit transaction, actorId, recordId, fieldId and value. Preserve ownership checks, reference validation, row/advisory locks, LWW overwrite hints and change history. Empty values delete cells; invalid values reject the transaction. Each actual change writes history. Materialize expressions in that transaction, once per changed record after all its cells. Send realtime notifications only after commit.

`record.writeBatch({tableId, requestId, rows})` accepts rows with optional recordId and a map of cells. Require editor or owner membership, reject IDs from another table and direct expression writes, and acquire locks in stable recordId/fieldId order. New records, cells, history, expressions and retry receipts commit together; any invalid value rolls back the entire batch. Existing REST partial-success writes retain their protocol.

Bound each batch to 100 rows, 500 cells, 1 MiB serialized input and 256 KiB per cell, with a transaction-local 30 second statement_timeout. These are server-enforced budgets, independent of client validation.

Persist a unique `(actorKey, requestId)` receipt with bodyHash and result in the same transaction as data. The server derives actorKey as `user:<id>` or `form:<publicationId>`. An identical request replays the stored result; a different body with that key returns conflict (HTTP 409). Retain receipts seven days; after retention the UI must explain that replay is unavailable. Concurrent requests must serialize receipt claims so response loss can be retried safely.

Anonymous form writes use actorId=null for record createdBy and history changedBy, including expression history; never impersonate the form owner. Form publication auditing remains separate, and a rotated publication has a new receipt scope.

## Verification and consequences

Use opt-in real PostgreSQL tests against a database named `markpocket_p0p2_*`. The shared fixture uses random user/base/table/field IDs with the default workspace, so base.list exercises the real single-tenant scope. Cleanup deletes only fixture-owned history, its random base and users; it never deletes the shared workspace. F3 must extend cleanup to no-FK receipts by fixture actorKey (and publication actor keys when form fixtures are introduced).

This keeps the single application process plus PostgreSQL architecture and adds no queue or runtime dependency. Atomic writes require bounded transactions and consistent lock ordering across entry points. Receipts trade bounded storage for safe retries within a clearly limited retention window.
