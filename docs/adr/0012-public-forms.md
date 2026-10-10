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

## P2 publication lifecycle

`form_publication` stores an independent `mpf_` capability with 192 random bits,
only its SHA-256 digest and 12-character display prefix. Rotation revokes active
rows and creates a new publication id. Publication-scoped submission receipts
have cascading foreign keys to both publication and record, and unique
`(publication_id, request_id)`. These audit rows persist until a record/publication
foreign-key cascade removes them. The separate atomic writer receipts retain
request body hashes/results for seven days, as described below.

Publish, revoke, Form projection/required changes, field semantic options changes,
field deletion, and view deletion serialize on `view-options:<tableId>`. Text-only
Form edits retain the link. All field option changes conservatively revoke selected
forms when the parsed options differ; field creation never extends a projection.
Deletion preserves opaque view extension keys and a deliberately invalid empty
Form draft after revoking its publication. No field type mutation API is exposed;
resolution checks current type eligibility on every request.

`resolvePublication(token, tx)` obtains that same advisory transaction lock,
re-reads current publication, view and fields, and locks the publishing owner's
membership row `FOR SHARE`. The caller must keep that transaction open through
receipt checks and anonymous writes; P3 may not resolve outside its write
transaction. The overload without a transaction creates one for read-only access.
Membership demotion/removal blocks until the transaction ends, or resolution sees
the new role and rejects. If a caller also needs `field-order:<tableId>`, it must
acquire it before `view-options:<tableId>`; never invert the order.

## P3 public HTTP and atomic submissions

GET resolves the capability and reads the configured fields under the lifecycle
transaction lock, with field rows held `FOR SHARE`. It returns only title,
description, success message, and ordered field id/name/type/required/options.
Select options expose only choice id/name/color; dates expose includeTime;
numbers expose precision. Source/import metadata never enters the projection.

POST counts actual streamed bytes even when Content-Length is present, requires a
strict UUID/cells envelope with at most 50 fields and 64 KiB, and normalizes every
configured field before writing. A required checkbox must normalize to true;
numeric zero is valid. The HTTP edge uses separate global GET (300/min) and POST
(120/min) windows and a publication POST window (30/min). Invalid capabilities
consume the global window. No Origin permits non-browser clients; an Origin must
pass the shared same-origin guard. All responses, including errors, have no-store
and no-referrer headers. Error responses mask unexpected failures.

The HTTP publication lookup only selects the rate-limit key. Submission resolves
again inside its write transaction before any receipt access, keeping lifecycle,
owner membership and field locks through commit. Anonymous batch writes,
expression materialization, history, the F write receipt, and form audit insert
commit together. Realtime delivery follows commit and excludes no user.

Form audits are durable until their foreign-key cascades. F write receipts have a
seven-day replay window and bounded actor-local cleanup. An audit whose matching
F receipt is expired or missing causes request-id reuse to return 409; it never
creates an additional anonymous record while ignoring an audit uniqueness
conflict. During the active window F still checks the body hash and rejects a
changed payload. A client retry after seven days must obtain confirmation before
starting a new submission with a fresh UUID. The retention tradeoff is growing
audit storage for records/publications that remain alive, in exchange for a
permanent association of each surviving audit with its submitted record.

An active F receipt is also proof that the original form audit committed. If an
owner later deletes that record, its audit cascades away; a same-body replay still
returns `{ok:true}` after capability and body-hash validation without resurrecting
the record or audit. Replay acknowledges historical acceptance, not current
record existence. After both audit deletion and receipt expiry, the seven-day F
contract supplies no permanent deduplication guarantee.
