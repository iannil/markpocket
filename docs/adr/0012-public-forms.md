# ADR-0012: Public forms as submission capabilities

- **Status**: Accepted; delivered incrementally in the Airtable P0–P2 roadmap
- **Date**: 2026-10-10
- **Related**: ADR-0001, ADR-0003, ADR-0004, ADR-0005

## Context

A shared Grid grants record-reading access. A public form needs a narrower capability: show an explicit writable field projection and accept an anonymous submission without exposing existing records, attachments, or members. Form configuration must remain separate from Grid filters, sorting, grouping, and hidden fields.

## Decision

1. `TableView` owns field/view/member loading and active view selection. It mounts Grid only for a Grid view and passes a controlled `viewId`. Form and Kanban receive their own renderers when those features ship. Creation controls expose only delivered view types. P1 retains Grid-only creation; draft Form creation is enabled by P2 and the Form UI by P4.
2. Form options contain `title`, `description`, an explicit ordered list of `{fieldId, required}`, and `successMessage`. Limits are 120/2000/500 characters respectively, with 1–50 distinct fields. The success default is `Thank you. Your response has been received.` The allowed public field types are text, number, boolean, date, single-select, and multi-select. A saved configuration must reference existing fields of those types in the same table. Empty draft options are `{}`; an empty configured projection is invalid for publication and requires configuration. New fields never enter the projection automatically.
3. Editors may edit configurations. Only owners may publish, rotate, or close publication capabilities. Publications store a hashed random token, prefix, view foreign key with cascade deletion, creator, revocation time, and expiry. Tokens are shown once; rotation revokes the old link and creates a new publication. Default expiry is 30 days, configurable from 1 to 365 days. A publisher losing owner membership invalidates submission rights. Field deletion or type changes revoke affected publications before configuration cleanup; the operation must never silently broaden access.
4. A public GET returns only the selected writable fields and safe options. POST accepts `{requestId,cells}` and rejects missing required values, extra fields, unsupported types, and invalid configurations. A required boolean must be checked; numeric zero is valid. Responses contain `{ok:true}` without a record id. Form views cannot be used as read-only Grid shares or RSS sources.
5. Anonymous writes reuse the atomic batch writer: each actual cell change records history, empty values remove cells, and expressions materialize in the same transaction. Anonymous `createdBy`/`changedBy` values are null. An internal `form_submission(publicationId,requestId,recordId,createdAt)` receipt supports retry without creating a second record; request id scope is the publication, and rotation creates a new scope. Realtime notifications follow commit.
6. Public GET and POST are `no-store`/`no-referrer`. POST checks same-origin requests and limits bodies to 64 KiB including chunked bodies. Single-process limits default to 30 submissions per publication per minute and 120 overall per minute. Arbitrary `X-Forwarded-For` is untrusted. These limits are abuse thresholds, not a promise to prevent spam.
7. Keep the single application process plus PostgreSQL architecture. Add no Redis, external queue, runtime service, public attachment upload, user/link/expression inputs, or conditional form logic.

## Delivery boundary

P1 implements strict configuration validation, field-reference collection and cleanup, and the controlled view container. Publication storage, anonymous endpoints, receipts, rate limits, renderer, and share/RSS type gates are implemented in later roadmap tasks. A Form draft does not gain any public capability through this change.

## Consequences

Explicit projections and revocation make schema changes fail closed. Anonymous submissions do not impersonate a member or gain record-reading permissions. The configuration and capability lifecycle add validation and audit state, and single-process rate limits do not coordinate multiple instances. Those constraints match the self-hosted deployment scope.
