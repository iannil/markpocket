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

REST and MCP now run their complete asynchronous handlers inside the resolved
scope. The HTTP wrapper awaits the scoped handler so asynchronous authorization
errors retain the existing JSON envelope. Shared role checks reject identity
mixing, cross-Base access and writes through read tokens before checking current
membership. Direct record reads use the same table-role gate.

Protected procedures apply a closed read/write allowlist and reject unknown
paths and unexpected procedure types. API tokens cannot mint tokens, shares or
invites. Base lists filter to the bound Base; bound tokens cannot create Bases.
Browser sessions have no token scope and retain their existing permissions.
The settings UI explicitly supplies current Base/read/30 days by default and
shows legacy tokens as all-Base/write/no-expiry. RSS and the public Skill document
retain their separate read-only/public-document boundaries.

No new runtime dependency or service is required. The generated migration is
verified against a real legacy row in an isolated PostgreSQL schema; integration
tests also cover current-role mint boundaries, expiry equality, revocation,
metadata disclosure and Base deletion. Scope tests cover concurrent requests,
nesting, errors and the browser-session behavior.
