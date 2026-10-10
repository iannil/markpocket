# ADR-0014: Scoped and expiring agent tokens

- Status: Accepted
- Date: 2026-10-10

## Context

ADR-0010 personal API tokens authenticate a creator whose current Base membership
controls authorization. Automation also needs credentials limited to one Base,
read access, or a finite lifetime. These restrictions must not grant membership or
survive deletion as broader credentials.

## Decision

`api_token.access` is `read` or `write`, with a non-null default of `write`.
`base_id` is nullable: null means all Bases the creator is currently permitted to
access; a value limits the credential to that Base. The foreign key uses
`ON DELETE CASCADE`. `SET NULL` would turn a bound credential into an all-Base
credential when its Base is deleted, so it is prohibited.

Existing rows and legacy calls that omit options retain write/all access and no
expiry. New UI callers must explicitly supply the current Base, read access and a
30-day lifetime by default. The creation API accepts integer lifetimes of 1–365
days or an explicit null for no expiry. Existing `expires_at` is reused. Resolution
rejects an expiry equal to or earlier than the current time, as well as revoked or
unknown tokens.

`createApiToken` checks current membership before minting a bound token: read
requires viewer, write requires editor or owner. All-Base tokens create no
memberships and never grant access beyond the creator's current roles. The
plaintext secret is returned once at creation; persistence stores only its SHA-256
digest and display prefix. Lists expose access, Base and expiry metadata without
the digest or secret.

The request scope has `tokenId`, `userId`, `baseId` and `access`.
`runWithTokenScope` uses Node AsyncLocalStorage to keep this context isolated across
concurrent asynchronous requests. `currentTokenScope` is undefined for ordinary
browser sessions. `assertTokenCapability` rejects a different Base for a bound
token and any role above viewer for a read token. It is a capability ceiling, not
a membership check; authorization must intersect it with the creator's current
membership. The scope module only imports the Role type to avoid a runtime cycle.

## Delivery boundary and consequences

I1 supplies persistence, mint-time validation, resolution metadata and the pure
scope gate. I2 wires the gate into shared authorization and REST/MCP request
lifetimes, filters Base lists, restricts credential creation and other unsafe
procedures, and supplies explicit UI defaults. The I1 scope gate alone does not
claim to enforce restrictions on bearer requests until that wiring is delivered.

No new runtime dependency or service is required. The generated migration is
verified against a real legacy row in an isolated PostgreSQL schema; integration
tests also cover current-role mint boundaries, expiry equality, revocation,
metadata disclosure and Base deletion. Scope tests cover concurrent requests,
nesting, errors and the browser-session behavior.
