# ADR-0013: Typed Kanban configuration and independent lane pagination

Status: Accepted
Date: 2026-10-10

## Context

A board can contain more records in one status than fit in the Grid page. Splitting a loaded Grid page into lanes would hide cards and undercount statuses. Saved configuration can also become invalid when fields or choices change.

## Decisions

- Store `ViewOptions.kanban = { groupFieldId, titleFieldId? }`. The status must be a same-table single-select with at most 100 choices; optional titles support text, number, date and single-select. Validate under the existing `view-options:<tableId>` lock when saving.
- Enable the Kanban API in K1; the creation UI remains Grid/Form until K2 supplies its renderer.
- `record.kanbanPage` requires viewer membership in the requested table's base and a Kanban view belonging to that table. Default to offset 0 and limit 50, with allowed limits 1–50. Each request independently paginates one lane in SQL before fetching its cells.
- AND the lane predicate with the saved filter and reuse Grid sort compilation. Append `createdAt DESC, id DESC` for deterministic ties. Fetch configuration, fields, page and count in one read-only repeatable-read transaction with a 30-second statement timeout. Shared query helpers accept an optional executor without opening nested transactions.
- `choiceId: null` identifies missing cells, SQL NULL, JSON null and empty-string values. Real choice IDs remain literal; `__empty__` is a valid choice distinct from the empty lane.
- Reserve `__unavailable__` as the RPC selector for nonempty values outside current choices. Parameterize JSON membership checks. An unknown non-reserved request choice is a bad request. Do not provide a destination choice for moving into Unavailable.
- Reject a status configuration whose real choice ID is `__unavailable__`, with a clear repair message. Never rename or mutate that existing Grid field automatically. Such rare existing IDs must be repaired before the field can back a board.
- Strictly parse saved board options and validate live same-table references on every page/count read. Missing or invalid configuration, deleted fields and changed field types fail closed with `BAD_REQUEST: Configure a status field for this board`. Preserve stale Kanban references during deletion so an invalid board cannot silently widen to the whole table. Grid cleanup still operates when raw Form/Kanban drafts are invalid and retains opaque extensions.
- Reuse SQL `groupCounts`, selecting the configured Kanban status rather than Grid's `group` option. Preserve Grid's shared `null` empty-key semantics and literal string keys; return unknown choice keys for the renderer to merge into Unavailable. Counts cover all filtered rows rather than the loaded page.
- Card moves in K2 use existing `cell.upsert` last-write-wins behavior and modify only status. They do not define custom ordering. The UI must retain the LWW notice, recover from failed moves and invalidate affected pages, counts and Grid after successful writes.

## Consequences

No schema migration, queue or runtime dependency is needed. Lane pagination uses existing indexes and the existing record/cell projection. A stable snapshot makes each page/count response consistent, but offset pagination can shift across requests when records change; callers refresh after writes and realtime changes. Board UI and move interactions are delivered separately in K2.
